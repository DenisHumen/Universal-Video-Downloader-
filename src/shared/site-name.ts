/**
 * The extractor's name when it names a site.
 *
 * The rest are the engine's and this app's words for "no extractor of its own
 * for this one": "Generic" and "HTML5MediaEmbed" on a card told a person nothing.
 * On its own because the queue needs it for folders and must not import the Library.
 */
export function siteNameOf(extractor: string | undefined): string | undefined {
  return extractor && !/^(universal|generic|browser|html5mediaembed)$/i.test(extractor) ? extractor : undefined
}
