// These functions run inside the page through chrome.scripting.executeScript,
// which serializes each one on its own. Keep them self-contained: no imports,
// no outer variables and no chrome.* calls.
//
// An exception thrown here does not reject executeScript; the popup just gets
// a null result. So every function catches its own errors and returns either
// a result object or { error }. Each one also checks the page origin, in case
// the tab navigated after the popup opened.

// Entries keep the 0.2.0 format ([{ key: value }]) so values fetched with an
// older version can still be set after updating.
export function readPageStorage(type, expectedOrigin) {
    try {
        if (location.origin !== expectedOrigin) {
            return { error: 'The page changed while GetSet was working. Try again.' }
        }
        const storage = type === 'local' ? localStorage : sessionStorage
        const entries = []
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i)
            entries.push({ [key]: storage.getItem(key) })
        }
        return { count: entries.length, entries }
    } catch (error) {
        return { error: `Could not read ${type} storage: ${error.message}` }
    }
}

export function writePageStorage(type, expectedOrigin, entries) {
    let count = 0
    try {
        if (location.origin !== expectedOrigin) {
            return { error: 'The page changed while GetSet was working. Try again.' }
        }
        const storage = type === 'local' ? localStorage : sessionStorage
        for (const entry of entries) {
            const [pair] = Object.entries(entry)
            if (!pair) continue
            storage.setItem(pair[0], pair[1])
            count++
        }
        return { count }
    } catch (error) {
        // Earlier values stay written; report how far it got.
        return { error: `Stopped after ${count} ${type} storage values: ${error.message}` }
    }
}

export function clearPageStorage(type, expectedOrigin) {
    try {
        if (location.origin !== expectedOrigin) {
            return { error: 'The page changed while GetSet was working. Try again.' }
        }
        const storage = type === 'local' ? localStorage : sessionStorage
        const count = storage.length
        storage.clear()
        return { count }
    } catch (error) {
        return { error: `Could not clear ${type} storage: ${error.message}` }
    }
}
