import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActions, hostOf } from '../lib/actions.js'

const TAB = { id: 7, url: 'http://localhost:3000/home' }
const INCOGNITO_TAB = { id: 9, url: 'http://localhost:3000/home' }

// Minimal stand-in for the chrome APIs the actions use. `script` decides what
// each executeScript call returns. Cookies carry their store and optional
// partition, and remove() deletes like Chrome: every cookie with that name
// that would be sent to the URL's host, in that store and partition.
function fakeChrome({
    script = () => ({ count: 0, entries: [] }),
    cookies = [],
    setFails = [],
    tabUrls = {},
    partitions = {},
    failAreaSet = null,
} = {}) {
    const calls = { scripts: [], set: [], removed: [], requested: [] }
    const jar = [...cookies]
    const area = (name) => {
        const data = {}
        return {
            data,
            async get(keys) {
                return Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]]))
            },
            async set(items) {
                if (failAreaSet === name) throw new Error('QUOTA_BYTES quota exceeded')
                Object.assign(data, items)
            },
            async remove(keys) {
                for (const key of [keys].flat()) delete data[key]
            },
        }
    }
    const sentTo = (c, host) => {
        const domain = c.domain.replace(/^\./, '')
        return c.hostOnly ? domain === host : host === domain || host.endsWith(`.${domain}`)
    }
    return {
        calls,
        jar,
        storage: { local: area('local'), session: area('session') },
        tabs: {
            async get(id) {
                return { id, url: tabUrls[id] ?? TAB.url }
            },
        },
        scripting: {
            async executeScript(details) {
                calls.scripts.push(details)
                return [{ result: script(details) }]
            },
        },
        cookies: {
            async getAllCookieStores() {
                return [{ id: '0', tabIds: [7] }, { id: '1', tabIds: [9] }]
            },
            async getAll({ storeId }) {
                return jar.filter((c) => (c.storeId ?? '0') === storeId)
            },
            async getPartitionKey({ tabId }) {
                return { partitionKey: partitions[tabId] ?? { topLevelSite: 'http://localhost', hasCrossSiteAncestor: false } }
            },
            async set(details) {
                calls.set.push(details)
                return setFails.includes(details.name) ? null : details
            },
            async remove(details) {
                calls.removed.push(details)
                const host = new URL(details.url).hostname
                for (let i = jar.length - 1; i >= 0; i--) {
                    const c = jar[i]
                    if (c.name === details.name && (c.storeId ?? '0') === details.storeId && sentTo(c, host) &&
                        c.partitionKey?.topLevelSite === details.partitionKey?.topLevelSite) jar.splice(i, 1)
                }
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
}

function cookie(overrides) {
    return { name: 'sid', value: 'v', domain: 'localhost', hostOnly: true, path: '/', session: true, ...overrides }
}

test('storage get saves entries and checks the page origin', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 2, entries: [{ a: '1' }, { b: '2' }] }) })
    const message = await createActions(chrome).run('local', 'get', TAB)
    assert.equal(message, 'Got 2 local storage values from localhost.')
    assert.deepEqual(chrome.storage.local.data.local, [{ a: '1' }, { b: '2' }])
    assert.deepEqual(chrome.calls.scripts[0].args, ['local', 'http://localhost:3000'])
})

test('storage set passes saved entries into the page', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 1 }) })
    await chrome.storage.local.set({ session: [{ token: 'x' }] })
    const message = await createActions(chrome).run('session', 'set', TAB)
    assert.equal(message, 'Set 1 session storage value on localhost.')
    assert.deepEqual(chrome.calls.scripts[0].args, ['session', 'http://localhost:3000', [{ token: 'x' }]])
})

test('storage set without a prior get does not touch the page', async () => {
    const chrome = fakeChrome()
    assert.match(await createActions(chrome).run('local', 'set', TAB), /Click Get on the source site first/)
    assert.equal(chrome.calls.scripts.length, 0)
})

