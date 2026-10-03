/**
 * Splits a snippet into the parts that match the searched words and those that do not, so the
 * help pages can mark the matches (the service's snippet carries no marks). A word matches at
 * the start of a word in the snippet ("joint" marks "Jointly"); words under three letters do not.
 */
export function highlight(text: string, query: string): { text: string; match: boolean }[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    // Letters and digits only, so the words are safe in the pattern.
    .filter((word) => word.length > 2);
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.join('|')})`, 'giu');
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index;
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: found[0], match: true });
    at = start + found[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
