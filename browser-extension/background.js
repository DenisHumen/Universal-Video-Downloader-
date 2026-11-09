// A service worker in Chromium, an event page in Firefox: only the first has importScripts,
// and the manifest gives Firefox link.js by itself.
'use strict'

if (typeof importScripts === 'function') importScripts('link.js')

const extensionApi = globalThis.browser ?? globalThis.chrome
const MENU_ITEM = 'send-link'

extensionApi.runtime.onInstalled.addListener(() => {
  extensionApi.contextMenus.create({
    id: MENU_ITEM,
    title: extensionApi.i18n.getMessage('menuSendLink'),
    contexts: ['link']
  })
})

extensionApi.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ITEM) void openInApp(extensionApi, tab?.id, info.linkUrl)
})
