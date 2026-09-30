import { cn, Icon, type IconProps } from '@adili/ui';
import { type ReactNode, useId } from 'react';

export type StatusTone = 'success' | 'warning' | 'destructive' | 'neutral';

const TONE: Record<StatusTone, { head: string; mark: string }> = {
  success: { head: 'from-success-subtle', mark: 'bg-success' },
  warning: { head: 'from-warning-subtle', mark: 'bg-warning' },
  destructive: { head: 'from-destructive-subtle', mark: 'bg-destructive' },
  neutral: { head: 'from-muted', mark: 'bg-muted-foreground' },
};

export interface StatusCardProps {
  tone: StatusTone;
  icon: IconProps['icon'];
  /** The answer, in words: the page's heading. */
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}

/**
 * The answer of a lookup: a tinted head with a solid mark and the status as the page's heading,
 * then whatever the status allows the page to show. The status is always in the text, never in
 * the colour alone.
 */
export function StatusCard({ tone, icon, title, detail, children }: StatusCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-tone={tone}
      className="rounded-2xl bg-card text-card-foreground shadow-card"
    >
      <div
        className={cn(
          'flex items-start gap-3.5 rounded-t-2xl bg-linear-to-b to-card p-5 sm:px-6 sm:py-[22px]',
          !children && 'rounded-b-2xl',
          TONE[tone].head,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-[14px] text-card [&_svg]:size-6',
            TONE[tone].mark,
          )}
        >
          <Icon icon={icon} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <h1
            id={headingId}
            className="text-xl leading-[1.3] font-semibold tracking-[-0.015em] sm:text-[22px]"
          >
            {title}
          </h1>
          {detail ? (
            <p className="mt-1.5 text-[14.5px] text-secondary-foreground">{detail}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="px-5 pt-1 pb-5 sm:px-6 sm:pb-[22px]">{children}</div> : null}
    </section>
  );
}
