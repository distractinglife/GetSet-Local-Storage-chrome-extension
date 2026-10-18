# GetSet: Local Storage, Session Storage & Cookies

Copy a site's local storage, session storage and cookies, then set them on another site in one click.
Built for developers who need their localhost to look exactly like staging or production: the same
logged-in user, feature flags, cached settings and session state, without logging in again or editing
values by hand in DevTools.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/getset-local-storage-sess/ippidodkgapkblnaegmgjhdflkbonoco)

## What it does

| Section | Get | Set | Clear |
|---|---|---|---|
| Local storage | Saves every key of the current site | Writes them onto the current site | Removes all keys of the current site |
| Session storage | Same, for session storage | Same | Same |
| Cookies | Saves the site's cookies, including HttpOnly ones | Writes them onto the current site | Removes the site's cookies |
| All of the above | Get All | Set All | Clear All |

Every action reports what happened, for example "Set 12 local storage values and 4 cookies on
localhost", including anything that was skipped and why. Clear always asks first.

## Common uses

- Reproduce a staging or production bug on localhost with the same user and data.
- Skip the login flow on your local app by reusing a real session from staging.
- Move feature flags, A/B test buckets or onboarding state between environments.
- Reset a site to a clean state with Clear All.

## How to use it

1. Open the source site (for example your staging app) and click **Get All**.
2. Open the target site (for example `http://localhost:3000`) and click **Set All**.
3. Reload the target page.

The individual Get, Set and Clear buttons work the same way for one kind of data at a time.

## Cookies

- **Permission per site.** The first time you use cookies on a site, Chrome asks for access to that
  site and its parent domains. Nothing is requested at install time, and access is only for sites you
  choose. If the popup closes while Chrome asks, open it and click again. If you decline, the
  All buttons still handle local and session storage and say that cookies were skipped.
- **Written as host-only cookies** on the target site, keeping their path and expiry.
- **Secure cookies stay secure.** They are written to https sites and to localhost, and skipped on
  other plain http sites rather than downgraded.
- **Duplicates:** when two copied cookies share a name and path, the more specific one is kept.
- **Incognito** tabs use their own cookies, never your regular ones.
- **Partitioned (CHIPS) cookies** are copied too, and written into the target site's own partition.
- **Clear** removes only the cookies the current site uses, never same-named cookies of a parent site.

## Privacy

Full policy: [PRIVACY.md](PRIVACY.md).

- Everything stays in your browser. Nothing is sent to any server, and there is no tracking.
- Copied cookies are kept in memory only and disappear when the browser closes. Storage values are
  kept in the extension's local storage until you Get again.
- Copied values can include real login tokens. Use test accounts where you can, and clear localhost
  when you are done.

## Development

Requires Node 20+. The extension itself needs Chrome 132 or newer.

```bash
npm test               # unit tests (node --test), no install needed
npm install            # once, for the browser tests (downloads Chrome for Testing, ~150 MB)
npm run test:browser   # loads the extension in Chrome for Testing against local test sites
npm run package        # builds dist/getset-<version>.zip for the Chrome Web Store
```

Load it in Chrome: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick
this folder. After changing `manifest.json`, click the extension's reload button; popup changes apply
the next time you open the popup.

The browser tests cannot click Chrome's permission prompt, so they load a copy of the extension that
declares exactly the host patterns GetSet requests at runtime. Incognito is only covered by unit tests.

Code layout:

- `lib/page.js` runs inside the page; each function must stay self-contained.
- `lib/cookies.js` is pure cookie logic.
- `lib/actions.js` wires both to the chrome APIs, which are injected so tests can fake them.
- `popup.js` is DOM wiring only.

## Contributing

Issues and pull requests are welcome:
[report an issue](https://github.com/distractinglife/GetSet-Local-Storage-chrome-extension/issues).
Cookie support in 0.3.0 builds on an idea from [@edifierx666](https://github.com/edifierx666).

## License

[MIT](License.md)
