/**
 * "How to open on macOS.pdf", the guide that ships in the DMG beside the app
 * and the fix script: `npm run make:mac-guide` (runs in Electron).
 *
 * Rendered from the HTML below with Electron's printToPDF, so it is
 * reproducible and its fonts (the app's own Ubuntu Sans and Ubuntu Sans
 * Mono, from src/renderer/src/assets/fonts) are embedded. Two A4 pages: the
 * same guide in English, then in Russian. The command is the one
 * scripts/mac-instructions.test.ts holds everywhere else; never `-cr`.
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const productName = /^productName:\s*(.+?)\s*$/m.exec(readFileSync(join(root, 'electron-builder.yml'), 'utf-8'))[1]
const OUT = join(root, 'build', 'mac', 'How to open on macOS.pdf')
const fonts = join(root, 'src', 'renderer', 'src', 'assets', 'fonts')

const COMMAND = `xattr -dr com.apple.quarantine "/Applications/${productName}.app"`
const SCRIPT = 'Fix App Is Damaged.command'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TEXT = {
  en: {
    title: `How to open ${productName} on macOS`,
    why: 'Why macOS says it is “damaged” or “can’t be verified”',
    whyBody:
      'The app is free and is not signed with a paid Apple developer certificate. macOS therefore quarantines it after download and refuses to open it. The app is not damaged; removing the quarantine flag is all it needs.',
    steps: 'Three steps',
    s1: 'Drag the app onto the Applications folder in the install window.',
    s2: `Double-click <b>${SCRIPT}</b> in the same window. It opens in Terminal and does the rest.`,
    s3: 'Or, instead, open Terminal (Applications › Utilities) and run this command:',
    blocked: 'If macOS blocks the script too',
    blockedBody:
      'Open System Settings › Privacy & Security, scroll down, and click “Open Anyway” next to the blocked item. Or simply paste the command above into Terminal: that always works.',
    once: 'You need this once after each install or update.',
    old: 'Needs macOS 13 Ventura or later. On macOS 11 or 12 this version will not open: keep version 3.26.2 from the releases page, the last one that runs there.'
  },
  ru: {
    title: `Как открыть ${productName} на macOS`,
    why: 'Почему macOS пишет, что приложение «повреждено» или «не может быть проверено»',
    whyBody:
      'Приложение бесплатное и не подписано платным сертификатом разработчика Apple. Поэтому после загрузки macOS помещает его в карантин и не даёт открыть. Приложение не повреждено — достаточно снять с него флаг карантина.',
    steps: 'Три шага',
    s1: 'Перетащите приложение на папку «Программы» в окне установки.',
    s2: `Дважды щёлкните <b>${SCRIPT}</b> в том же окне. Он откроется в «Терминале» и сделает остальное.`,
    s3: 'Или вместо этого откройте «Терминал» («Программы» › «Утилиты») и выполните команду:',
    blocked: 'Если macOS блокирует и скрипт',
    blockedBody:
      'Откройте «Системные настройки» › «Конфиденциальность и безопасность», прокрутите вниз и нажмите «Всё равно открыть» рядом с заблокированным объектом. Или просто вставьте команду выше в «Терминал» — это работает всегда.',
    once: 'Это нужно один раз после каждой установки или обновления.',
    old: 'Нужна macOS 13 Ventura или новее. На macOS 11 и 12 эта версия не откроется: оставайтесь на версии 3.26.2 со страницы релизов — последней, которая там работает.'
  }
}

const page = (t) => `
<section class="page">
  <header><div class="mark"></div><h1>${esc(t.title)}</h1></header>
  <h2>${esc(t.why)}</h2>
  <p>${esc(t.whyBody)}</p>
  <h2>${esc(t.steps)}</h2>
  <ol>
    <li><span class="n">1</span><p>${esc(t.s1)}</p></li>
    <li><span class="n">2</span><p>${t.s2}</p></li>
    <li><span class="n">3</span><p>${esc(t.s3)}</p></li>
  </ol>
  <pre class="cmd">${esc(COMMAND)}</pre>
  <h2>${esc(t.blocked)}</h2>
  <p>${esc(t.blockedBody)}</p>
  <p class="once">${esc(t.once)}</p>
  <p class="once">${esc(t.old)}</p>
</section>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Ubuntu Sans'; src: url('${pathToFileURL(join(fonts, 'UbuntuSans-wdth-wght.ttf'))}'); font-weight: 100 800; }
@font-face { font-family: 'Ubuntu Sans Mono'; src: url('${pathToFileURL(join(fonts, 'UbuntuSansMono-wght.ttf'))}'); font-weight: 400 700; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Ubuntu Sans'; color: #3d3d3d; font-size: 11.5pt; line-height: 1.5; }
.page { width: 210mm; height: 297mm; padding: 22mm 20mm; page-break-after: always; }
header { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid #dbdbdb; margin-bottom: 8px; }
.mark { width: 28px; height: 28px; border-radius: 8px; background: #d54100; }
h1 { font-size: 20pt; font-weight: 800; margin: 0; color: #2c2c2c; }
h2 { font-size: 13pt; font-weight: 700; margin: 22px 0 6px; color: #2c2c2c; }
p { margin: 0; }
ol { list-style: none; padding: 0; margin: 8px 0 0; }
li { display: flex; gap: 12px; align-items: flex-start; margin: 10px 0; }
.n { flex: none; width: 24px; height: 24px; border-radius: 12px; background: #d54100; color: white; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 11pt; }
.cmd { font-family: 'Ubuntu Sans Mono'; font-size: 10pt; background: #f3f3f3; border: 1px solid #dbdbdb; border-radius: 10px; padding: 14px 16px; margin: 6px 0 0 36px; white-space: pre; overflow-wrap: normal; word-break: normal; color: #2c2c2c; }
.once { margin-top: 22px; padding: 10px 14px; border-left: 3px solid #d54100; background: #fdf1ec; }
</style></head><body>${page(TEXT.en)}${page(TEXT.ru)}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, pdf)
  console.log(`wrote ${OUT.replace(root, '.')} (${pdf.length} bytes)`)
  app.exit(0)
})
