// Pure cookie helpers, free of chrome.* so they run under node --test.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// Chrome treats localhost as a secure context, so Secure cookies can be set on
// http://localhost even though the scheme is http.
export function isLocalHost(hostname) {
    return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

// Match patterns cannot include a port, so access is requested per host.
// Returns null for pages that have no cookies (chrome://, file://, etc).
export function hostPattern(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.hostname}/*`
}

// Only the fields needed to recreate the cookie on another host. The source
// domain is dropped on purpose: Set always writes host-only cookies.
export function toSnapshot(cookie) {
    const snapshot = {
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'unspecified',
        session: Boolean(cookie.session),
    }
    if (!snapshot.session) snapshot.expirationDate = cookie.expirationDate
    return snapshot
}

// Turns saved snapshots into chrome.cookies.set details for the target page.
// On a plain http host (not localhost) Secure cookies are downgraded so they
// can be stored at all, and SameSite=None becomes Lax because Chrome rejects
// SameSite=None without Secure. Prefixed cookies cannot be downgraded.
export function planCookieWrites(snapshots, targetUrl, now = Date.now() / 1000) {
    const target = new URL(targetUrl)
    const secureContext =
        target.protocol === 'https:' || isLocalHost(target.hostname)
    const writes = []
    const skipped = []
    for (const cookie of snapshots) {
        if (!cookie.session && !(cookie.expirationDate > now)) {
            skipped.push({ name: cookie.name, reason: 'expired' })
            continue
        }
        const hostPrefixed = cookie.name.startsWith('__Host-')
        const securePrefixed = cookie.name.startsWith('__Secure-')
        if ((hostPrefixed || securePrefixed) && !secureContext) {
            skipped.push({ name: cookie.name, reason: 'needs https' })
            continue
        }
        const secure = hostPrefixed || securePrefixed || (cookie.secure && secureContext)
        const path = hostPrefixed ? '/' : cookie.path
        const details = {
            url: `${target.origin}${path}`,
            name: cookie.name,
            value: cookie.value,
            path,
            secure,
            httpOnly: cookie.httpOnly,
            sameSite:
                cookie.sameSite === 'no_restriction' && !secure ? 'lax' : cookie.sameSite,
        }
        if (!cookie.session) details.expirationDate = cookie.expirationDate
        writes.push(details)
    }
    return { writes, skipped }
}

// chrome.cookies.remove needs a URL that matches the cookie's own domain and path.
export function removalUrl(cookie) {
    const domain = cookie.domain.replace(/^\./, '')
    return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`
}
