import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActions, hostOf } from '../lib/actions.js'

const TAB = { id: 7, url: 'http://localhost:3000/home' }

// Minimal stand-in for the chrome APIs the actions use.
function fakeChrome({ scriptResult, scriptError, cookies = [], setFails = [] } = {}) {
    const calls = { scripts: [], set: [], removed: [], requested: [] }
    const area = () => {
        const data = {}
        return {
            data,
            async get(key) {
                return key in data ? { [key]: data[key] } : {}
            },
            async set(items) {
                Object.assign(data, items)
            },
        }
    }
    const chrome = {
        calls,
        storage: { local: area(), session: area() },
        scripting: {
            async executeScript(details) {
                calls.scripts.push(details)
                if (scriptError) throw scriptError
                return [{ result: scriptResult }]
            },
        },
        cookies: {
            async getAll() {
                return cookies
            },
            async set(details) {
                calls.set.push(details)
                if (setFails.includes(details.name)) return null
                return details
            },
            async remove(details) {
                calls.removed.push(details)
                return details
            },
        },
        permissions: {
            async request(request) {
                calls.requested.push(request)
                return true
            },
        },
    }
    return chrome
}

test('storage get saves entries under the storage type', async () => {
    const chrome = fakeChrome({ scriptResult: [{ a: '1' }, { b: '2' }] })
    const message = await createActions(chrome).run('local', 'get', TAB)
    assert.equal(message, 'Got 2 local storage values from localhost.')
    assert.deepEqual(chrome.storage.local.data.local, [{ a: '1' }, { b: '2' }])
    assert.deepEqual(chrome.calls.scripts[0].args, ['local'])
    assert.equal(chrome.calls.scripts[0].target.tabId, 7)
})

test('storage set passes saved entries into the page', async () => {
    const chrome = fakeChrome({ scriptResult: 1 })
    await chrome.storage.local.set({ session: [{ token: 'x' }] })
    const message = await createActions(chrome).run('session', 'set', TAB)
    assert.equal(message, 'Set 1 session storage value on localhost.')
    assert.deepEqual(chrome.calls.scripts[0].args, ['session', [{ token: 'x' }]])
})

test('storage set without a prior get does not touch the page', async () => {
    const chrome = fakeChrome()
    const message = await createActions(chrome).run('local', 'set', TAB)
    assert.match(message, /Click Get on the source site first/)
    assert.equal(chrome.calls.scripts.length, 0)
})

test('blocked pages produce a readable error', async () => {
    const chrome = fakeChrome({ scriptError: new Error('Cannot access a chrome:// URL') })
    await assert.rejects(
        createActions(chrome).run('local', 'get', { id: 1, url: 'chrome://extensions' }),
        /GetSet cannot access extensions/
    )
})

test('only cookies ask for permission, scoped to the host', async () => {
    const chrome = fakeChrome()
    const actions = createActions(chrome)
    assert.equal(await actions.requestAccess('local', TAB), true)
    assert.equal(chrome.calls.requested.length, 0)
    await actions.requestAccess('cookies', TAB)
    await actions.requestAccess('all', TAB)
    const expected = { permissions: ['cookies'], origins: ['http://localhost/*'] }
    assert.deepEqual(chrome.calls.requested, [expected, expected])
    await assert.rejects(actions.requestAccess('cookies', { url: 'chrome://newtab' }), /http and https/)
})

test('cookie get keeps snapshots in session storage only', async () => {
    const chrome = fakeChrome({
        cookies: [{ name: 'sid', value: 'v', domain: '.example.com', path: '/', session: true }],
    })
    const message = await createActions(chrome).run('cookies', 'get', { id: 1, url: 'https://staging.example.com' })
    assert.equal(message, 'Got 1 cookie from staging.example.com.')
    assert.equal(chrome.storage.session.data.cookies[0].name, 'sid')
    assert.equal('cookies' in chrome.storage.local.data, false)
})

test('cookie set reports skipped and rejected cookies', async () => {
    const chrome = fakeChrome({ setFails: ['bad'] })
    await chrome.storage.session.set({
        cookies: [
            { name: 'ok', value: '1', path: '/', session: true, sameSite: 'lax' },
            { name: 'bad', value: '2', path: '/', session: true, sameSite: 'lax' },
            { name: 'old', value: '3', path: '/', session: false, expirationDate: 1 },
        ],
    })
    const message = await createActions(chrome).run('cookies', 'set', TAB)
    assert.equal(message, 'Set 1 cookie on localhost. 1 cookie skipped (expired); 1 cookie rejected by Chrome.')
    assert.deepEqual(chrome.calls.set.map((c) => c.url), ['http://localhost:3000/', 'http://localhost:3000/'])
})

test('cookie clear removes each cookie at its own domain', async () => {
    const chrome = fakeChrome({
        cookies: [
            { name: 'a', domain: 'localhost', path: '/', secure: false, storeId: '0' },
            { name: 'b', domain: '.localhost', path: '/x', secure: true, storeId: '0' },
        ],
    })
    const message = await createActions(chrome).run('cookies', 'clear', TAB)
    assert.equal(message, 'Cleared 2 cookies on localhost.')
    assert.deepEqual(chrome.calls.removed.map((r) => r.url), ['http://localhost/', 'https://localhost/x'])
})

test('copy all saves every kind and summarizes in one line', async () => {
    const chrome = fakeChrome({
        scriptResult: [{ a: '1' }],
        cookies: [{ name: 'sid', value: 'v', path: '/', session: true }],
    })
    const message = await createActions(chrome).run('all', 'get', TAB)
    assert.equal(message, 'Copied 1 local storage value, 1 session storage value and 1 cookie from localhost.')
    assert.deepEqual(chrome.calls.scripts.map((s) => s.args), [['local'], ['session']])
    assert.equal(chrome.storage.session.data.cookies.length, 1)
})

test('paste all skips kinds that were never copied', async () => {
    const chrome = fakeChrome({ scriptResult: 2 })
    await chrome.storage.local.set({ local: [{ a: '1' }, { b: '2' }] })
    await chrome.storage.session.set({
        cookies: [{ name: 'old', value: '1', path: '/', session: false, expirationDate: 1 }],
    })
    const message = await createActions(chrome).run('all', 'set', TAB)
    assert.equal(message, 'Pasted 2 local storage values and 0 cookies on localhost. 1 cookie skipped (expired).')
    assert.equal(chrome.calls.scripts.length, 1)
})

test('paste all with nothing copied changes nothing', async () => {
    const chrome = fakeChrome()
    assert.match(await createActions(chrome).run('all', 'set', TAB), /Click Get on the source site first/)
    assert.equal(chrome.calls.scripts.length + chrome.calls.set.length, 0)
})

test('clear all clears every kind', async () => {
    const chrome = fakeChrome({
        scriptResult: 3,
        cookies: [{ name: 'a', domain: 'localhost', path: '/', secure: false }],
    })
    const message = await createActions(chrome).run('all', 'clear', TAB)
    assert.equal(message, 'Cleared 3 local storage values, 3 session storage values and 1 cookie on localhost.')
    assert.equal(chrome.calls.removed.length, 1)
})

test('hostOf falls back for unparsable URLs', () => {
    assert.equal(hostOf({ url: 'https://a.test/x' }), 'a.test')
    assert.equal(hostOf({}), 'this page')
})
