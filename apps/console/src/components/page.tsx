import { cn, Icon, type IconProps } from '@adili/ui';
import type { ComponentProps, ReactNode } from 'react';

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
      <div className="min-w-0">
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
 * A card with an icon tile and title on a hairline header (the kit's `.cardx` with `.sec-h`),
 * labelled by its title for assistive technology.
 */
export function SectionCard({
  id,
  icon,
  title,
  className,
  children,
}: {
  id: string;
  icon: IconProps['icon'];
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 rounded-2xl bg-card text-card-foreground shadow-card', className)}
    >
      <div className="flex items-center gap-2.5 border-b px-5 py-4">
        <span
          aria-hidden="true"
          className="grid size-[30px] shrink-0 place-items-center rounded-md bg-muted text-secondary-foreground"
        >
          <Icon icon={icon} />
        </span>
        <h2 id={headingId} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
