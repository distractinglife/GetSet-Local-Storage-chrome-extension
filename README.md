# GetSet Local Storage, Session Storage & Cookies

A Chrome extension that copies local storage, session storage and cookies from one site to another.
For example, get the values from a dev/staging/prod URL and set them on localhost.

[Chrome Web Store](https://chromewebstore.google.com/detail/getset-local-storage-sess/ippidodkgapkblnaegmgjhdflkbonoco)

## How it works

1. Open the source site, click **Get**.
2. Open the target site, click **Set**.
3. **Clear** removes all values of that kind on the current site (asks first).

Cookies need access to the site and its parent domains (both http and https), which Chrome asks
for the first time you use them on a site. Copied cookies are kept in memory (`chrome.storage.session`)
and are dropped when the browser closes. Incognito tabs use their own cookie store.

Set writes host-only cookies on the target site. Secure cookies (including `__Host-`/`__Secure-`) are
only written to https or localhost targets, never downgraded to plain http. When two copied cookies
share a name and path, the more specific one (host-only, then longest domain) is kept.

## Development

Requires Node 20+.

```bash
npm test               # unit tests (node --test), no install needed
npm install            # once, for the browser tests (downloads Chrome for Testing, ~150 MB)
npm run test:browser   # loads the extension in Chrome for Testing against local test sites
npm run package        # builds dist/getset-<version>.zip for the Chrome Web Store
```

The browser tests cannot click Chrome's permission prompt, so they load a copy of the extension that
declares exactly the host patterns GetSet requests at runtime. Incognito is only covered by unit tests.

Load it in Chrome: `chrome://extensions`, turn on Developer mode, **Load unpacked**, pick this folder.

- `lib/page.js` runs inside the page; each function must stay self-contained.
- `lib/cookies.js` is pure cookie logic.
- `lib/actions.js` wires both to the chrome APIs, which are injected so tests can fake them.
- `popup.js` is DOM wiring only.
