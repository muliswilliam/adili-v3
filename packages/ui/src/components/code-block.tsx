import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export type CodeBlockProps = Omit<ComponentProps<'pre'>, 'aria-label'> & {
  /** Names the example for screen readers, e.g. "Send a batch example". */
  label: string;
};

/**
 * A code example on a dark panel, in monospace with its line breaks kept; long lines scroll
 * sideways, so the block takes keyboard focus. Mark parts with `CodeKeyword`, `CodeString` and
 * `CodeComment`.
 */
export function CodeBlock({ label, className, children, ...props }: CodeBlockProps) {
  return (
    <pre
      role="group"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'm-0 overflow-x-auto rounded-xl border border-code-border bg-code px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] whitespace-pre text-code-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    >
      <code>{children}</code>
    </pre>
  );
}

/** A command or keyword in a `CodeBlock`. */
export function CodeKeyword({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-code-keyword', className)} {...props} />;
}

/** A quoted value in a `CodeBlock`. */
export function CodeString({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-code-string', className)} {...props} />;
}

/** A comment, or a response's status line, in a `CodeBlock`. */
export function CodeComment({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-code-comment', className)} {...props} />;
}
