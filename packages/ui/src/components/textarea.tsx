import { type ComponentProps, type Ref, useCallback, useLayoutEffect, useRef } from 'react';

import { cn } from '../lib/cn';
import { controlClassName } from './input';

export interface TextareaProps extends ComponentProps<'textarea'> {
  /**
   * Grows with its text instead of scrolling inside a fixed height (CSS `field-sizing: content`,
   * measured from `scrollHeight` where a browser lacks it). The 110px minimum stays.
   */
  autoGrow?: boolean;
}

const fieldSizingSupported = () =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('field-sizing', 'content')
    : false;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * Sets a border-box textarea's height to its text: `scrollHeight` counts the padding but not the
 * borders, so a caller's border is added back, or the box would scroll by its width.
 */
function fitToContent(node: HTMLTextAreaElement) {
  node.style.height = 'auto';
  const borders = node.offsetHeight - node.clientHeight;
  node.style.height = `${String(node.scrollHeight + borders)}px`;
}

export function Textarea({ className, autoGrow = false, ref, value, ...props }: TextareaProps) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node;
      assignRef(ref, node);
    },
    [ref],
  );
  // Without field-sizing, size it to its content: on every change of the text, as typed into an
  // uncontrolled one, and when its width changes (a drawer or window resized rewraps the text).
  useLayoutEffect(() => {
    const node = own.current;
    if (!autoGrow || !node || fieldSizingSupported()) return;
    fitToContent(node);
    const onInput = () => {
      fitToContent(node);
    };
    node.addEventListener('input', onInput);
    let width = node.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            fitToContent(node);
          });
    observer?.observe(node);
    return () => {
      node.removeEventListener('input', onInput);
      observer?.disconnect();
    };
  }, [autoGrow]);
  useLayoutEffect(() => {
    const node = own.current;
    if (!autoGrow || !node || fieldSizingSupported()) return;
    fitToContent(node);
  }, [autoGrow, value]);
  return (
    <textarea
      ref={setRef}
      value={value}
      className={cn(
        controlClassName,
        'flex min-h-[110px] px-3 py-2.5 leading-normal',
        autoGrow ? 'field-sizing-content resize-none' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
}
