// These functions run inside the page through chrome.scripting.executeScript,
// which serializes each one on its own. Keep them self-contained: no imports,
// no outer variables and no chrome.* calls.

// Entries keep the 0.2.0 format ([{ key: value }]) so values fetched with an
// older version can still be set after updating.
export function readPageStorage(type) {
    const storage = type === 'local' ? localStorage : sessionStorage
    const entries = []
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        entries.push({ [key]: storage.getItem(key) })
    }
    return entries
}

export function writePageStorage(type, entries) {
    const storage = type === 'local' ? localStorage : sessionStorage
    let count = 0
    for (const entry of entries) {
        const [pair] = Object.entries(entry)
        if (!pair) continue
        storage.setItem(pair[0], pair[1])
        count++
    }
    return count
}

export function clearPageStorage(type) {
    const storage = type === 'local' ? localStorage : sessionStorage
    const count = storage.length
    storage.clear()
    return count
}
