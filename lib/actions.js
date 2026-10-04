import { clearPageStorage, readPageStorage, writePageStorage } from './page.js'
import { accessPatterns, appliesToHost, planCookieWrites, removalUrl, toSnapshot } from './cookies.js'

const KINDS = ['local', 'session', 'cookies']

const LABELS = {
    local: 'local storage values',
    session: 'session storage values',
    cookies: 'cookies',
}

const VERBS = {
    single: { get: 'Got', set: 'Set', clear: 'Cleared' },
    all: { get: 'Copied', set: 'Pasted', clear: 'Cleared' },
}

const NOTHING_SAVED = 'Nothing to set yet. Click Get on the source site first.'

export function hostOf(tab) {
    try {
        return new URL(tab.url).hostname || 'this page'
    } catch {
        return 'this page'
    }
}

function originOf(url) {
    try {
        return new URL(url).origin
    } catch {
        return null
    }
}

function plural(count, label) {
    return `${count} ${count === 1 ? label.replace(/s$/, '') : label}`
}

function joinList(parts) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

// Every action takes the chrome API as a parameter so tests can pass a fake.
export function createActions(chrome) {
    // The page functions report their own errors (see page.js); a missing
    // result means Chrome could not run them at all.
    async function inject(tab, func, args) {
        let frame
        try {
            ;[frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args })
        } catch {
            throw new Error(
                `GetSet cannot access ${hostOf(tab)}. Browser pages and the Web Store are blocked by Chrome.`
            )
        }
        const result = frame?.result
        if (!result) throw new Error(`GetSet could not run on ${hostOf(tab)}. Reload the page and try again.`)
        if (result.error) throw new Error(result.error)
        return result
    }

    // The popup runs in the regular profile even for an incognito tab, and
    // cookie calls without a storeId use the popup's store. Resolve the tab's
    // own store so incognito actions never touch regular cookies.
    async function storeOf(tab) {
        const stores = await chrome.cookies.getAllCookieStores()
        const store = stores.find((s) => s.tabIds.includes(tab.id))
        if (!store) throw new Error(`Could not find the cookie store of ${hostOf(tab)}.`)
        return store.id
    }

    // getAll({ url }) would also filter by the page path, dropping cookies
    // scoped to e.g. /api. Read the whole store (limited to hosts GetSet has
    // access to) and keep the cookies that belong to this host.
    async function pageCookies(tab, storeId) {
        const host = new URL(tab.url).hostname
        const all = await chrome.cookies.getAll({ storeId })
        return all.filter((cookie) => appliesToHost(cookie, host))
    }

    // Each kind reads, saves and writes separately so Copy All can read every
    // kind before saving any (see run).
    // Storage values keep living in chrome.storage.local, as in 0.2.0. Cookies
    // often hold login tokens, so they stay in memory only (storage.session)
    // and are dropped when the browser closes.
    const storage = {
        async read(type, tab) {
            return (await inject(tab, readPageStorage, [type, originOf(tab.url)])).entries
        },
        async save(type, entries) {
            await chrome.storage.local.set({ [type]: entries })
        },
        async set(type, tab) {
            const { [type]: entries = [] } = await chrome.storage.local.get(type)
            if (!entries.length) return null
            return inject(tab, writePageStorage, [type, originOf(tab.url), entries])
        },
        async clear(type, tab) {
            return inject(tab, clearPageStorage, [type, originOf(tab.url)])
        },
    }

    const cookies = {
        async read(_, tab) {
            return (await pageCookies(tab, await storeOf(tab))).map(toSnapshot)
        },
        async save(_, snapshots) {
            await chrome.storage.session.set({ cookies: snapshots })
        },
        async set(_, tab) {
            const { cookies: saved = [] } = await chrome.storage.session.get('cookies')
            if (!saved.length) return null
            const storeId = await storeOf(tab)
            const { writes, skipped } = planCookieWrites(saved, tab.url)
            let failed = 0
            for (const details of writes) {
                // The promise form can either reject or resolve null on failure.
                const cookie = await chrome.cookies.set({ ...details, storeId }).catch(() => null)
                if (!cookie) failed++
            }
            const notes = []
            if (skipped.length) {
                const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ')
                notes.push(`${plural(skipped.length, 'cookies')} skipped (${reasons})`)
            }
            if (failed) notes.push(`${plural(failed, 'cookies')} rejected by Chrome`)
            return { count: writes.length - failed, notes }
        },
        async clear(_, tab) {
            const storeId = await storeOf(tab)
            let removed = 0
            for (const cookie of await pageCookies(tab, storeId)) {
                const result = await chrome.cookies
                    .remove({ url: removalUrl(cookie), name: cookie.name, storeId })
                    .catch(() => null)
                if (result) removed++
            }
            return { count: removed }
        },
    }

    const handlerOf = (type) => (type === 'cookies' ? cookies : storage)

    // The popup caches the tab when it opens; refuse to act if the tab has
    // since navigated to another site.
    async function assertSameSite(tab) {
        const current = await chrome.tabs.get(tab.id)
        if (originOf(current.url) !== originOf(tab.url)) {
            throw new Error('This tab changed to another site. Reopen GetSet and try again.')
        }
    }

    return {
        // chrome.permissions.request only works during the click's user gesture,
        // so the popup calls this before awaiting anything else.
        requestAccess(kind, tab) {
            if (kind !== 'cookies' && kind !== 'all') return Promise.resolve(true)
            const origins = accessPatterns(tab.url)
            if (!origins) {
                return Promise.reject(new Error('Cookies can only be copied on http and https pages.'))
            }
            return chrome.permissions.request({ permissions: ['cookies'], origins })
        },
        // Runs one kind, or all three in order for kind 'all', and returns one
        // summary line. With 'all', a kind that was never copied is left out.
        async run(kind, action, tab) {
            await assertSameSite(tab)
            const types = kind === 'all' ? KINDS : [kind]
            const verb = VERBS[kind === 'all' ? 'all' : 'single'][action]
            const where = `${action === 'get' ? 'from' : 'on'} ${hostOf(tab)}`
            const parts = []
            const notes = []

            if (action === 'get') {
                // Read everything first, then save, so a failed read never
                // leaves a mix of the new site and an older copy.
                const data = []
                for (const type of types) data.push([type, await handlerOf(type).read(type, tab)])
                for (const [type, values] of data) {
                    await handlerOf(type).save(type, values)
                    parts.push(plural(values.length, LABELS[type]))
                }
                return `${verb} ${joinList(parts)} ${where}.`
            }

            for (const type of types) {
                let result
                try {
                    result = await handlerOf(type)[action](type, tab)
                } catch (error) {
                    if (!parts.length) throw error
                    throw new Error(`${verb} ${joinList(parts)} ${where}, then stopped: ${error.message}`)
                }
                if (!result) continue
                parts.push(plural(result.count, LABELS[type]))
                notes.push(...(result.notes ?? []))
            }
            if (!parts.length) return NOTHING_SAVED
            const message = `${verb} ${joinList(parts)} ${where}.`
            return notes.length ? `${message} ${notes.join('; ')}.` : message
        },
    }
}
