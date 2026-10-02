/** Keys whose string values are pointers or codes, not prose the model wrote for a reader. */
const NON_PROSE_KEYS = new Set([
  'ref',
  'refs',
  'flagId',
  'flagIds',
  'sectionKey',
  'personKey',
  'itemId',
  'fieldPath',
  'requirement',
]);

export interface ProseField {
  /** JSON pointer of the field in the output, to name it in failures. */
  path: string;
  text: string;
}

/** Every prose string in a task output, with where it sits. */
export function proseFields(value: unknown, path = ''): ProseField[] {
  if (typeof value === 'string') return [{ path: path || '/', text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => proseFields(item, `${path}/${index}`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !NON_PROSE_KEYS.has(key))
      .flatMap(([key, item]) => proseFields(item, `${path}/${key}`));
  }
  return [];
}

/** Lower-case words, letters and apostrophes only. */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
}

/** A short quote of `text` for a failure message. */
export function quote(text: string, max = 80): string {
  return JSON.stringify(text.length > max ? `${text.slice(0, max - 1)}…` : text);
}
