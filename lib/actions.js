import { clearPageStorage, readPageStorage, writePageStorage } from './page.js'
import { hostPattern, planCookieWrites, removalUrl, toSnapshot } from './cookies.js'

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

function plural(count, label) {
    return `${count} ${count === 1 ? label.replace(/s$/, '') : label}`
}

function joinList(parts) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

// Every action takes the chrome API as a parameter so tests can pass a fake.
// Handlers return { count, notes } or null when there is nothing saved to set.
export function createActions(chrome) {
    async function inject(tab, func, args) {
        try {
            const [frame] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func,
                args,
            })
            return frame?.result
        } catch {
            throw new Error(
                `GetSet cannot access ${hostOf(tab)}. Browser pages and the Web Store are blocked by Chrome.`
            )
        }
    }

    // Storage values keep living in chrome.storage.local, as in 0.2.0. Cookies
    // often hold login tokens, so they stay in memory only (storage.session)
    // and are dropped when the browser closes.
    const storage = {
        async get(type, tab) {
            const entries = (await inject(tab, readPageStorage, [type])) ?? []
            await chrome.storage.local.set({ [type]: entries })
            return { count: entries.length }
        },
        async set(type, tab) {
            const { [type]: entries = [] } = await chrome.storage.local.get(type)
            if (!entries.length) return null
            return { count: (await inject(tab, writePageStorage, [type, entries])) ?? 0 }
        },
        async clear(type, tab) {
            return { count: (await inject(tab, clearPageStorage, [type])) ?? 0 }
        },
    }

    const cookies = {
        async get(_, tab) {
            const found = await chrome.cookies.getAll({ url: tab.url })
            await chrome.storage.session.set({ cookies: found.map(toSnapshot) })
            return { count: found.length }
        },
        async set(_, tab) {
            const { cookies: saved = [] } = await chrome.storage.session.get('cookies')
            if (!saved.length) return null
            const { writes, skipped } = planCookieWrites(saved, tab.url)
            let failed = 0
            for (const details of writes) {
                // The promise form can either reject or resolve null on failure.
                const cookie = await chrome.cookies.set(details).catch(() => null)
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
            const found = await chrome.cookies.getAll({ url: tab.url })
            let removed = 0
            for (const cookie of found) {
                const result = await chrome.cookies
                    .remove({ url: removalUrl(cookie), name: cookie.name, storeId: cookie.storeId })
                    .catch(() => null)
                if (result) removed++
            }
            return { count: removed }
        },
    }

    return {
        // chrome.permissions.request only works during the click's user gesture,
        // so the popup calls this before awaiting anything else.
        requestAccess(kind, tab) {
            if (kind !== 'cookies' && kind !== 'all') return Promise.resolve(true)
            const pattern = hostPattern(tab.url)
            if (!pattern) {
                return Promise.reject(new Error('Cookies can only be copied on http and https pages.'))
            }
            return chrome.permissions.request({ permissions: ['cookies'], origins: [pattern] })
        },
        // Runs one kind, or all three in order for kind 'all', and returns one
        // summary line. With 'all', a kind that was never copied is left out.
        async run(kind, action, tab) {
            const parts = []
            const notes = []
            for (const type of kind === 'all' ? KINDS : [kind]) {
                const handler = type === 'cookies' ? cookies : storage
                const result = await handler[action](type, tab)
                if (!result) continue
                parts.push(plural(result.count, LABELS[type]))
                notes.push(...(result.notes ?? []))
            }
            if (!parts.length) return NOTHING_SAVED
            const verb = VERBS[kind === 'all' ? 'all' : 'single'][action]
            const message = `${verb} ${joinList(parts)} ${action === 'get' ? 'from' : 'on'} ${hostOf(tab)}.`
            return notes.length ? `${message} ${notes.join('; ')}.` : message
        },
    }
}
