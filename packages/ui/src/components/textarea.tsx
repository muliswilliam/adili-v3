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

export function Textarea({ className, autoGrow = false, ref, value, ...props }: TextareaProps) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node;
      assignRef(ref, node);
    },
    [ref],
  );
  // Without field-sizing, size it to its content on every change of the text.
  useLayoutEffect(() => {
    const node = own.current;
    if (!autoGrow || !node || fieldSizingSupported()) return;
    node.style.height = 'auto';
    node.style.height = `${String(node.scrollHeight)}px`;
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
