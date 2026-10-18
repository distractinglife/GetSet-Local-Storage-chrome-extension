// Renders the Chrome Web Store screenshots (1280x800) and the small promo
// tile (440x280) from the real popup.html and styles.css.
// Run: node store/render.mjs  (needs `npm install` for puppeteer)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'store')
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8')
const icon = `data:image/png;base64,${readFileSync(join(ROOT, 'images/favicon128x128.png')).toString('base64')}`
const popupHtml = readFileSync(join(ROOT, 'popup.html'), 'utf8')
    .replace(/<script[^>]*><\/script>/, '')
    .replace('./images/favicon128x128.png', icon)
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)

// One popup state, as the user would see it after an action.
function popup({ site, status, error = false, panel = null }) {
    let html = popupHtml.replace('<p class="site" id="site" hidden></p>', `<p class="site" id="site">On ${site}</p>`)
    if (status) {
        html = html.replace(
            '<p class="status" id="status" role="status" aria-live="polite"></p>',
            `<p class="status${error ? ' error' : ''}" id="status">${status}</p>`
        )
    }
    if (panel) {
        html = html
            .replace(`<div class="panel" id="${panel}" hidden>`, `<div class="panel" id="${panel}">`)
            .replace(`<div class="panel links" id="${panel}" hidden>`, `<div class="panel links" id="${panel}">`)
            .replace(`class="tab" data-panel="${panel}"`, `class="tab active" data-panel="${panel}"`)
    }
    return html
}

