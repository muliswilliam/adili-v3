import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CodeBlock, CodeComment, CodeKeyword, CodeString } from './code-block';

describe('CodeBlock', () => {
  it('is a named, focusable group so long lines can be scrolled with the keyboard', () => {
    render(<CodeBlock label="Get a token example">curl -X POST</CodeBlock>);

    const block = screen.getByRole('group', { name: 'Get a token example' });
    expect(block.tagName).toBe('PRE');
    expect(block.tabIndex).toBe(0);
    expect(block.querySelector('code')?.textContent).toBe('curl -X POST');
  });

  it('keeps the text of its marked parts in order', () => {
    render(
      <CodeBlock label="Example">
        <CodeKeyword>curl</CodeKeyword> <CodeString>&apos;https://example.test&apos;</CodeString>
        {'\n'}
        <CodeComment># 202 Accepted</CodeComment>
      </CodeBlock>,
    );

    expect(screen.getByRole('group').textContent).toBe(
      "curl 'https://example.test'\n# 202 Accepted",
    );
    expect(screen.getByText('curl').className).toContain('text-code-keyword');
    expect(screen.getByText('# 202 Accepted').className).toContain('text-code-comment');
  });

  it('takes extra classes', () => {
    render(
      <CodeBlock label="Example" className="mt-3">
        x
      </CodeBlock>,
    );

    expect(screen.getByRole('group').className).toContain('mt-3');
  });
});
