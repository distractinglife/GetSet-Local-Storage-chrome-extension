import { clearPageStorage, readPageStorage, writePageStorage } from './page.js'
import { accessPatterns, appliesToHost, planCookieWrites, removalUrl, toSnapshot } from './cookies.js'

const KINDS = ['local', 'session', 'cookies']

const LABELS = {
    local: 'local storage values',
    session: 'session storage values',
    cookies: 'cookies',
}

const VERBS = { get: 'Got', set: 'Set', clear: 'Cleared' }

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

    // The page's own CHIPS partition (its top-level site), as Chrome computes it.
    async function partitionOf(tab) {
        const { partitionKey } = await chrome.cookies.getPartitionKey({ tabId: tab.id, frameId: 0 })
        return partitionKey
    }

    // getAll({ url }) would also filter by the page path, dropping cookies
    // scoped to e.g. /api, and without a partitionKey it skips partitioned
    // cookies. Read the whole store across partitions (limited to hosts GetSet
    // has access to) and keep the cookies that belong to this page.
    async function pageCookies(tab, storeId) {
        const host = new URL(tab.url).hostname
        const [all, partition] = await Promise.all([
            chrome.cookies.getAll({ storeId, partitionKey: {} }),
            partitionOf(tab),
        ])
        return all.filter((cookie) => appliesToHost(cookie, host, partition))
    }

    // Each kind reads, saves and writes separately so Get All can read every
    // kind before saving any (see run).
    // Storage values keep living in chrome.storage.local, as in 0.2.0. Cookies
    // often hold login tokens, so they stay in memory only (storage.session)
    // and are dropped when the browser closes.
    const storage = {
        async read(type, tab) {
            return (await inject(tab, readPageStorage, [type, originOf(tab.url)])).entries
        },
        area: 'local',
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
        area: 'session',
        async set(_, tab) {
            const { cookies: saved = [] } = await chrome.storage.session.get('cookies')
            if (!saved.length) return null
            const storeId = await storeOf(tab)
            const partition = saved.some((c) => c.partitioned) ? await partitionOf(tab) : null
            const { writes, skipped } = planCookieWrites(saved, tab.url, undefined, partition)
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
            const host = new URL(tab.url).hostname
            const found = await pageCookies(tab, storeId)
            for (const cookie of found) {
                const details = { url: removalUrl(cookie, host), name: cookie.name, storeId }
                if (cookie.partitionKey) details.partitionKey = cookie.partitionKey
                await chrome.cookies.remove(details).catch(() => null)
            }
            // One remove can delete several same-named cookies, so count what is gone.
            const left = await pageCookies(tab, storeId)
            return { count: found.length - left.length }
        },
    }

    const handlerOf = (type) => (type === 'cookies' ? cookies : storage)

    // Saves a new copy of several kinds as one unit: if any write fails (for
    // example the storage quota), the previous copy of every kind is put back,
    // so Set All never mixes two sites.
    async function saveTogether(data) {
        const byArea = { local: {}, session: {} }
        for (const [type, values] of Object.entries(data)) byArea[handlerOf(type).area][type] = values
        const areas = Object.entries(byArea).filter(([, items]) => Object.keys(items).length)
        const previous = {}
        for (const [area, items] of areas) previous[area] = await chrome.storage[area].get(Object.keys(items))
        try {
            for (const [area, items] of areas) await chrome.storage[area].set(items)
        } catch (error) {
            for (const [area, items] of areas) {
                const missing = Object.keys(items).filter((key) => !(key in previous[area]))
                await chrome.storage[area].remove(missing).catch(() => {})
                await chrome.storage[area].set(previous[area]).catch(() => {})
            }
            throw new Error(`Could not save the new copy, so the previous one was kept: ${error.message}`)
        }
    }

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
        // `cookies: false` (access declined) runs 'all' on storage only.
        async run(kind, action, tab, { cookies: cookiesAllowed = true } = {}) {
            await assertSameSite(tab)
            const skipCookies = kind === 'all' && !cookiesAllowed
            const types = kind === 'all' ? KINDS.filter((t) => t !== 'cookies' || !skipCookies) : [kind]
            const verb = VERBS[action]
            const where = `${action === 'get' ? 'from' : 'on'} ${hostOf(tab)}`
            const parts = []
            const notes = skipCookies ? [`Cookies skipped: access not granted for ${hostOf(tab)}`] : []
            const withNotes = (message) => (notes.length ? `${message} ${notes.join('; ')}.` : message)

            if (action === 'get') {
                // Read everything first, then save, so a failed read never
                // leaves a mix of the new site and an older copy.
                const data = {}
                for (const type of types) data[type] = await handlerOf(type).read(type, tab)
                for (const type of types) parts.push(plural(data[type].length, LABELS[type]))
                // Drop the older site's cookies too, so a later Set All cannot mix two sites.
                if (skipCookies) data.cookies = []
                await saveTogether(data)
                return withNotes(`${verb} ${joinList(parts)} ${where}.`)
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
            if (!parts.length) return withNotes(NOTHING_SAVED)
            return withNotes(`${verb} ${joinList(parts)} ${where}.`)
        },
    }
}