const page = (body, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; width: 1280px; height: 800px; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111;
  background: #f9f960; }
.wrap { display: flex; align-items: center; gap: 64px; height: 100%; padding: 0 80px; }
.copy { flex: 1; }
.kicker { font-size: 20px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 18px; opacity: .7; }
h1 { font-size: 60px; line-height: 1.05; margin: 0 0 24px; letter-spacing: -0.02em; }
.lead { font-size: 26px; line-height: 1.4; margin: 0; max-width: 560px; }
ul { list-style: none; padding: 0; margin: 28px 0 0; font-size: 23px; line-height: 1.45; }
li { padding-left: 34px; position: relative; margin-bottom: 12px; }
li::before { content: ''; position: absolute; left: 0; top: 9px; width: 16px; height: 16px; border-radius: 50%; background: #111; }
.shot { border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.28), 0 0 0 2px #111; background: #fff; }
.shot iframe { display: block; border: 0; width: 320px; transform-origin: 0 0; }
${extra}
</style></head><body>${body}</body></html>`

// Embeds a popup state scaled up, sized to its real height.
const frame = (id, scale) =>
    `<div class="shot" data-frame="${id}" data-scale="${scale}"><iframe id="${id}"></iframe></div>`

const shots = [
    {
        file: '1-get-all.png',
        frames: { a: popup({ site: 'staging.acme.dev', status: 'Got 18 local storage values, 3 session storage values and 6 cookies from staging.acme.dev.' }) },
        html: page(`<div class="wrap"><div class="copy">
            <div class="kicker">GetSet for Chrome</div>
            <h1>Make localhost look exactly like staging</h1>
            <p class="lead">Copy local storage, session storage and cookies from any site, then set them on another in one click.</p>
            </div>${frame('a', 1.25)}</div>`),
    },
    {
        file: '2-set-all-on-localhost.png',
        frames: { a: popup({ site: 'localhost', status: 'Set 18 local storage values, 3 session storage values and 6 cookies on localhost.' }) },
        html: page(`<div class="wrap"><div class="copy">
            <div class="kicker">Same state everywhere</div>
            <h1>Staging's data. On your dev server.</h1>
            <ul><li>Feature flags, carts, settings and app state</li><li>Works on any port, http or https</li><li>Every action tells you exactly what changed</li></ul>
            </div>${frame('a', 1.25)}</div>`),
    },
    {
        file: '3-three-steps.png',
        frames: {
            a: popup({ site: 'staging.acme.dev', status: 'Got 18 local storage values, 3 session storage values and 6 cookies from staging.acme.dev.' }),
            b: popup({ site: 'localhost', status: 'Set 18 local storage values, 3 session storage values and 6 cookies on localhost.' }),
        },
        html: page(`<div class="steps">
            <h1>Three clicks from staging to localhost</h1>
            <div class="row">
              <div class="step"><div class="num">1</div><p>Get All on staging</p>${frame('a', 0.88)}</div>
              <div class="chev"></div>
              <div class="step"><div class="num">2</div><p>Set All on localhost</p>${frame('b', 0.88)}</div>
              <div class="chev"></div>
              <div class="step done"><div class="num">3</div><p>Reload. Same state.</p><div class="check"></div></div>
            </div></div>`, `
            .steps { padding: 52px 70px 0; text-align: center; }
            .steps h1 { font-size: 46px; margin-bottom: 30px; }
            .row { display: flex; align-items: flex-start; justify-content: center; gap: 26px; }
            .step { display: flex; flex-direction: column; align-items: center; }
            .step p { font-size: 22px; font-weight: 700; margin: 10px 0 16px; }
            .num { width: 44px; height: 44px; border-radius: 50%; background: #111; color: #f9f960; font-size: 24px; font-weight: 800; line-height: 44px; }
            .chev { width: 34px; height: 34px; border-top: 7px solid #111; border-right: 7px solid #111; transform: rotate(45deg); margin-top: 300px; }
            .done { width: 340px; }
            .check { width: 200px; height: 200px; border-radius: 50%; background: #111; position: relative; margin-top: 90px; }
            .check::after { content: ''; position: absolute; left: 62px; top: 46px; width: 50px; height: 90px; border-right: 16px solid #f9f960; border-bottom: 16px solid #f9f960; transform: rotate(45deg); }`),
    },
    {
        file: '4-smart-cookies.png',
        frames: { a: popup({ site: 'localhost', status: 'Set 6 cookies on localhost.' }) },
        html: page(`<div class="wrap"><div class="copy">
            <div class="kicker">Cookies</div>
            <h1>Copies cookies other tools miss</h1>
            <ul><li>Copies every cookie a site uses, even the hidden ones</li><li>Keeps secure cookies secure</li><li>Works on localhost, any port</li><li>Incognito stays separate from your normal browsing</li></ul>
            </div>${frame('a', 1.25)}</div>`),
    },
    {
        file: '5-private-by-design.png',
        frames: { a: popup({ site: 'localhost', panel: 'infoPanel' }) },
        html: page(`<div class="wrap"><div class="copy">
            <div class="kicker">Private by design</div>
            <h1>Nothing leaves your browser</h1>
            <ul><li>No servers, no accounts, no tracking</li><li>Cookie access asked once per site, only when you use it</li><li>Copied cookies live in memory and vanish when Chrome closes</li><li>Open source under MIT</li></ul>
            </div>${frame('a', 1.0)}</div>`),
    },
]

const tile = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; width: 440px; height: 280px; overflow: hidden; background: #f9f960; color: #111;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex; flex-direction: column; justify-content: center; padding: 0 34px; box-sizing: border-box; }
.top { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
img { width: 72px; height: 72px; border-radius: 14px; box-shadow: 0 0 0 2px #111; }
.name { font-size: 46px; font-weight: 800; letter-spacing: -0.02em; }
.line { font-size: 23px; font-weight: 600; line-height: 1.3; }
.sub { font-size: 16px; margin-top: 10px; opacity: .75; }
</style></head><body>
<div class="top"><img src="${icon}"><div class="name">GetSet</div></div>
<div class="line">Copy local storage, session storage &amp; cookies to localhost</div>
<div class="sub">One click. Nothing leaves your browser.</div>
</body></html>`

const marqueePopup = popup({ site: 'localhost', status: 'Set 18 local storage values, 3 session storage values and 6 cookies on localhost.' })
const marquee = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; width: 1400px; height: 560px; overflow: hidden; background: #f9f960; color: #111;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.wrap { display: flex; align-items: center; justify-content: space-between; height: 100%; padding: 0 110px; }
.top { display: flex; align-items: center; gap: 22px; margin-bottom: 26px; }
img { width: 96px; height: 96px; border-radius: 20px; box-shadow: 0 0 0 3px #111; }
.name { font-size: 68px; font-weight: 800; letter-spacing: -0.02em; }
h1 { font-size: 48px; line-height: 1.1; margin: 0 0 18px; letter-spacing: -0.01em; max-width: 680px; }
p { font-size: 24px; margin: 0; opacity: .8; }
.shot { border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.28), 0 0 0 2px #111; background: #fff; }
.shot iframe { display: block; border: 0; width: 320px; transform-origin: 0 0; }
</style></head><body><div class="wrap"><div>
<div class="top"><img src="${icon}"><div class="name">GetSet</div></div>
<h1>Copy local storage, session storage and cookies to localhost</h1>
<p>One click. Nothing leaves your browser.</p>
</div><div class="shot" data-scale="0.8"><iframe id="m"></iframe></div></div></body></html>`

mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({ headless: true })
const tab = await browser.newPage()

for (const shot of shots) {
    await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    await tab.setContent(shot.html)
    for (const [id, html] of Object.entries(shot.frames)) {
        // Load the popup, measure its real height, then scale the frame.
        await tab.evaluate(
            (id, html) =>
                new Promise((resolve) => {
                    const iframe = document.getElementById(id)
                    iframe.onload = () => {
                        const holder = iframe.parentElement
                        const scale = Number(holder.dataset.scale)
                        const height = iframe.contentDocument.documentElement.scrollHeight
                        iframe.style.height = `${height}px`
                        iframe.style.transform = `scale(${scale})`
                        holder.style.width = `${320 * scale}px`
                        holder.style.height = `${height * scale}px`
                        resolve()
                    }
                    iframe.srcdoc = html
                }),
            id,
            html
        )
    }
    await tab.screenshot({ path: join(OUT, shot.file), type: 'png', omitBackground: false })
    console.log(join(OUT, shot.file))
}

await tab.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 })
await tab.setContent(tile)
await tab.screenshot({ path: join(OUT, 'promo-tile-440x280.png'), type: 'png' })
console.log(join(OUT, 'promo-tile-440x280.png'))
await tab.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 })
await tab.setContent(marquee)
await tab.evaluate(
    (html) =>
        new Promise((resolve) => {
            const iframe = document.getElementById('m')
            iframe.onload = () => {
                const holder = iframe.parentElement
                const scale = Number(holder.dataset.scale)
                const height = iframe.contentDocument.documentElement.scrollHeight
                iframe.style.height = `${height}px`
                iframe.style.transform = `scale(${scale})`
                holder.style.width = `${320 * scale}px`
                holder.style.height = `${height * scale}px`
                resolve()
            }
            iframe.srcdoc = html
        }),
    marqueePopup
)
await tab.screenshot({ path: join(OUT, 'marquee-1400x560.png'), type: 'png' })
console.log(join(OUT, 'marquee-1400x560.png'))
await browser.close()
