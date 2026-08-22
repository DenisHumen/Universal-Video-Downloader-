/**
 * Whether a filename template stays inside the download folder.
 *
 * The template is joined onto the chosen directory and handed to the engine as
 * `-o`, and `join` resolves `..` — so `../../../../Startup/%(title)s.%(ext)s`
 * writes wherever it likes, and an absolute template discards the directory
 * altogether.
 *
 * A template may still contain slashes — putting downloads in per-uploader
 * subfolders is a real thing people do — it just may not climb out.
 *
 * Shared, because both sides need the same answer: main refuses an unsafe
 * template on the way in, and the settings screen has to know before it saves.
 * It used to live only in main, so typing the first character of an absolute
 * path replaced everything the user had written with the default, silently,
 * mid-keystroke.
 */
export function isSafeTemplate(template: string): boolean {
  const value = template.trim()
  if (!value) return true
  if (/^([a-zA-Z]:|\\|\/)/.test(value)) return false
  return !value.split(/[\\\/]+/).includes('..')
}
