import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button, type ButtonProps } from './button';
import { Icon } from './icon';
import { type ToastOptions, useToast } from './toast';

const CONFIRMED_FOR_MS = 2000;

export type CopyButtonProps = Omit<ButtonProps, 'children' | 'asChild'> & {
  /** The text put on the clipboard. */
  value: string;
  /** Names the button, e.g. "Copy officer reference". */
  label: string;
  /** Toast shown after copying. */
  copiedMessage?: ReactNode;
  /** Toast shown when the browser refuses clipboard access. */
  failedMessage?: ReactNode;
  /** Shows the label next to the icon instead of only to screen readers. */
  showLabel?: boolean;
};

/**
 * Copies a value to the clipboard. Success is confirmed with a polite toast, so screen reader
 * users hear it, and the icon turns into a tick for a moment. Needs a ToastProvider.
 */
export function CopyButton({
  value,
  label,
  copiedMessage = 'Copied',
  failedMessage = 'Could not copy. Select the text and copy it instead.',
  showLabel = false,
  variant = 'ghost',
  size,
  onClick,
  ...props
}: CopyButtonProps) {
  const { toast, dismiss } = useToast();
  // Counts successful copies since the tick last cleared, so each copy restarts its timer.
  const [copies, setCopies] = useState(0);
  const copied = copies > 0;
  // The toast from the previous click, replaced rather than stacked by the next one.
  const lastToast = useRef<number | null>(null);

  useEffect(() => {
    if (copies === 0) return;
    const timer = setTimeout(() => {
      setCopies(0);
    }, CONFIRMED_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copies]);

  function announce(options: ToastOptions) {
    if (lastToast.current !== null) dismiss(lastToast.current);
    lastToast.current = toast(options);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopies((count) => count + 1);
      announce({ title: copiedMessage });
    } catch {
      // A tick left from an earlier copy would contradict the failure; clearing it also stops
      // its timer.
      setCopies(0);
      announce({ title: failedMessage, urgency: 'assertive' });
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (showLabel ? 'sm' : 'icon')}
      data-copied={copied || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void copy();
      }}
      {...props}
    >
      <Icon icon={copied ? Tick02Icon : Copy01Icon} />
      <span className={showLabel ? undefined : 'sr-only'}>{label}</span>
    </Button>
  );
}
