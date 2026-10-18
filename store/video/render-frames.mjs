// Captures every frame of the demo scene as PNG (30 fps, 1920x1080).
// Then encode with: swift store/video/encode.swift <frames dir> store/getset-demo.mp4
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer'
import { DURATION, html, popups } from './scene.mjs'

const FPS = 30
const dir = process.argv[2]
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.setContent(html)
await page.evaluate(
    (popups) =>
        Promise.all(
            Object.entries(popups).map(
                ([id, srcdoc]) =>
                    new Promise((resolve) => {
                        const frame = document.getElementById(id)
                        frame.onload = resolve
                        frame.srcdoc = srcdoc
                    })
            )
        ),
    popups
)

const total = DURATION * FPS
for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.render(t), i / FPS)
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.png`) })
}
await browser.close()
console.log(`${total} frames in ${dir}`)
