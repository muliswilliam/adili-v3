import { Card, CardHeader, CardIcon, CardTitle, cn, Icon, type IconProps } from '@adili/ui';
import type { ComponentProps, ReactNode, Ref } from 'react';

/** A console page under the top bar (the kit's `.cpage`): up to 1280px, or 880px when narrow. */
export function Page({
  narrow = false,
  className,
  ...props
}: ComponentProps<'main'> & { narrow?: boolean }) {
  return (
    <main
      className={cn(
        'mx-auto w-full px-4 pt-5 pb-18 min-[700px]:px-7 min-[700px]:pt-7 min-[700px]:pb-20',
        narrow ? 'max-w-[880px]' : 'max-w-[1280px]',
        className,
      )}
      {...props}
    />
  );
}

/** The page title, with anything under it (a count, badges) and actions on the right. */
export function PageHead({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start gap-4">
      <div className="min-h-9 min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
          {title}
        </h1>
        {children}
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A kit Card with an icon tile and title on a hairline header (the kit's `.cardx` with `.sec-h`),
 * labelled by its title for assistive technology. The body brings its own padding.
 */
export function SectionCard({
  id,
  icon,
  title,
  description,
  headingRef,
  actions,
  className,
  children,
}: {
  id: string;
  icon: IconProps['icon'];
  title: ReactNode;
  /** A line under the title, e.g. the version in force. */
  description?: ReactNode;
  /** Lets the page move focus to the heading, e.g. after the control that had it is gone. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Shown at the end of the header, e.g. a status badge. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <Card role="region" aria-labelledby={headingId} className={cn('min-w-0 p-0 sm:p-0', className)}>
      <CardHeader className="flex-row items-center gap-2.5 border-b px-5 py-4">
        <CardIcon className="mb-0 size-[30px]">
          <Icon icon={icon} />
        </CardIcon>
        <div className="min-w-0">
          <CardTitle
            id={headingId}
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="outline-none"
          >
            {title}
          </CardTitle>
          {description ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/** Label and value rows under a section header (the kit's `.dl` in a `.cardx`). */
export function DetailList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('divide-y px-5 py-1.5', className)} {...props} />;
}

/** One row of a DetailList: the label in a fixed column, the value beside it. */
export function DetailItem({
  term,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { term: ReactNode }) {
  return (
    <div
      className={cn(
        'grid gap-1 py-[11px] text-[14.5px] min-[520px]:grid-cols-[170px_minmax(0,1fr)] min-[520px]:gap-4',
        className,
      )}
      {...props}
    >
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}
