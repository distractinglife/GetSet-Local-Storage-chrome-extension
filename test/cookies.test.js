import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostPattern, isLocalHost, planCookieWrites, removalUrl, toSnapshot } from '../lib/cookies.js'

const NOW = 1_800_000_000

function snapshot(overrides = {}) {
    return {
        name: 'sid',
        value: 'v',
        path: '/',
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        session: true,
        ...overrides,
    }
}

test('hostPattern drops the port and rejects non-web pages', () => {
    assert.equal(hostPattern('http://localhost:3000/app?x=1'), 'http://localhost/*')
    assert.equal(hostPattern('https://staging.example.com/'), 'https://staging.example.com/*')
    assert.equal(hostPattern('chrome://extensions'), null)
    assert.equal(hostPattern('file:///tmp/a.html'), null)
    assert.equal(hostPattern('not a url'), null)
})

test('isLocalHost covers loopback names', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
        assert.ok(isLocalHost(host), host)
    }
    assert.ok(!isLocalHost('localhost.example.com'))
})

test('toSnapshot keeps what Set needs and drops the source domain', () => {
    const result = toSnapshot({
        name: 'a', value: 'b', domain: '.example.com', hostOnly: false, path: '/x',
        secure: true, httpOnly: true, sameSite: 'strict', session: false,
        expirationDate: NOW + 10, storeId: '0',
    })
    assert.deepEqual(result, {
        name: 'a', value: 'b', path: '/x', secure: true, httpOnly: true,
        sameSite: 'strict', session: false, expirationDate: NOW + 10,
    })
    assert.equal('expirationDate' in toSnapshot({ name: 'a', value: 'b', session: true }), false)
})

test('writes host-only cookies on the target origin, port included', () => {
    const { writes, skipped } = planCookieWrites([snapshot({ path: '/api' })], 'http://localhost:3000/login', NOW)
    assert.deepEqual(skipped, [])
    assert.deepEqual(writes, [{
        url: 'http://localhost:3000/api', name: 'sid', value: 'v', path: '/api',
        secure: false, httpOnly: true, sameSite: 'lax',
    }])
    assert.equal('domain' in writes[0], false)
})

test('keeps Secure on https and on localhost', () => {
    const cookie = snapshot({ secure: true, sameSite: 'no_restriction' })
    for (const url of ['https://dev.example.com', 'http://localhost:5173']) {
        const [write] = planCookieWrites([cookie], url, NOW).writes
        assert.equal(write.secure, true, url)
        assert.equal(write.sameSite, 'no_restriction', url)
    }
})

test('downgrades Secure and SameSite=None on plain http hosts', () => {
    const [write] = planCookieWrites(
        [snapshot({ secure: true, sameSite: 'no_restriction' })], 'http://dev.internal:8080', NOW
    ).writes
    assert.equal(write.secure, false)
    assert.equal(write.sameSite, 'lax')
})

test('prefixed cookies need a secure target', () => {
    const cookies = [
        snapshot({ name: '__Host-sid', secure: true, path: '/' }),
        snapshot({ name: '__Secure-id', secure: true }),
    ]
    const http = planCookieWrites(cookies, 'http://dev.internal', NOW)
    assert.equal(http.writes.length, 0)
    assert.deepEqual(http.skipped.map((s) => s.reason), ['needs https', 'needs https'])

    const local = planCookieWrites(cookies, 'http://localhost:3000', NOW)
    assert.equal(local.writes.length, 2)
    assert.ok(local.writes.every((w) => w.secure))
})

test('__Host- cookies are always written at path /', () => {
    const [write] = planCookieWrites(
        [snapshot({ name: '__Host-x', secure: true, path: '/deep' })], 'https://a.test', NOW
    ).writes
    assert.equal(write.path, '/')
    assert.equal(write.url, 'https://a.test/')
})

test('keeps persistent expiry and skips expired cookies', () => {
    const { writes, skipped } = planCookieWrites([
        snapshot({ name: 'live', session: false, expirationDate: NOW + 60 }),
        snapshot({ name: 'dead', session: false, expirationDate: NOW - 1 }),
        snapshot({ name: 'broken', session: false }),
    ], 'https://a.test', NOW)
    assert.deepEqual(writes.map((w) => [w.name, w.expirationDate]), [['live', NOW + 60]])
    assert.deepEqual(skipped.map((s) => s.name), ['dead', 'broken'])
})

test('removalUrl matches the cookie domain and scheme', () => {
    assert.equal(removalUrl({ domain: '.example.com', path: '/', secure: true }), 'https://example.com/')
    assert.equal(removalUrl({ domain: 'localhost', path: '/api', secure: false }), 'http://localhost/api')
})
