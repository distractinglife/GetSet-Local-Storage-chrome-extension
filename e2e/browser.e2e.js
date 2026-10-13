// Real-browser tests: Chrome for Testing (installed by puppeteer) loads a copy
// of the extension and the real chrome.* APIs run against local test sites.
// Run with `npm run test:browser`; kept out of `npm test` because it needs the
// ~150 MB browser download.
//
// The permission prompt cannot be clicked in automation, so the fixture copy
// declares, up front, exactly the host patterns requestAccess() would ask for
// (accessPatterns) for each test site. If those patterns are too narrow,
// Chrome filters the cookies and these tests fail.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer'
import { accessPatterns } from '../lib/cookies.js'

const ROOT = new URL('..', import.meta.url).pathname
let server, port, browser, fixture, extensionId, extensionPage, cdp

const site = (host, path = '/') => `http://${host}:${port}${path}`

function buildFixture(urls) {
    const dir = mkdtempSync(join(tmpdir(), 'getset-e2e-'))
    for (const file of ['popup.html', 'popup.js', 'styles.css', 'lib', 'images']) {
        cpSync(join(ROOT, file), join(dir, file), { recursive: true })
    }
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
    manifest.permissions.push('cookies')
    manifest.host_permissions = [...new Set(urls.flatMap(accessPatterns))]
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    return dir
}

// Opens a test site in a tab and returns the puppeteer page.
async function open(url) {
    const page = await browser.newPage()
    await page.goto(url)
    return page
}

// Runs createActions(chrome).run(...) inside the extension against the tab
// showing `url`, returning { message } or { error }.
function run(kind, action, url) {
    return extensionPage.evaluate(
        async (kind, action, url) => {
            const { createActions } = await import('/lib/actions.js')
            const [tab] = await chrome.tabs.query({ url: url.replace(/:\d+/, '') + '*' })
            try {
                return { message: await createActions(chrome).run(kind, action, tab) }
            } catch (error) {
                return { error: error.message }
            }
        },
        kind,
        action,
        url
    )
}

async function setCookies(cookies) {
    await cdp.send('Storage.setCookies', { cookies })
}

async function cookieNames(host) {
    const { cookies } = await cdp.send('Storage.getCookies')
    return cookies
        .filter((c) => c.domain.replace(/^\./, '') === host)
        .map((c) => `${c.name}=${c.value}${c.secure ? ' secure' : ''}${c.path !== '/' ? ` ${c.path}` : ''}`)
        .sort()
}

