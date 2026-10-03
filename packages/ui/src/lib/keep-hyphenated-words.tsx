import { Fragment, type ReactNode } from 'react';

const HYPHENATED = /(\S+-\S+)/;

/**
 * `text` with each hyphenated word ("Re-checked", "half-open") kept on one line: browsers break
 * a line after a hyphen, which leaves "Re-" at the end of one line in a narrow row. The word is
 * wrapped in a `nowrap` span; the text reads the same to screen readers and in tests.
 */
export function keepHyphenatedWords(text: string): ReactNode {
  const parts = text.split(HYPHENATED);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
