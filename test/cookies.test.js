import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    accessPatterns,
    appliesToHost,
    isLocalHost,
    planCookieWrites,
    removalUrl,
    toSnapshot,
} from '../lib/cookies.js'

const NOW = 1_800_000_000

function snapshot(overrides = {}) {
    return {
        name: 'sid',
        value: 'v',
        domain: 'example.test',
        hostOnly: true,
        path: '/',
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        session: true,
        ...overrides,
    }
}

test('access covers both schemes, the host and its parent domains', () => {
    assert.deepEqual(accessPatterns('https://staging.app.example.test/login'), [
        'http://staging.app.example.test/*',
        'https://staging.app.example.test/*',
        'http://app.example.test/*',
        'https://app.example.test/*',
        'http://example.test/*',
        'https://example.test/*',
    ])
})

test('access for loopback and IP hosts is the host only, without port', () => {
    assert.deepEqual(accessPatterns('http://localhost:3000/app'), ['http://localhost/*', 'https://localhost/*'])
    assert.deepEqual(accessPatterns('http://192.168.1.20:8080/'), ['http://192.168.1.20/*', 'https://192.168.1.20/*'])
    assert.deepEqual(accessPatterns('http://[::1]:3000/'), ['http://[::1]/*', 'https://[::1]/*'])
})

test('access is refused for non-web pages', () => {
    assert.equal(accessPatterns('chrome://extensions'), null)
    assert.equal(accessPatterns('file:///tmp/a.html'), null)
    assert.equal(accessPatterns('not a url'), null)
})

test('isLocalHost covers loopback names and the whole 127 range', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '[::1]', 'app.localhost']) {
        assert.ok(isLocalHost(host), host)
    }
    for (const host of ['localhost.example.com', '128.0.0.1', '10.0.0.1']) {
        assert.ok(!isLocalHost(host), host)
    }
})

test('appliesToHost ignores path and respects host-only', () => {
    const host = 'staging.example.test'
    assert.ok(appliesToHost({ domain: 'staging.example.test', hostOnly: true, path: '/api' }, host))
    assert.ok(appliesToHost({ domain: '.example.test', hostOnly: false }, host))
    assert.ok(!appliesToHost({ domain: 'example.test', hostOnly: true }, host))
    assert.ok(!appliesToHost({ domain: 'api.staging.example.test', hostOnly: true }, host))
    assert.ok(!appliesToHost({ domain: '.other.test', hostOnly: false }, host))
    assert.ok(!appliesToHost({ domain: '.ample.test', hostOnly: false }, 'example.test'))
})

test('toSnapshot keeps the source domain for collisions, not the store', () => {
    const result = toSnapshot({
        name: 'a', value: 'b', domain: '.example.com', hostOnly: false, path: '/x',
        secure: true, httpOnly: true, sameSite: 'strict', session: false,
        expirationDate: NOW + 10, storeId: '0',
    })
    assert.deepEqual(result, {
        name: 'a', value: 'b', domain: 'example.com', hostOnly: false, path: '/x', secure: true,
        httpOnly: true, sameSite: 'strict', session: false, expirationDate: NOW + 10,
    })
    assert.equal('expirationDate' in toSnapshot({ name: 'a', value: 'b', domain: 'a', session: true }), false)
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

test('keeps Secure on https and on loopback targets', () => {
    const cookie = snapshot({ secure: true, sameSite: 'no_restriction' })
    for (const url of ['https://dev.example.com', 'http://localhost:5173', 'http://127.0.0.2:8000']) {
        const [write] = planCookieWrites([cookie], url, NOW).writes
        assert.equal(write.secure, true, url)
        assert.equal(write.sameSite, 'no_restriction', url)
    }
})

test('never downgrades Secure cookies onto plain http hosts', () => {
    const cookies = [
        snapshot({ name: 'token', secure: true }),
        snapshot({ name: '__Host-sid', secure: true }),
        snapshot({ name: '__Secure-id', secure: true }),
        snapshot({ name: 'plain' }),
    ]
    const { writes, skipped } = planCookieWrites(cookies, 'http://dev.internal:8080', NOW)
    assert.deepEqual(writes.map((w) => w.name), ['plain'])
    assert.deepEqual(skipped.map((s) => s.reason), Array(3).fill('Secure, target is not https'))
})

test('__Host- cookies are always written at path / and Secure', () => {
    const [write] = planCookieWrites(
        [snapshot({ name: '__Host-x', secure: true, path: '/deep' })], 'https://a.test', NOW
    ).writes
    assert.equal(write.path, '/')
    assert.equal(write.url, 'https://a.test/')
    assert.equal(write.secure, true)
})

test('same name and path from different domains keeps the most specific', () => {
    const parent = snapshot({ value: 'parent', domain: 'example.test', hostOnly: false })
    const host = snapshot({ value: 'host', domain: 'staging.example.test', hostOnly: true })
    const middle = snapshot({ value: 'middle', domain: 'app.example.test', hostOnly: false })
    for (const order of [[parent, host, middle], [host, middle, parent], [middle, parent, host]]) {
        const { writes, skipped } = planCookieWrites(order, 'http://localhost:3000', NOW)
        assert.deepEqual(writes.map((w) => w.value), ['host'])
        assert.equal(skipped.length, 2)
        assert.ok(skipped.every((s) => s.reason === 'same name from another domain'))
    }
})

test('same name on different paths are separate cookies', () => {
    const { writes } = planCookieWrites(
        [snapshot({ path: '/' }), snapshot({ path: '/api', hostOnly: false })], 'https://a.test', NOW
    )
    assert.deepEqual(writes.map((w) => w.path), ['/', '/api'])
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