test('an error inside the page is reported, not shown as success', async () => {
    const chrome = fakeChrome({ script: () => ({ error: 'Stopped after 1 local storage values: QuotaExceededError' }) })
    await chrome.storage.local.set({ local: [{ a: '1' }, { b: '2' }] })
    await assert.rejects(createActions(chrome).run('local', 'set', TAB), /Stopped after 1 .*Quota/)
})

test('a missing page result is an error and keeps the previous copy', async () => {
    const chrome = fakeChrome({ script: () => null })
    await chrome.storage.local.set({ local: [{ kept: '1' }] })
    await assert.rejects(createActions(chrome).run('local', 'get', TAB), /could not run on localhost/)
    assert.deepEqual(chrome.storage.local.data.local, [{ kept: '1' }])
})

test('blocked pages produce a readable error', async () => {
    const chrome = fakeChrome({ tabUrls: { 1: 'chrome://extensions' } })
    chrome.scripting.executeScript = async () => {
        throw new Error('Cannot access a chrome:// URL')
    }
    await assert.rejects(
        createActions(chrome).run('local', 'get', { id: 1, url: 'chrome://extensions' }),
        /GetSet cannot access extensions/
    )
})

test('refuses to act when the tab moved to another site', async () => {
    const chrome = fakeChrome({ tabUrls: { 7: 'https://elsewhere.test/' } })
    await assert.rejects(createActions(chrome).run('local', 'get', TAB), /changed to another site/)
    assert.equal(chrome.calls.scripts.length, 0)
})

test('only cookie actions ask for permission, for both schemes', async () => {
    const chrome = fakeChrome()
    const actions = createActions(chrome)
    assert.equal(await actions.requestAccess('local', TAB), true)
    assert.equal(chrome.calls.requested.length, 0)
    await actions.requestAccess('cookies', TAB)
    await actions.requestAccess('all', { url: 'https://staging.example.test/' })
    assert.deepEqual(chrome.calls.requested, [
        { permissions: ['cookies'], origins: ['http://localhost/*', 'https://localhost/*'] },
        {
            permissions: ['cookies'],
            origins: [
                'http://staging.example.test/*', 'https://staging.example.test/*',
                'http://example.test/*', 'https://example.test/*',
            ],
        },
    ])
    await assert.rejects(actions.requestAccess('cookies', { url: 'chrome://newtab' }), /http and https/)
})

test('cookie get includes other paths and parent domains, not other hosts', async () => {
    const tab = { id: 7, url: 'https://staging.example.test/' }
    const chrome = fakeChrome({
        tabUrls: { 7: tab.url },
        cookies: [
            cookie({ name: 'root', domain: 'staging.example.test' }),
            cookie({ name: 'api', domain: 'staging.example.test', path: '/api' }),
            cookie({ name: 'parent', domain: '.example.test', hostOnly: false, secure: true }),
            cookie({ name: 'sibling', domain: 'admin.example.test' }),
            cookie({ name: 'other', domain: '.other.test', hostOnly: false }),
        ],
    })
    const message = await createActions(chrome).run('cookies', 'get', tab)
    assert.equal(message, 'Got 3 cookies from staging.example.test.')
    assert.deepEqual(chrome.storage.session.data.cookies.map((c) => c.name), ['root', 'api', 'parent'])
    assert.equal('cookies' in chrome.storage.local.data, false)
})

test('incognito tabs only read and write their own cookie store', async () => {
    const chrome = fakeChrome({
        tabUrls: { 9: INCOGNITO_TAB.url },
        cookies: [cookie({ name: 'regular', storeId: '0' }), cookie({ name: 'private', storeId: '1' })],
    })
    const actions = createActions(chrome)
    await actions.run('cookies', 'get', INCOGNITO_TAB)
    assert.deepEqual(chrome.storage.session.data.cookies.map((c) => c.name), ['private'])
    await actions.run('cookies', 'set', INCOGNITO_TAB)
    await actions.run('cookies', 'clear', INCOGNITO_TAB)
    assert.deepEqual(chrome.calls.set.map((c) => c.storeId), ['1'])
    assert.deepEqual(chrome.calls.removed.map((c) => [c.name, c.storeId]), [['private', '1']])
})

