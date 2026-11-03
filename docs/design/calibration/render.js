// D0 calibration: render the libadwaita 1.5 widgets that Files and Settings are
// built from, with the user's own libadwaita, theme and font, in light and dark
// (forced per-process via AdwStyleManager: the desktop setting is untouched),
// and save each as a PNG plus its measured size.
imports.gi.versions.Gtk = '4.0'
imports.gi.versions.Adw = '1'
const { Adw, Gtk, Gdk, Gsk, GLib, Graphene } = imports.gi
const OUT = ARGV[0]
const SCHEME = ARGV[1] // light | dark

const app = new Adw.Application({ application_id: 'local.uvd.calibration' + SCHEME })
app.connect('activate', () => {
  Adw.StyleManager.get_default().set_color_scheme(
    SCHEME === 'dark' ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.FORCE_LIGHT
  )
  const win = new Adw.ApplicationWindow({ application: app, default_width: 900, default_height: 900 })
  const parts = {}

  // Sidebar (navigation-sidebar listbox, as Settings' panel list)
  const side = new Gtk.ListBox({ css_classes: ['navigation-sidebar'], width_request: 260 })
  for (const [icon, label] of [
    ['preferences-desktop-appearance-symbolic', 'Appearance'],
    ['folder-download-symbolic', 'Downloads'],
    ['network-wired-symbolic', 'Network'],
    ['computer-symbolic', 'System']
  ]) {
    const b = new Gtk.Box({ spacing: 12, margin_start: 6, margin_end: 6 })
    b.append(new Gtk.Image({ icon_name: icon }))
    b.append(new Gtk.Label({ label, xalign: 0 }))
    side.append(b)
  }
  side.select_row(side.get_row_at_index(1))
  parts.sidebar = side

  // Header bar with flat, default, suggested buttons
  const hb = new Adw.HeaderBar({ title_widget: new Adw.WindowTitle({ title: 'Settings' }) })
  hb.pack_start(new Gtk.Button({ icon_name: 'go-previous-symbolic' }))
  hb.pack_end(new Gtk.Button({ label: 'Apply', css_classes: ['suggested-action'] }))
  parts.headerbar = hb

  // Buttons
  const buttons = new Gtk.Box({ spacing: 12, margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12 })
  buttons.append(new Gtk.Button({ label: 'Default' }))
  buttons.append(new Gtk.Button({ label: 'Flat', css_classes: ['flat'] }))
  buttons.append(new Gtk.Button({ label: 'Suggested', css_classes: ['suggested-action'] }))
  buttons.append(new Gtk.Button({ label: 'Destructive', css_classes: ['destructive-action'] }))
  buttons.append(new Gtk.Button({ label: 'Pill', css_classes: ['pill', 'suggested-action'] }))
  buttons.append(new Gtk.Button({ icon_name: 'window-close-symbolic', css_classes: ['circular'] }))
  parts.buttons = buttons

  // Toggle group (GNOME 46: linked toggle buttons)
  const tg = new Gtk.Box({ css_classes: ['linked'], margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12, halign: Gtk.Align.START })
  const t1 = new Gtk.ToggleButton({ label: 'Video', active: true })
  const t2 = new Gtk.ToggleButton({ label: 'Audio Only', group: t1 })
  tg.append(t1)
  tg.append(t2)
  parts.toggle = tg

  // Boxed list
  const group = new Adw.PreferencesGroup({ title: 'Location', description: 'Where downloads go', margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12 })
  const r1 = new Adw.ActionRow({ title: 'Save Location', subtitle: '/home/user/Downloads' })
  r1.add_suffix(new Gtk.Button({ label: 'Change…', valign: Gtk.Align.CENTER, css_classes: ['flat'] }))
  const r2 = new Adw.SwitchRow({ title: 'Sort into Subfolders', active: true })
  const r3 = new Adw.SwitchRow({ title: 'Resume on Launch', active: false })
  const r4 = new Adw.ComboRow({ title: 'Quality', model: Gtk.StringList.new(['Best', '1080p']) })
  const r5 = new Adw.ActionRow({ title: 'Proxy', activatable: true })
  r5.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }))
  for (const r of [r1, r2, r3, r4, r5]) group.add(r)
  parts.boxedlist = group

  // Entry
  const entry = new Gtk.Entry({ placeholder_text: 'Paste a link', margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12, width_request: 300 })
  parts.entry = entry

  // Card + dim label + heading
  const card = new Gtk.Box({ css_classes: ['card'], orientation: Gtk.Orientation.VERTICAL, margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12, width_request: 300, height_request: 80 })
  card.append(new Gtk.Label({ label: 'Heading', css_classes: ['heading'], margin_top: 12 }))
  card.append(new Gtk.Label({ label: 'Dim label text', css_classes: ['dim-label'] }))
  card.append(new Gtk.Label({ label: 'Caption', css_classes: ['caption'] }))
  parts.card = card

  const view = new Gtk.Box({ css_classes: ['view'], width_request: 200, height_request: 40 })
  parts.view = view

  // As GNOME Settings is built: a navigation split view, a toolbar view with a
  // header bar on each side.
  const right = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true })
  for (const k of ['buttons', 'toggle', 'boxedlist', 'entry', 'card', 'view']) right.append(parts[k])
  const sideTv = new Adw.ToolbarView()
  const sideHb = new Adw.HeaderBar({ title_widget: new Adw.WindowTitle({ title: 'Settings' }) })
  sideTv.add_top_bar(sideHb)
  const search = new Gtk.SearchEntry({ placeholder_text: 'Search', margin_start: 6, margin_end: 6, margin_bottom: 6 })
  const sb = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  sb.append(search)
  sb.append(side)
  sideTv.set_content(sb)
  const contentTv = new Adw.ToolbarView()
  contentTv.add_top_bar(hb)
  contentTv.set_content(right)
  const split = new Adw.NavigationSplitView({
    sidebar: new Adw.NavigationPage({ child: sideTv, title: 'Settings' }),
    content: new Adw.NavigationPage({ child: contentTv, title: 'Downloads' }),
    min_sidebar_width: 260, max_sidebar_width: 260
  })
  const box = split
  parts.sidebarHeader = sideHb
  parts.search = search
  win.set_content(split)
  win.present()

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
    const meta = {}
    const save = (name, widget) => {
      const w = widget.get_width()
      const h = widget.get_height()
      const paintable = new Gtk.WidgetPaintable({ widget })
      const snap = new Gtk.Snapshot()
      paintable.snapshot(snap, w, h)
      const node = snap.to_node()
      if (!node) return
      const tex = win.get_renderer().render_texture(node, new Graphene.Rect({ origin: new Graphene.Point({ x: 0, y: 0 }), size: new Graphene.Size({ width: w, height: h }) }))
      tex.save_to_png(`${OUT}/${SCHEME}-${name}.png`)
      meta[name] = { w, h }
    }
    save('window', win)
    const pos = {}
    const at = (name, widget) => {
      const [ok, b] = widget.compute_bounds(win)
      if (ok) pos[name] = [Math.round(b.get_x()), Math.round(b.get_y()), Math.round(b.get_width()), Math.round(b.get_height())]
    }
    at('sidebar', side); at('sidebarHeader', sideHb); at('search', search); at('headerbar', hb); at('card', card); at('entry', entry); at('view', view)
    at('selectedRow', side.get_row_at_index(1)); at('row0', side.get_row_at_index(0))
    at('boxed', r1); at('switchOnRow', r2); at('switchOffRow', r3)
    at('toggleOn', t1); at('toggleOff', t2)
    let c = buttons.get_first_child(); const names = ['btnDefault','btnFlat','btnSuggested','btnDestructive','btnPill','btnCircular']
    for (const n of names) { at(n, c); c = c.get_next_sibling() }
    meta.pos = pos
    for (const [k, v] of Object.entries(parts)) save(k, v)
    // Row and control heights
    const rows = []
    for (let i = 0; i < 4; i++) rows.push(side.get_row_at_index(i).get_height())
    meta.sidebarRowHeights = rows
    meta.headerbarHeight = hb.get_height()
    meta.boxedRowHeights = [r1, r2, r3, r4, r5].map((r) => r.get_height())
    meta.buttonHeights = [...Array(6).keys()].map((i) => {
      let c = buttons.get_first_child()
      for (let j = 0; j < i; j++) c = c.get_next_sibling()
      return [c.get_width(), c.get_height()]
    })
    meta.entryHeight = entry.get_height()
    meta.toggleHeight = t1.get_height()
    const sw = r2.get_last_child()
    meta.font = Gtk.Settings.get_default().gtk_font_name
    meta.theme = Gtk.Settings.get_default().gtk_theme_name
    meta.dark = Adw.StyleManager.get_default().get_dark()
    print(JSON.stringify(meta))
    app.quit()
    return GLib.SOURCE_REMOVE
  })
})
app.run([])
