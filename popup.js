import { createActions, hostOf } from './lib/actions.js'

const actions = createActions(chrome)
const status = document.querySelector('#status')
const buttons = document.querySelectorAll('main button')

// Resolved up front so a click can request cookie access synchronously.
let activeTab
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    activeTab = tab
    const site = document.querySelector('#site')
    site.textContent = `On ${hostOf(tab)}`
    site.hidden = false
})

function show(message, isError = false) {
    status.textContent = message
    status.classList.toggle('error', isError)
}

function setBusy(busy) {
    buttons.forEach((button) => (button.disabled = busy))
}

function clearQuestion(kind, host) {
    if (kind === 'all') {
        return `Clear all local storage, session storage and cookies of ${host}? You will likely be logged out.`
    }
    const label = kind === 'cookies' ? 'cookies' : `${kind} storage values`
    return `Clear all ${label} of ${host}?`
}

function run(kind, action) {
    const tab = activeTab
    if (!tab) return show('This tab is still loading. Try again.', true)

    // Must start before any await: it needs the click's user gesture.
    const access = actions.requestAccess(kind, tab)
    show('Working...')
    setBusy(true)
    access
        .then((granted) => {
            if (!granted) return `Cookie access was not granted for ${hostOf(tab)}.`
            if (action === 'clear' && !confirm(clearQuestion(kind, hostOf(tab)))) return 'Cancelled.'
            return actions.run(kind, action, tab)
        })
        .then(
            (message) => show(message),
            (error) => show(error.message, true)
        )
        .finally(() => setBusy(false))
}

document.querySelector('main').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    run(button.closest('[data-kind]').dataset.kind, button.dataset.action)
})

// Footer tabs: clicking the open tab again closes its panel.
const tabs = document.querySelectorAll('.tab')
tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
        const opening = !tab.classList.contains('active')
        tabs.forEach((other) => other.classList.toggle('active', opening && other === tab))
        document.querySelectorAll('.panel').forEach((panel) => {
            panel.hidden = !opening || panel.id !== tab.dataset.panel
        })
    })
)
