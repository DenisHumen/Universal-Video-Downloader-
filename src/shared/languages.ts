/*
  Language codes picked on the result card, on their way to the engine's command
  line. They come over the bridge and began as the site's own data, and
  `--sub-langs` reads its value as a list of patterns where `all` and a leading
  `-` mean something, so only a plain code gets through. A trip through here is
  also what keeps a card from ever asking for every language.
*/

const LANGUAGE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,34}$/

/** As many subtitle languages as one download asks for: each is a request, and YouTube counts them. */
export const MAX_SUBTITLE_LANGUAGES = 8

export function cleanLanguage(raw: unknown): string | undefined {
  return typeof raw === 'string' && LANGUAGE_CODE.test(raw) && raw.toLowerCase() !== 'all' ? raw : undefined
}

/** The usable codes of a list, or undefined when that leaves none. */
export function cleanLanguages(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const codes = [...new Set(raw.flatMap((code) => cleanLanguage(code) ?? []))].slice(0, MAX_SUBTITLE_LANGUAGES)
  return codes.length ? codes : undefined
}
