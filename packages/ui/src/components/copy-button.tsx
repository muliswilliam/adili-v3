import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useState } from 'react';

import { Button, type ButtonProps } from './button';
import { Icon } from './icon';
import { useToast } from './toast';

const CONFIRMED_FOR = 2000;

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
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, CONFIRMED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: copiedMessage });
    } catch {
      toast({ title: failedMessage, urgency: 'assertive' });
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (showLabel ? 'sm' : 'icon')}
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