test('cookie set reports skipped and rejected cookies', async () => {
    const chrome = fakeChrome({ setFails: ['bad'] })
    await chrome.storage.session.set({
        cookies: [
            cookie({ name: 'ok', value: '1' }),
            cookie({ name: 'bad', value: '2' }),
            cookie({ name: 'old', value: '3', session: false, expirationDate: 1 }),
        ],
    })
    const message = await createActions(chrome).run('cookies', 'set', TAB)
    assert.equal(message, 'Set 1 cookie on localhost. 1 cookie skipped (expired); 1 cookie rejected by Chrome.')
    assert.deepEqual(chrome.calls.set.map((c) => [c.url, c.storeId]), [
        ['http://localhost:3000/', '0'],
        ['http://localhost:3000/', '0'],
    ])
})

test('cookie clear removes every cookie of the host at its own domain and path', async () => {
    const chrome = fakeChrome({
        cookies: [
            cookie({ name: 'a' }),
            cookie({ name: 'b', path: '/api', secure: true }),
            cookie({ name: 'elsewhere', domain: 'other.test' }),
        ],
    })
    const message = await createActions(chrome).run('cookies', 'clear', TAB)
    assert.equal(message, 'Cleared 2 cookies on localhost.')
    assert.deepEqual(chrome.calls.removed.map((r) => r.url), ['http://localhost/', 'https://localhost/api'])
})

test('get all reads every kind before saving any', async () => {
    const chrome = fakeChrome({
        script: ({ args }) => ({ count: 1, entries: [{ [args[0]]: 'new' }] }),
        cookies: [cookie({})],
    })
    const message = await createActions(chrome).run('all', 'get', TAB)
    assert.equal(message, 'Got 1 local storage value, 1 session storage value and 1 cookie from localhost.')
    assert.deepEqual(chrome.calls.scripts.map((s) => s.args[0]), ['local', 'session'])
    assert.deepEqual(chrome.storage.local.data.session, [{ session: 'new' }])
})

test('a failed get all keeps the whole previous copy', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 1, entries: [{ fresh: '1' }] }) })
    await chrome.storage.local.set({ local: [{ old: '1' }], session: [{ old: '2' }] })
    await chrome.storage.session.set({ cookies: [cookie({ name: 'oldCookie' })] })
    chrome.cookies.getAll = async () => {
        throw new Error('cookie read failed')
    }
    await assert.rejects(createActions(chrome).run('all', 'get', TAB), /cookie read failed/)
    assert.deepEqual(chrome.storage.local.data.local, [{ old: '1' }])
    assert.deepEqual(chrome.storage.local.data.session, [{ old: '2' }])
    assert.equal(chrome.storage.session.data.cookies[0].name, 'oldCookie')
})

test('set all skips kinds that were never copied', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 2 }) })
    await chrome.storage.local.set({ local: [{ a: '1' }, { b: '2' }] })
    await chrome.storage.session.set({ cookies: [cookie({ name: 'old', session: false, expirationDate: 1 })] })
    const message = await createActions(chrome).run('all', 'set', TAB)
    assert.equal(message, 'Set 2 local storage values and 0 cookies on localhost. 1 cookie skipped (expired).')
    assert.equal(chrome.calls.scripts.length, 1)
})

test('set all with nothing copied changes nothing', async () => {
    const chrome = fakeChrome()
    assert.match(await createActions(chrome).run('all', 'set', TAB), /Click Get on the source site first/)
    assert.equal(chrome.calls.scripts.length + chrome.calls.set.length, 0)
})

