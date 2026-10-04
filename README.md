# GetSet Local Storage, Session Storage & Cookies

A Chrome extension that copies local storage, session storage and cookies from one site to another.
For example, get the values from a dev/staging/prod URL and set them on localhost.

[Chrome Web Store](https://chromewebstore.google.com/detail/getset-local-storage-sess/ippidodkgapkblnaegmgjhdflkbonoco)

## How it works

1. Open the source site, click **Get**.
2. Open the target site, click **Set**.
3. **Clear** removes all values of that kind on the current site (asks first).

Cookies need per-site access, which Chrome asks for the first time you use them on a site.
Copied cookies are kept in memory (`chrome.storage.session`) and are dropped when the browser closes.
Set writes host-only cookies on the target site. On plain http hosts other than localhost, Secure
cookies are downgraded and `__Host-`/`__Secure-` cookies are skipped, because Chrome cannot store them there.

## Development

Requires Node 20+. No dependencies.

```bash
npm test          # unit tests (node --test)
npm run package   # builds dist/getset-<version>.zip for the Chrome Web Store
```

Load it in Chrome: `chrome://extensions`, turn on Developer mode, **Load unpacked**, pick this folder.

- `lib/page.js` runs inside the page; each function must stay self-contained.
- `lib/cookies.js` is pure cookie logic.
- `lib/actions.js` wires both to the chrome APIs, which are injected so tests can fake them.
- `popup.js` is DOM wiring only.