before(async () => {
    server = createServer((req, res) => {
        res.setHeader('content-type', 'text/html')
        res.end('<!doctype html><title>GetSet test site</title>')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port

    fixture = buildFixture([
        site('staging.example.test'),
        site('localhost'),
        site('dev.internal.test'),
    ])
    browser = await puppeteer.launch({
        headless: true,
        pipe: true,
        enableExtensions: true,
        args: ['--host-resolver-rules=MAP *.test 127.0.0.1'],
    })
    extensionId = await browser.installExtension(fixture)
    extensionPage = await open(`chrome-extension://${extensionId}/popup.html`)
    cdp = await browser.target().createCDPSession()
})

after(async () => {
    await browser?.close()
    server?.close()
    if (fixture) rmSync(fixture, { recursive: true, force: true })
})

test('popup renders every section without errors', async () => {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const kinds = await page.$$eval('[data-kind]', (nodes) => nodes.map((n) => n.dataset.kind))
    assert.deepEqual(kinds, ['local', 'session', 'cookies', 'all'])
    assert.deepEqual(errors, [])
    await page.close()
})

test('get all reads host, path-scoped and Secure parent-domain cookies', async () => {
    const staging = await open(site('staging.example.test', '/app'))
    await staging.evaluate(() => localStorage.setItem('token', 'abc'))
    await setCookies([
        { name: 'host', value: '1', url: 'http://staging.example.test/' },
        { name: 'api', value: '2', url: 'http://staging.example.test/', path: '/api' },
        { name: 'parent', value: '3', domain: '.example.test', path: '/', secure: true },
        { name: 'dup', value: 'host-only', url: 'http://staging.example.test/' },
        { name: 'dup', value: 'parent', domain: '.example.test', path: '/' },
    ])
    const result = await run('all', 'get', site('staging.example.test', '/app'))
    assert.deepEqual(result, {
        message:
            'Got 1 local storage value, 0 session storage values and 5 cookies from staging.example.test.',
    })
})

test('set all onto localhost keeps Secure cookies and the most specific duplicate', async () => {
    const local = await open(site('localhost'))
    const result = await run('all', 'set', site('localhost'))
    assert.deepEqual(result, {
        message:
            'Set 1 local storage value and 4 cookies on localhost. 1 cookie skipped (same name from another domain).',
    })
    assert.equal(await local.evaluate(() => localStorage.getItem('token')), 'abc')
    assert.deepEqual(await cookieNames('localhost'), [
        'api=2 /api',
        'dup=host-only',
        'host=1',
        'parent=3 secure',
    ])
})

test('get, then clear all on localhost see the Secure and /api cookies too', async () => {
    assert.deepEqual(await run('cookies', 'get', site('localhost')), {
        message: 'Got 4 cookies from localhost.',
    })
    assert.deepEqual(await run('all', 'clear', site('localhost')), {
        message: 'Cleared 1 local storage value, 0 session storage values and 4 cookies on localhost.',
    })
    assert.deepEqual(await cookieNames('localhost'), [])
})

test('Secure cookies are not downgraded onto a plain http host', async () => {
    await open(site('dev.internal.test'))
    // The copy in memory is now the 4 localhost cookies from the previous Get.
    const result = await run('cookies', 'set', site('dev.internal.test'))
    assert.deepEqual(result, {
        message: 'Set 3 cookies on dev.internal.test. 1 cookie skipped (Secure, target is not https).',
    })
    assert.deepEqual(await cookieNames('dev.internal.test'), ['api=2 /api', 'dup=host-only', 'host=1'])
})

test('a storage quota failure is reported with progress, not as success', async () => {
    const local = await open(site('localhost', '/quota'))
    const big = 'x'.repeat(3 * 1024 * 1024)
    await extensionPage.evaluate((big) => chrome.storage.local.set({ local: [{ a: big }, { b: big }] }), big)
    const result = await run('local', 'set', site('localhost', '/quota'))
    assert.match(result.error ?? '', /^Stopped after 1 local storage values: /)
    assert.equal(await local.evaluate(() => localStorage.getItem('b')), null)
    await local.evaluate(() => localStorage.clear())
    await local.close()
})

// Runs an action against the tab with this id, given the tab as the popup saw it.
function runOnTab(tab) {
    return extensionPage.evaluate(async (tab) => {
        const { createActions } = await import('/lib/actions.js')
        try {
            return { message: await createActions(chrome).run('local', 'get', tab) }
        } catch (error) {
            return { error: error.message }
        }
    }, tab)
}

async function tabIdOf(url) {
    return extensionPage.evaluate(
        async (pattern) => (await chrome.tabs.query({ url: pattern }))[0].id,
        url.replace(/:\d+/, '') + '*'
    )
}

test('refuses to act when the tab navigated to another site', async () => {
    const page = await open(site('localhost', '/moving'))
    const id = await tabIdOf(site('localhost', '/moving'))
    await page.goto(site('staging.example.test', '/moved'))
    const result = await runOnTab({ id, url: site('localhost', '/moving') })
    assert.deepEqual(result, { error: 'This tab changed to another site. Reopen GetSet and try again.' })
    await page.close()
})

test('browser pages give a readable error', async () => {
    const page = await open(site('localhost', '/blocked'))
    const id = await tabIdOf(site('localhost', '/blocked'))
    await page.goto('chrome://version')
    // On chrome:// pages the popup gets the tab without a URL.
    const result = await runOnTab({ id })
    assert.deepEqual(result, {
        error: 'GetSet cannot access this page. Browser pages and the Web Store are blocked by Chrome.',
    })
    await page.close()
})

// Regressions from the review of 75f46ea (each reproduced in Chrome first).

test('clearing a subdomain keeps a same-named host-only cookie on the parent', async () => {
    await cdp.send('Storage.clearCookies')
    await open(site('staging.example.test', '/parent'))
    await extensionPage.evaluate(async () => {
        await chrome.cookies.set({ url: 'http://example.test/', name: 'sid', value: 'parent-host-only' })
        await chrome.cookies.set({ url: 'http://example.test/', name: 'sid', value: 'shared-domain', domain: '.example.test' })
    })
    const result = await run('cookies', 'clear', site('staging.example.test', '/parent'))
    const { cookies } = await cdp.send('Storage.getCookies')
    assert.deepEqual(result, { message: 'Cleared 1 cookie on staging.example.test.' })
    assert.deepEqual(cookies.map((c) => c.value), ['parent-host-only'])
})

test('partitioned cookies are read, set into the target partition and cleared', async () => {
    await cdp.send('Storage.clearCookies')
    const local = await open(site('localhost', '/partitioned'))
    await local.evaluate(() => {
        document.cookie = 'chips=1; Secure; SameSite=None; Partitioned; Path=/'
    })
    assert.deepEqual(await run('cookies', 'get', site('localhost', '/partitioned')), {
        message: 'Got 1 cookie from localhost.',
    })
    assert.deepEqual(await run('cookies', 'clear', site('localhost', '/partitioned')), {
        message: 'Cleared 1 cookie on localhost.',
    })
    assert.equal((await cdp.send('Storage.getCookies')).cookies.length, 0)
    assert.deepEqual(await run('cookies', 'set', site('localhost', '/partitioned')), {
        message: 'Set 1 cookie on localhost.',
    })
    const [restored] = (await cdp.send('Storage.getCookies')).cookies
    assert.equal(restored.name, 'chips')
    assert.ok(restored.partitionKey, 'written back as a partitioned cookie')
    await cdp.send('Storage.clearCookies')
    await local.close()
})

test('cookies with ? or # in their path are cleared too', async () => {
    await cdp.send('Storage.clearCookies')
    const page = await open(site('localhost', '/odd-paths'))
    await extensionPage.evaluate(async () => {
        for (const path of ['/x?y', '/x#z']) {
            await chrome.cookies.set({ url: 'http://localhost/', name: 'pathcookie', value: '1', path })
        }
    })
    await run('cookies', 'clear', site('localhost', '/odd-paths'))
    assert.deepEqual((await cdp.send('Storage.getCookies')).cookies.map((c) => c.path), [])
    await page.close()
})

test('a quota failure during get all keeps the previous copy together', async () => {
    await cdp.send('Storage.clearCookies')
    const local = await open(site('localhost', '/copy-quota'))
    await extensionPage.evaluate(async () => {
        await chrome.storage.local.clear()
        await chrome.storage.local.set({ local: [{ site: 'old' }], session: [{ site: 'old' }] })
        await chrome.storage.session.set({ cookies: [{ name: 'sid', value: 'old', session: true, hostOnly: true, domain: 'localhost', path: '/' }] })
    })
    await local.evaluate(() => {
        localStorage.clear()
        sessionStorage.clear()
        localStorage.setItem('site', 'new')
        sessionStorage.setItem('site', 'new')
        localStorage.setItem('bulk', '中'.repeat(2 * 1024 * 1024))
        sessionStorage.setItem('bulk', '中'.repeat(2 * 1024 * 1024))
    })
    const result = await run('all', 'get', site('localhost', '/copy-quota'))
    const kept = await extensionPage.evaluate(async () => {
        const { local, session } = await chrome.storage.local.get(['local', 'session'])
        const { cookies } = await chrome.storage.session.get('cookies')
        return { local: local.find((e) => e.site)?.site, session: session.find((e) => e.site)?.site, cookies: cookies[0]?.value }
    })
    assert.match(result.error ?? '', /previous one was kept/)
    assert.deepEqual(kept, { local: 'old', session: 'old', cookies: 'old' })
    await local.evaluate(() => {
        localStorage.clear()
        sessionStorage.clear()
    })
    await local.close()
})
