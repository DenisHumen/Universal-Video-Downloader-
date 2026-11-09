// What both the toolbar button and the menu item send. The app checks all of this again.
'use strict'

var UVD_MAX_LINK_LENGTH = 2048

/** `uvd://open?url=...` for a web address, or null for anything else (a browser's own pages, say). */
function uvdLinkFor(address) {
  if (typeof address !== 'string' || address.length > UVD_MAX_LINK_LENGTH) return null
  if (!/^https?:\/\//i.test(address)) return null
  return 'uvd://open?url=' + encodeURIComponent(address)
}

/*
  Opened in the tab it came from: in Chromium the page stays put behind the
  browser's "open this app?" question. A tab is needed for that, and when there
  is none to use (a menu inside a side panel) a new one does the same.
*/
function openInApp(extensionApi, tabId, address) {
  var link = uvdLinkFor(address)
  if (!link) return Promise.resolve(false)
  var opened =
    typeof tabId === 'number' && tabId >= 0
      ? extensionApi.tabs.update(tabId, { url: link })
      : extensionApi.tabs.create({ url: link })
  return Promise.resolve(opened).then(function () {
    return true
  })
}
