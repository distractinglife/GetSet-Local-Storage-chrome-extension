// Builds the demo video scene: one 1920x1080 page whose window.render(t)
// draws the frame at time t (seconds). Deterministic, so every frame can be
// captured exactly. Uses the real popup.html and styles.css.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8')
const icon = `data:image/png;base64,${readFileSync(join(ROOT, 'images/favicon128x128.png')).toString('base64')}`
const popupHtml = readFileSync(join(ROOT, 'popup.html'), 'utf8')
    .replace(/<script[^>]*><\/script>/, '')
    .replace('./images/favicon128x128.png', icon)
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${css} body{overflow:hidden}</style>`)

function popup(site, status) {
    let html = popupHtml.replace('<p class="site" id="site" hidden></p>', `<p class="site" id="site">On ${site}</p>`)
    if (status) html = html.replace('<p class="status" id="status" role="status" aria-live="polite"></p>', `<p class="status" id="status">${status}</p>`)
    return html
}

export const DURATION = 26

export const popups = {
    stagingIdle: popup('staging.acme.dev'),
    stagingGot: popup('staging.acme.dev', 'Got 18 local storage values, 3 session storage values and 6 cookies from staging.acme.dev.'),
    localIdle: popup('localhost'),
    localSet: popup('localhost', 'Set 18 local storage values, 3 session storage values and 6 cookies on localhost.'),
}

export const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #f9f960; color: #111;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position: relative; }
.layer { position: absolute; inset: 0; }
.card { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.card img { width: 150px; height: 150px; border-radius: 32px; box-shadow: 0 0 0 4px #111; margin-bottom: 34px; }
.card h1 { font-size: 92px; margin: 0 0 18px; letter-spacing: -0.02em; }
.card p { font-size: 40px; margin: 0; max-width: 1300px; line-height: 1.3; }
.card .small { font-size: 30px; margin-top: 26px; opacity: .7; }
.browser { position: absolute; left: 110px; top: 70px; width: 1700px; height: 860px; background: #fff; border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0,0,0,.3), 0 0 0 2px #111; overflow: hidden; }
.tabs { height: 52px; background: #dee1e6; display: flex; align-items: flex-end; padding: 0 14px; gap: 6px; }
.dots { display: flex; gap: 9px; margin: 0 18px 18px 6px; }
.dots i { width: 14px; height: 14px; border-radius: 50%; background: #ff5f57; display: block; }
.dots i:nth-child(2) { background: #febc2e; } .dots i:nth-child(3) { background: #28c840; }
.tab { width: 260px; height: 40px; border-radius: 10px 10px 0 0; padding: 0 16px; font-size: 18px; line-height: 40px; color: #444; }
.tab.on { background: #fff; color: #111; }
.bar { height: 58px; display: flex; align-items: center; gap: 16px; padding: 0 18px; border-bottom: 1px solid #ddd; }
.nav { font-size: 26px; color: #555; width: 30px; text-align: center; }
.url { flex: 1; height: 38px; border-radius: 19px; background: #f1f3f4; font-size: 19px; line-height: 38px; padding: 0 20px; color: #222; }
.ext { width: 36px; height: 36px; border-radius: 8px; }
.content { position: absolute; top: 110px; left: 0; right: 0; bottom: 0; }
.app { position: absolute; inset: 0; background: #f6f7fb; }
.apphead { height: 74px; background: #1f2a44; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; font-size: 26px; font-weight: 700; }
.user { font-size: 20px; font-weight: 500; background: rgba(255,255,255,.14); padding: 9px 18px; border-radius: 20px; }
.cards { display: flex; gap: 30px; padding: 40px; }
.tile { flex: 1; height: 180px; background: #fff; border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.08); padding: 26px; font-size: 22px; color: #555; }
.tile b { display: block; font-size: 46px; color: #111; margin-top: 12px; }
.env { position: absolute; right: 40px; bottom: 30px; font-size: 18px; color: #999; }
.popup { position: absolute; top: 112px; right: 30px; width: 384px; border-radius: 12px; overflow: hidden;
  box-shadow: 0 16px 40px rgba(0,0,0,.3), 0 0 0 1px #999; background: #fff; transform-origin: top right; }
.popup iframe { display: none; border: 0; width: 320px; height: 600px; transform: scale(1.2); transform-origin: 0 0; }
.caption { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; font-size: 44px; font-weight: 800; }
.caption span { background: #111; color: #f9f960; padding: 10px 28px; border-radius: 14px; }
.cursor { position: absolute; width: 34px; height: 46px; pointer-events: none; z-index: 10; }
.ripple { position: absolute; width: 70px; height: 70px; margin: -35px 0 0 -35px; border-radius: 50%; border: 5px solid #111; z-index: 9; opacity: 0; }
.blank { position: absolute; inset: 0; background: #fff; }
</style></head><body>
<div class="layer card" id="intro"><img src="${icon}"><h1>GetSet</h1><p>Make localhost match staging: copy local storage, session storage and cookies</p></div>
<div class="browser" id="browser">
  <div class="tabs"><div class="dots"><i></i><i></i><i></i></div><div class="tab" id="tab1">Acme - Staging</div><div class="tab" id="tab2">Acme - localhost:3000</div></div>
  <div class="bar"><div class="nav">&#8249;</div><div class="nav">&#8250;</div><div class="nav" id="reload">&#8635;</div><div class="url" id="url"></div><img class="ext" id="ext" src="${icon}"></div>
  <div class="content">
    <div class="app" id="app"><div class="apphead">Acme Shop<span class="user" id="theme"></span></div>
      <div class="cards"><div class="tile">Cart<b id="cart"></b></div><div class="tile">Feature flags<b id="flags"></b></div><div class="tile">Saved filters<b id="filters"></b></div></div>
      <div class="env" id="env"></div></div>
    <div class="blank" id="blank"></div>
  </div>
  <div class="popup" id="popup">
    <iframe id="stagingIdle"></iframe><iframe id="stagingGot"></iframe><iframe id="localIdle"></iframe><iframe id="localSet"></iframe>
  </div>
</div>
<div class="caption" id="caption"><span id="captionText"></span></div>
<div class="layer card" id="outro"><img src="${icon}"><h1>GetSet</h1><p>Local storage, session storage and cookies. One click.</p><p class="small">Free on the Chrome Web Store &middot; Nothing leaves your browser</p></div>
<svg class="cursor" id="cursor" viewBox="0 0 24 32"><path d="M2 2 L2 26 L8 20 L12 30 L16 28 L12 18 L20 18 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
<div class="ripple" id="ripple"></div>
<script>
const $ = (id) => document.getElementById(id)
const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
const fade = (t, a, b, d = 0.4) => Math.min(ease((t - a) / d), 1 - ease((t - b) / d))

// Points the cursor visits, in page coordinates, and when it gets there.
const BROWSER = { x: 110, y: 70 }
const P = {
  start: [1500, 700], ext: [1752, 157], getAll: [1592 - 0, 0], tab2: [500, 112], reload: [215, 157], rest: [1300, 800],
}
// Button positions inside the popup (scaled 1.2, popup top-right at browser x=1290,y=112).
const popupX = BROWSER.x + 1700 - 30 - 384, popupY = BROWSER.y + 112
const GETALL = [popupX + 1.2 * 60, popupY + 1.2 * 357]
const SETALL = [popupX + 1.2 * 160, popupY + 1.2 * 357]
P.getAll = GETALL; P.setAll = SETALL
P.ext = [BROWSER.x + 1700 - 18 - 18, BROWSER.y + 52 + 29]
P.tab2 = [BROWSER.x + 14 + 18 + 14 + 9 * 2 + 18 + 260 + 6 + 130, BROWSER.y + 32]
P.reload = [BROWSER.x + 18 + 30 + 16 + 30 + 16 + 15, BROWSER.y + 52 + 29]

const path = [
  [3.0, P.start], [4.6, P.ext], [6.0, P.ext], [7.2, P.getAll], [9.6, P.getAll], [10.8, P.tab2],
  [12.2, P.tab2], [13.4, P.ext], [14.4, P.ext], [15.4, P.setAll], [17.6, P.setAll], [18.6, P.reload], [21.5, P.reload], [22.5, P.rest],
]
const clicks = [4.7, 7.3, 10.9, 13.5, 15.5, 18.7]

function cursorAt(t) {
  if (t <= path[0][0]) return path[0][1]
  for (let i = 1; i < path.length; i++) {
    const [t1, p1] = path[i], [t0, p0] = path[i - 1]
    if (t <= t1) { const k = ease((t - t0) / (t1 - t0)); return [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k] }
  }
  return path[path.length - 1][1]
}

window.render = (t) => {
  $('intro').style.opacity = 1 - ease((t - 2.4) / 0.5)
  $('outro').style.opacity = ease((t - 22.8) / 0.6)
  const inBrowser = t > 2.4 && t < 23.4
  $('browser').style.opacity = fade(t, 2.4, 22.8, 0.5)
  $('cursor').style.opacity = t > 2.8 && t < 22.8 ? 1 : 0

  const onLocal = t >= 11.0
  $('tab1').className = 'tab' + (onLocal ? '' : ' on')
  $('tab2').className = 'tab' + (onLocal ? ' on' : '')
  $('url').textContent = onLocal ? 'localhost:3000/shop' : 'https://staging.acme.dev/shop'
  $('env').textContent = onLocal ? 'Local development' : 'Staging'
  // Localhost starts empty; after Set All and a reload it shows the same state as staging.
  const copied = !onLocal || t >= 19.3
  $('cart').textContent = copied ? '3 items' : 'Empty'
  $('flags').textContent = copied ? 'new-checkout' : 'None'
  $('filters').textContent = copied ? '4 saved' : 'None'
  $('theme').textContent = copied ? 'Dark mode, EUR' : 'Default settings'
  $('blank').style.opacity = t > 18.8 && t < 19.3 ? 1 : 0

  // Popup: opens on the icon click, shows the result, closes before switching tabs / reloading.
  const open1 = t >= 4.8 && t < 10.6, open2 = t >= 13.6 && t < 18.5
  const which = open1 ? (t >= 7.4 ? 'stagingGot' : 'stagingIdle') : open2 ? (t >= 15.6 ? 'localSet' : 'localIdle') : null
  for (const id of ['stagingIdle', 'stagingGot', 'localIdle', 'localSet']) $(id).style.display = id === which ? 'block' : 'none'
  const pop = $('popup')
  pop.style.display = which ? 'block' : 'none'
  if (which) {
    const since = open1 ? t - 4.8 : t - 13.6
    pop.style.transform = 'scale(' + (0.92 + 0.08 * ease(since / 0.18)) + ')'
    pop.style.height = (1.2 * $(which).contentDocument.body.getBoundingClientRect().height) + 'px'
  }

  const caps = [[3.0, 10.8, '1. On staging, click Get All'], [11.0, 18.6, '2. On localhost, click Set All'], [18.7, 20.6, '3. Reload'], [20.6, 22.8, 'Same state as staging.']]
  const cap = caps.find(([a, b]) => t >= a && t < b)
  $('captionText').textContent = cap ? cap[2] : ''
  $('caption').style.opacity = cap ? 1 : 0

  const [cx, cy] = cursorAt(t)
  $('cursor').style.left = cx + 'px'; $('cursor').style.top = cy + 'px'
  const click = clicks.find((c) => t >= c && t < c + 0.45)
  const r = $('ripple')
  if (click) { const k = (t - click) / 0.45; const at = cursorAt(click); r.style.left = at[0] + 'px'; r.style.top = at[1] + 'px'; r.style.opacity = 1 - k; r.style.transform = 'scale(' + (0.4 + 0.8 * k) + ')' }
  else r.style.opacity = 0
}
</script></body></html>`
