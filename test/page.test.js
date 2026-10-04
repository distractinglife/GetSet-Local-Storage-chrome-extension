import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearPageStorage, readPageStorage, writePageStorage } from '../lib/page.js'

class FakeStorage {
    #items = new Map()
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
        this.#items.set(key, String(value))
    }
    clear() {
        this.#items.clear()
    }
}

beforeEach(() => {
    globalThis.localStorage = new FakeStorage()
    globalThis.sessionStorage = new FakeStorage()
})

test('reads entries in the 0.2.0 format', () => {
    localStorage.setItem('token', 'abc')
    localStorage.setItem('theme', 'dark')
    assert.deepEqual(readPageStorage('local'), [{ token: 'abc' }, { theme: 'dark' }])
    assert.deepEqual(readPageStorage('session'), [])
})

test('writes entries into the chosen storage only', () => {
    const count = writePageStorage('session', [{ a: '1' }, { b: '{"x":2}' }, {}])
    assert.equal(count, 2)
    assert.equal(sessionStorage.getItem('b'), '{"x":2}')
    assert.equal(localStorage.length, 0)
})

test('write overwrites existing keys and keeps others', () => {
    localStorage.setItem('a', 'old')
    localStorage.setItem('keep', 'yes')
    writePageStorage('local', [{ a: 'new' }])
    assert.equal(localStorage.getItem('a'), 'new')
    assert.equal(localStorage.getItem('keep'), 'yes')
})

test('round trip preserves keys and values', () => {
    localStorage.setItem('user', '{"id":1}')
    localStorage.setItem('empty', '')
    const entries = readPageStorage('local')
    globalThis.localStorage = new FakeStorage()
    writePageStorage('local', entries)
    assert.deepEqual(readPageStorage('local'), entries)
})

test('clear empties the chosen storage and reports the count', () => {
    localStorage.setItem('a', '1')
    sessionStorage.setItem('b', '2')
    assert.equal(clearPageStorage('local'), 1)
    assert.equal(localStorage.length, 0)
    assert.equal(sessionStorage.length, 1)
})

test('injected functions are self-contained', () => {
    // executeScript serializes the function source; outer references would break in the page.
    for (const fn of [readPageStorage, writePageStorage, clearPageStorage]) {
        const isolated = new Function(`return (${fn.toString()})`)()
        assert.equal(typeof isolated, 'function')
    }
    localStorage.setItem('k', 'v')
    const isolatedRead = new Function(`return (${readPageStorage.toString()})`)()
    assert.deepEqual(isolatedRead('local'), [{ k: 'v' }])
})
