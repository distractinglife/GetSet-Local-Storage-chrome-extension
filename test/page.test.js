import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearPageStorage, readPageStorage, writePageStorage } from '../lib/page.js'

const ORIGIN = 'http://localhost:3000'

class FakeStorage {
    #items = new Map()
    quota = Infinity
    get length() {
        return this.#items.size
    }
    key(i) {
        return [...this.#items.keys()][i] ?? null
    }
    getItem(key) {
        return this.#items.get(key) ?? null
    }
    setItem(key, value) {
        if (String(value).length > this.quota) throw new Error('QuotaExceededError')
        this.#items.set(key, String(value))
    }
    clear() {
        this.#items.clear()
    }
}

beforeEach(() => {
    globalThis.location = { origin: ORIGIN }
    globalThis.localStorage = new FakeStorage()
    globalThis.sessionStorage = new FakeStorage()
})

test('reads entries in the 0.2.0 format', () => {
    localStorage.setItem('token', 'abc')
    localStorage.setItem('theme', 'dark')
    assert.deepEqual(readPageStorage('local', ORIGIN), {
        count: 2,
        entries: [{ token: 'abc' }, { theme: 'dark' }],
    })
    assert.deepEqual(readPageStorage('session', ORIGIN), { count: 0, entries: [] })
})

test('writes entries into the chosen storage only', () => {
    assert.deepEqual(writePageStorage('session', ORIGIN, [{ a: '1' }, { b: '{"x":2}' }, {}]), { count: 2 })
    assert.equal(sessionStorage.getItem('b'), '{"x":2}')
    assert.equal(localStorage.length, 0)
})

test('write overwrites existing keys and keeps others', () => {
    localStorage.setItem('a', 'old')
    localStorage.setItem('keep', 'yes')
    writePageStorage('local', ORIGIN, [{ a: 'new' }])
    assert.equal(localStorage.getItem('a'), 'new')
    assert.equal(localStorage.getItem('keep'), 'yes')
})

test('a failing write reports how far it got instead of throwing', () => {
    localStorage.quota = 5
    const result = writePageStorage('local', ORIGIN, [{ small: 'ok' }, { big: 'x'.repeat(10) }, { never: '1' }])
    assert.match(result.error, /^Stopped after 1 local storage values: QuotaExceededError/)
    assert.equal(localStorage.getItem('small'), 'ok')
    assert.equal(localStorage.getItem('never'), null)
})

test('every function refuses to run on a different origin', () => {
    localStorage.setItem('a', '1')
    const other = 'https://elsewhere.test'
    for (const result of [
        readPageStorage('local', other),
        writePageStorage('local', other, [{ b: '2' }]),
        clearPageStorage('local', other),
    ]) {
        assert.match(result.error, /page changed/)
    }
    assert.equal(localStorage.length, 1)
})

test('read and clear errors are returned, not thrown', () => {
    globalThis.localStorage = {
        get length() {
            throw new Error('SecurityError')
        },
    }
    assert.match(readPageStorage('local', ORIGIN).error, /Could not read local storage: SecurityError/)
    assert.match(clearPageStorage('local', ORIGIN).error, /Could not clear local storage: SecurityError/)
})

test('clear empties the chosen storage and reports the count', () => {
    localStorage.setItem('a', '1')
    sessionStorage.setItem('b', '2')
    assert.deepEqual(clearPageStorage('local', ORIGIN), { count: 1 })
    assert.equal(localStorage.length, 0)
    assert.equal(sessionStorage.length, 1)
})

test('injected functions are self-contained', () => {
    // executeScript serializes the function source; outer references would break in the page.
    localStorage.setItem('k', 'v')
    for (const fn of [readPageStorage, writePageStorage, clearPageStorage]) {
        assert.equal(typeof new Function(`return (${fn.toString()})`)(), 'function')
    }
    const isolatedRead = new Function(`return (${readPageStorage.toString()})`)()
    assert.deepEqual(isolatedRead('local', ORIGIN).entries, [{ k: 'v' }])
})
