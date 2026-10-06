import { Slot } from '@radix-ui/react-slot';
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '../lib/cn';

export type TableProps = ComponentProps<'table'> & {
  /** Names the table for assistive technology; rendered visually hidden unless `showCaption`. */
  caption: ReactNode;
  /** Shows the caption above the table as its title, e.g. a Form M list's prescribed name. */
  showCaption?: boolean;
};

/*
 * Every part states its table role. A row or cell restyled as a grid or flex box (a table's rows
 * as cards on phones) loses its implicit role in Safari, so VoiceOver no longer reads it as a
 * table; an explicit role keeps it one.
 */

/** How far the scroller's content fades out at an edge it can still scroll past. */
const EDGE_FADE = '28px';

export function Table({ caption, showCaption = false, className, children, ...props }: TableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scroller);
  return (
    <>
      {showCaption ? (
        // Shown above the scroller so a wide table on a phone does not cut it off; the caption
        // itself stays the table's name.
        <div
          aria-hidden="true"
          className="px-4 pt-3 pb-2.5 text-[13.5px] leading-[1.4] font-semibold text-foreground"
        >
          {caption}
        </div>
      ) : null}
      {/* A table wider than its column scrolls sideways; the content fades out at each edge it
          can still scroll past, so a cut-off column reads as more to see, not as missing. */}
      <div
        ref={scroller}
        data-scroll-start={edges.start ? '' : undefined}
        data-scroll-end={edges.end ? '' : undefined}
        style={fadeMask(edges)}
        className="relative w-full overflow-x-auto"
      >
        <table
          role="table"
          className={cn('w-full caption-bottom border-collapse text-sm', className)}
          {...props}
        >
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </>
  );
}

interface ScrollEdges {
  /** Scrolled away from the start: there is more to the left. */
  start: boolean;
  /** More to the right. */
  end: boolean;
}

/**
 * Which edges of a horizontal scroller have more content past them, kept up to date as it
 * scrolls or either it or its content resizes. Neither until measured (the server render, and
 * where ResizeObserver is missing).
 */
function useScrollEdges(scroller: { current: HTMLElement | null }): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scroller]);
  return edges;
}

function fadeMask({ start, end }: ScrollEdges): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const mask = `linear-gradient(to right, ${start ? 'transparent' : '#000'}, #000 ${EDGE_FADE}, #000 calc(100% - ${EDGE_FADE}), ${end ? 'transparent' : '#000'})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead role="rowgroup" className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody role="rowgroup" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      role="row"
      className={cn(
        // Relative so a TableRowLink can stretch over the whole row.
        'relative border-b transition-colors has-[[data-row-link]]:hover:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

export type TableHeadProps = ComponentProps<'th'> & {
  /** `col` for column headers; use `row` for the first cell of a body row. */
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup';
};

export function TableHead({ scope = 'col', className, ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      role={scope === 'row' || scope === 'rowgroup' ? 'rowheader' : 'columnheader'}
      className={cn(
        'text-left align-middle font-medium first:pl-4 last:pr-4',
        scope === 'col'
          ? 'bg-background/60 px-3 py-2.5 text-[12.5px] whitespace-nowrap text-muted-foreground'
          : 'p-3 text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td role="cell" className={cn('p-3 align-middle first:pl-4 last:pr-4', className)} {...props} />
  );
}

export type TableRowLinkProps = ComponentProps<'a'> & {
  /** Render the child element (e.g. a router link) with row link behaviour. */
  asChild?: boolean;
};

/**
 * The one link in a row, usually inside its row header. Its hit area stretches over the whole
 * row, so the row is clickable but stays a single tab stop named by the link text. Give any
 * other interactive element in the row `relative z-10` so it sits above the link.
 */
export function TableRowLink({ asChild = false, className, ...props }: TableRowLinkProps) {
  const Component = asChild ? Slot : 'a';
  return (
    <Component
      data-row-link=""
      className={cn(
        'font-medium text-foreground underline-offset-4 outline-hidden after:absolute after:inset-0 hover:underline focus-visible:after:outline-2 focus-visible:after:outline-solid focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring',
        className,
      )}
      {...props}
    />
  );
}
