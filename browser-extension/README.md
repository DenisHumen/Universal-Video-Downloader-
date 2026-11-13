# Send to Universal Video Downloader

A browser extension with one job: send the current page, or a link you right-click, to the
[Universal Video Downloader](https://github.com/DenisHumen/Universal-Video-Downloader) app by opening
`uvd://open?url=<link>`. The app then shows the link in a strip at the top of its window, and nothing happens
until you press **Use It** there. Nothing downloads by itself, whatever the app's settings say.

It asks for `activeTab` and `contextMenus` only. No host permissions, no content scripts, no remote code, no
analytics, no requests of its own. Plain JavaScript with no build step.

The app must be installed and opened once, which is when Windows and macOS learn about `uvd://` links. If it is
not, the browser cannot tell the extension so: Chromium shows nothing, and Firefox shows an error page in that tab
(press Back). The popup says this. An AppImage receives links only once it is integrated into the system, for
example by AppImageLauncher; the .deb and .rpm packages do so when installed.

## Try it without a store

Run `node scripts/package-extension.mjs` from the repository root for `release/extension/*.zip`, or use this folder
as it is.

- **Chrome, Edge, Brave, Vivaldi:** open `chrome://extensions`, switch on Developer mode, press **Load unpacked** and
  choose this folder. It warns about the `scripts` and `browser_specific_settings` keys, which are Firefox's; the zip
  for Chromium leaves them out.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, press **Load Temporary Add-on** and choose `manifest.json`.
  It lasts until Firefox closes. A permanent install needs the store's signature, below.

## Publishing

For the owner of the project. Nothing in this repository publishes anything, and each store needs its own account.

1. In `manifest.json`, set `version` above what was published last.
2. Run `npx web-ext lint --source-dir browser-extension` and `node scripts/package-extension.mjs`.
3. **Firefox:** at <https://addons.mozilla.org/developers/>, create the account if there is none, press **Submit a New
   Add-on** and upload `release/extension/send-to-uvd-firefox-<version>.zip`. The source is the zip itself: there is
   no build step to explain. The add-on id `send-to-uvd@denishumen.github.io` is fixed from then on.
4. **Chrome:** at <https://chrome.google.com/webstore/devconsole>, create the developer account (a one-time fee at
   the time of writing), press **New item** and upload `release/extension/send-to-uvd-chromium-<version>.zip`. Under
   privacy, say that no data is collected, and give the reason for each permission: `activeTab` reads the address of
   the tab when its button is pressed, `contextMenus` adds the item on links.
5. Edge Add-ons takes the same Chromium zip, at <https://partner.microsoft.com/dashboard/microsoftedge/>.

**The policy risk.** The Chrome Web Store's rules on facilitating downloads, YouTube's above all, have got extensions
like this rejected, even though this one downloads nothing itself. A rejection costs only the submission, and the
extension keeps working when loaded unpacked. Firefox Add-ons has accepted similar extensions, so start there. The
listing should describe what it does, sending a link to a desktop app, and name no video site.
