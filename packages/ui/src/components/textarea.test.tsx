import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders a native textarea that accepts input', () => {
    render(<Textarea aria-label="Reason" />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.tagName).toBe('TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'Duplicate declaration' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Duplicate declaration');
  });

  it('merges a caller class with its own styles', () => {
    render(<Textarea aria-label="Reason" className="min-h-40" />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.className).toContain('min-h-40');
    expect(textarea.className).not.toContain('min-h-[110px]');
    expect(textarea.className).toContain('shadow-control');
  });

  it('can be disabled', () => {
    render(<Textarea aria-label="Reason" disabled />);

    expect(screen.getByRole('textbox', { name: 'Reason' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the invalid style when marked aria-invalid', () => {
    render(<Textarea aria-label="Reason" aria-invalid />);

    const textarea = screen.getByRole('textbox', { name: 'Reason' });
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.className).toContain('aria-invalid:shadow-control-error');
  });

  describe('autoGrow', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sizes itself to its text with field-sizing, instead of scrolling inside', () => {
      vi.stubGlobal('CSS', { supports: () => true });
      render(<Textarea aria-label="Text" autoGrow value="A long drafted request" readOnly />);

      const textarea = screen.getByRole('textbox', { name: 'Text' });
      expect(textarea.className).toContain('field-sizing-content');
      expect(textarea.className).toContain('min-h-[110px]');
      expect(textarea.className).not.toContain('resize-y');
      expect(textarea.style.height).toBe('');
    });

    it('measures its text where the browser has no field-sizing, and again as it changes', () => {
      vi.stubGlobal('CSS', { supports: () => false });
      let height = 180;
      const spy = vi
        .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
        .mockImplementation(() => height);
      const { rerender } = render(<Textarea aria-label="Text" autoGrow value="One" readOnly />);
      const textarea = screen.getByRole('textbox', { name: 'Text' });
      expect(textarea.style.height).toBe('180px');

      height = 260;
      rerender(<Textarea aria-label="Text" autoGrow value="One, and a lot more" readOnly />);
      expect(textarea.style.height).toBe('260px');
      spy.mockRestore();
    });

    it('adds a border back to the measured text, so the box does not scroll by it', () => {
      vi.stubGlobal('CSS', { supports: () => false });
      const spies = [
        vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(180),
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(112),
        vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(110),
      ];
      render(<Textarea aria-label="Text" autoGrow value="One" readOnly className="border" />);
      expect(screen.getByRole('textbox', { name: 'Text' }).style.height).toBe('182px');
      for (const spy of spies) spy.mockRestore();
    });

    it('grows as text is typed into an uncontrolled one', () => {
      vi.stubGlobal('CSS', { supports: () => false });
      let height = 120;
      const spy = vi
        .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
        .mockImplementation(() => height);
      render(<Textarea aria-label="Text" autoGrow defaultValue="One" />);
      const textarea = screen.getByRole('textbox', { name: 'Text' });
      expect(textarea.style.height).toBe('120px');

      height = 240;
      fireEvent.input(textarea, { target: { value: 'One, and a lot more' } });
      expect(textarea.style.height).toBe('240px');
      spy.mockRestore();
    });

    it('measures again when its width changes, as the text rewraps', () => {
      vi.stubGlobal('CSS', { supports: () => false });
      const observers: (() => void)[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        vi.fn(function (callback: () => void) {
          observers.push(callback);
          return { observe: vi.fn(), disconnect: vi.fn() };
        }),
      );
      let height = 120;
      let width = 600;
      const spies = [
        vi
          .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
          .mockImplementation(() => height),
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width),
      ];
      render(<Textarea aria-label="Text" autoGrow value="A long drafted request" readOnly />);
      const textarea = screen.getByRole('textbox', { name: 'Text' });

      height = 200;
      for (const notify of observers) notify();
      expect(textarea.style.height).toBe('120px');
      width = 320;
      for (const notify of observers) notify();
      expect(textarea.style.height).toBe('200px');
      for (const spy of spies) spy.mockRestore();
    });

    it('stays a fixed, resizable box without it', () => {
      render(<Textarea aria-label="Reason" />);
      expect(screen.getByRole('textbox', { name: 'Reason' }).className).toContain('resize-y');
    });
  });
});
