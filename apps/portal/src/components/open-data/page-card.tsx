import { Card } from '@adili/ui';
import type { ReactNode } from 'react';

/** A card of the page: a section named by its heading, with tools beside the heading. */
export function PageCard({
  id,
  title,
  tools,
  children,
  className,
}: {
  id: string;
  title: string;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card asChild className={className ?? 'gap-4'}>
      <section id={id} aria-labelledby={`${id}-title`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-base font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {tools}
        </div>
        {children}
      </section>
    </Card>
  );
}
