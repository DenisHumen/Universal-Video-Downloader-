// Opening the popup is the one click: it sends the current tab's address and says what to expect.
// A browser cannot tell whether an app took the link, so this can only say what no answer means.
'use strict'

const extensionApi = globalThis.browser ?? globalThis.chrome
const say = (id, key) => {
  document.getElementById(id).textContent = extensionApi.i18n.getMessage(key)
}

async function send() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true })
  const sent = tab ? await openInApp(extensionApi, tab.id, tab.url) : false
  say('status', sent ? 'popupSent' : 'popupNotAPage')
  if (sent) say('help', 'popupNoApp')
}

send().catch(() => {
  say('status', 'popupFailed')
  say('help', 'popupNoApp')
})
