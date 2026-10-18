// Pure cookie helpers, free of chrome.* so they run under node --test.

// Chrome treats loopback hosts as a secure context, so Secure cookies can be
// set on http://localhost even though the scheme is http.
export function isLocalHost(hostname) {
    return (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname === '[::1]' ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    )
}

function isIpAddress(hostname) {
    return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

// Host permissions needed to read, set and clear every cookie of a page.
// Chrome only returns a cookie when the extension has access to the cookie's
// own domain, with the scheme implied by its Secure flag (https if Secure).
// So both schemes are requested, for the host and every parent domain a
// cookie could be scoped to (staging.example.com -> example.com). Without a
// public suffix list this can include a suffix like co.uk; browsers never
// store cookies there, so that pattern grants nothing extra.
// Match patterns cannot include a port. Returns null for non-web pages.
export function accessPatterns(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = parsed.hostname
    const domains = [host]
    if (!isIpAddress(host) && !isLocalHost(host)) {
        const labels = host.split('.')
        for (let i = 1; i < labels.length - 1; i++) domains.push(labels.slice(i).join('.'))
    }
    return domains.flatMap((domain) => [`http://${domain}/*`, `https://${domain}/*`])
}

function cookieDomain(cookie) {
    return cookie.domain.replace(/^\./, '')
}

// Whether a cookie belongs to a page, ignoring path: host-only cookies must
// match the host exactly, domain cookies also apply to subdomains. A
// partitioned (CHIPS) cookie only belongs when it was set in the page's own
// top-level partition, not while the host was embedded in another site.
export function appliesToHost(cookie, host, pagePartition) {
    const domain = cookieDomain(cookie)
    const hostMatches = cookie.hostOnly ? domain === host : host === domain || host.endsWith(`.${domain}`)
    if (!hostMatches) return false
    if (!cookie.partitionKey) return true
    return (
        Boolean(pagePartition) &&
        cookie.partitionKey.topLevelSite === pagePartition.topLevelSite &&
        !cookie.partitionKey.hasCrossSiteAncestor
    )
}

// Keeps the source domain only to resolve name collisions on Set; Set always
// writes host-only cookies on the target.
export function toSnapshot(cookie) {
    const snapshot = {
        name: cookie.name,
        value: cookie.value,
        domain: cookieDomain(cookie),
        hostOnly: Boolean(cookie.hostOnly),
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'unspecified',
        session: Boolean(cookie.session),
        partitioned: Boolean(cookie.partitionKey),
    }
    if (!snapshot.session) snapshot.expirationDate = cookie.expirationDate
    return snapshot
}

// The browser prefers the more specific cookie, so on a collision the
// host-only one wins, then the longest domain.
function specificity(cookie) {
    return cookie.hostOnly ? Infinity : (cookie.domain ?? '').length
}

// Turns saved snapshots into chrome.cookies.set details for the target page.
// Secure cookies (and __Host-/__Secure- ones) are skipped on plain http hosts
// other than loopback: dropping Secure would send login tokens unencrypted.
// Two source cookies that become the same host-only name and path keep only
// the most specific one; the other is reported as skipped. Partitioned
// cookies are written into the target page's own partition, which the caller
// passes in; without it they are skipped.
export function planCookieWrites(snapshots, targetUrl, now = Date.now() / 1000, targetPartition = null) {
    const target = new URL(targetUrl)
    const secureContext = target.protocol === 'https:' || isLocalHost(target.hostname)
    const chosen = new Map()
    const skipped = []
    for (const cookie of snapshots) {
        if (!cookie.session && !(cookie.expirationDate > now)) {
            skipped.push({ name: cookie.name, reason: 'expired' })
            continue
        }
        const hostPrefixed = cookie.name.startsWith('__Host-')
        if (cookie.partitioned && !targetPartition) {
            skipped.push({ name: cookie.name, reason: 'partitioned' })
            continue
        }
        const secure = cookie.secure || cookie.partitioned || hostPrefixed || cookie.name.startsWith('__Secure-')
        if (secure && !secureContext) {
            skipped.push({ name: cookie.name, reason: 'Secure, target is not https' })
            continue
        }
        const path = hostPrefixed ? '/' : cookie.path
        // A partitioned and an unpartitioned cookie with the same name are separate cookies.
        const key = `${cookie.name}\n${path}\n${cookie.partitioned ? 'p' : ''}`
        const existing = chosen.get(key)
        if (existing) {
            const keepNew = specificity(cookie) > specificity(existing.cookie)
            skipped.push({ name: cookie.name, reason: 'same name from another domain' })
            if (!keepNew) continue
        }
        chosen.set(key, { cookie, path, secure })
    }
    const writes = [...chosen.values()].map(({ cookie, path, secure }) => {
        const details = {
            url: `${target.origin}${path}`,
            name: cookie.name,
            value: cookie.value,
            path,
            secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
        }
        if (!cookie.session) details.expirationDate = cookie.expirationDate
        if (cookie.partitioned) details.partitionKey = targetPartition
        return details
    })
    return { writes, skipped }
}

// chrome.cookies.remove deletes every cookie with this name that would be sent
// to the URL. Using the page's own host (not the cookie's parent domain) keeps
// a same-named host-only cookie on the parent domain out of it; every cookie
// the URL can match here belongs to the page anyway.
export function removalUrl(cookie, pageHost) {
    return `${cookie.secure ? 'https' : 'http'}://${pageHost}${cookie.path}`
}
