/** Names in a sentence: "KRA", "KRA and NTSA", "KRA, NTSA, BRS and ArdhiSasa". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
}
