// @vitest-environment jsdom
import { focusRing } from '@adili/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ItemPin } from '../../../review-case/flags';
import { DOCUMENT, PLOT } from '../../../review-case/fixtures';
import { DeclarationPane } from './declaration-pane';

function renderPane(pin: ItemPin) {
  const onPin = vi.fn();
  render(
    <DeclarationPane
      document={DOCUMENT}
      version={1}
      versions={1}
      highlight={null}
      pins={new Map([[PLOT, pin]])}
      onPin={onPin}
      onAttachment={vi.fn()}
      attachmentState={() => 'idle'}
      onRetry={vi.fn()}
      retrying={false}
    />,
  );
  return { onPin };
}

describe('DeclarationPane item pins', () => {
  it('M6: shows the focus ring on the pin, a button that opens its flag', () => {
    const { onPin } = renderPane({ count: 2, severity: 'high', flagId: 'flag-1' });

    const pin = screen.getByRole('button', { name: /2 indicators/u });
    for (const part of focusRing.split(' ')) expect(pin.className).toContain(part);
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledWith('flag-1');
  });
});