test('set all reports what finished before a failure', async () => {
    const chrome = fakeChrome({
        script: ({ args }) => (args[0] === 'local' ? { count: 2 } : { error: 'Stopped after 0 session storage values: QuotaExceededError' }),
    })
    await chrome.storage.local.set({ local: [{ a: '1' }, { b: '2' }], session: [{ c: '3' }] })
    await assert.rejects(
        createActions(chrome).run('all', 'set', TAB),
        /^Error: Set 2 local storage values on localhost, then stopped: Stopped after 0 session/
    )
})

test('clear all clears every kind', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 3 }), cookies: [cookie({ name: 'a' })] })
    const message = await createActions(chrome).run('all', 'clear', TAB)
    assert.equal(message, 'Cleared 3 local storage values, 3 session storage values and 1 cookie on localhost.')
    assert.equal(chrome.calls.removed.length, 1)
})

test('clear keeps a same-named host-only cookie on the parent domain', async () => {
    const tab = { id: 7, url: 'http://staging.example.test/' }
    const chrome = fakeChrome({
        tabUrls: { 7: tab.url },
        cookies: [
            cookie({ name: 'sid', value: 'parent-host-only', domain: 'example.test', hostOnly: true }),
            cookie({ name: 'sid', value: 'shared-domain', domain: '.example.test', hostOnly: false }),
        ],
    })
    const message = await createActions(chrome).run('cookies', 'clear', tab)
    assert.equal(message, 'Cleared 1 cookie on staging.example.test.')
    assert.deepEqual(chrome.jar.map((c) => c.value), ['parent-host-only'])
})

test('partitioned cookies of the page are read, written into the target partition and cleared', async () => {
    const own = { topLevelSite: 'http://localhost', hasCrossSiteAncestor: false }
    const chrome = fakeChrome({
        cookies: [
            cookie({ name: 'chips', secure: true, partitionKey: own }),
            cookie({ name: 'embedded', secure: true, partitionKey: { topLevelSite: 'https://other.test' } }),
        ],
    })
    const actions = createActions(chrome)
    assert.equal(await actions.run('cookies', 'get', TAB), 'Got 1 cookie from localhost.')
    assert.equal(chrome.storage.session.data.cookies[0].partitioned, true)
    await actions.run('cookies', 'set', TAB)
    assert.deepEqual(chrome.calls.set[0].partitionKey, own)
    assert.equal(await actions.run('cookies', 'clear', TAB), 'Cleared 1 cookie on localhost.')
    assert.deepEqual(chrome.jar.map((c) => c.name), ['embedded'])
})

test('a failed save during get all restores the whole previous copy', async () => {
    const chrome = fakeChrome({
        script: () => ({ count: 1, entries: [{ site: 'new' }] }),
        cookies: [cookie({ value: 'new' })],
        failAreaSet: 'session',
    })
    Object.assign(chrome.storage.local.data, { local: [{ site: 'old' }], session: [{ site: 'old' }] })
    chrome.storage.session.data.cookies = [cookie({ value: 'old' })]
    await assert.rejects(createActions(chrome).run('all', 'get', TAB), /previous one was kept: QUOTA/)
    assert.deepEqual(chrome.storage.local.data.local, [{ site: 'old' }])
    assert.deepEqual(chrome.storage.local.data.session, [{ site: 'old' }])
    assert.equal(chrome.storage.session.data.cookies[0].value, 'old')
})

test('a failed first get all leaves no partial copy behind', async () => {
    const chrome = fakeChrome({ script: () => ({ count: 1, entries: [{ site: 'new' }] }), failAreaSet: 'session' })
    await assert.rejects(createActions(chrome).run('all', 'get', TAB), /previous one was kept/)
    assert.deepEqual(chrome.storage.local.data, {})
})

test('hostOf falls back for unparsable URLs', () => {
    assert.equal(hostOf({ url: 'https://a.test/x' }), 'a.test')
    assert.equal(hostOf({}), 'this page')
})
