import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';

import { clamp } from '../lib/clamp';
import { cn } from '../lib/cn';

export type SplitPaneProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The wide pane on the left, e.g. the declaration as filed. */
  main: ReactNode;
  /** The pane on the right whose width the handle sets, e.g. the review tabs. */
  side: ReactNode;
  /** Names the handle for screen readers, e.g. "Resize review panel". */
  label: string;
  /** The side pane's starting width in pixels, when uncontrolled. Defaults to `min`. */
  defaultSize?: number;
  /** The side pane's width in pixels, when controlled. */
  size?: number;
  /** Called with the new width as the handle moves, e.g. to keep it for next time. */
  onSizeChange?: (size: number) => void;
  /** The narrowest the side pane goes, in pixels. */
  min?: number;
  /** The widest the side pane goes, in pixels. */
  max?: number;
  /** Pixels per arrow key press. */
  step?: number;
  /** Classes for the main pane's wrapper. */
  mainClassName?: string;
  /** Classes for the side pane's wrapper, e.g. to make it sticky. */
  sideClassName?: string;
};

// The handle's column; the pointer sits at its centre while dragging.
const HANDLE = 16;

/**
 * Two panes side by side with a handle between them to resize the side pane: drag it, or focus
 * it and use the left and right arrow keys (left widens the side pane); Home and End move the
 * handle all the way left or right. The handle is a focusable `separator` with the side pane's
 * width as its value, between `min` and `max`. The pill on the handle stays in view on tall
 * panes. Lay out a different arrangement for narrow screens; this one always splits.
 */
export function SplitPane({
  main,
  side,
  label,
  defaultSize,
  size: controlled,
  onSizeChange,
  min = 340,
  max = 720,
  step = 24,
  mainClassName,
  sideClassName,
  className,
  style,
  ...props
}: SplitPaneProps) {
  const [uncontrolled, setUncontrolled] = useState(() => clamp(defaultSize ?? min, min, max));
  const size = clamp(controlled ?? uncontrolled, min, max);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sideId = useId();

  function resize(next: number) {
    const width = Math.round(clamp(next, min, max));
    if (width === size) return;
    setUncontrolled(width);
    onSizeChange?.(width);
  }

  function onKeyDown(event: KeyboardEvent) {
    const next = {
      ArrowLeft: size + step,
      ArrowRight: size - step,
      Home: max,
      End: min,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    resize(next);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent) {
    const box = root.current?.getBoundingClientRect();
    if (!dragging || !box) return;
    resize(box.right - event.clientX - HANDLE / 2);
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  return (
    <div
      ref={root}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_16px_var(--split-side)] items-start',
        dragging && 'cursor-col-resize select-none',
        className,
      )}
      style={{ ...style, '--split-side': `${String(size)}px` } as CSSProperties}
      {...props}
    >
      <div className={cn('min-w-0', mainClassName)}>{main}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={label}
        aria-controls={sideId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={size}
        data-dragging={dragging || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="group flex cursor-col-resize touch-none flex-col items-center self-stretch outline-hidden"
      >
        <span
          aria-hidden="true"
          className="sticky top-[40vh] bottom-[40vh] my-auto h-11 w-1 rounded-full bg-input transition-colors group-hover:bg-foreground group-focus-visible:bg-foreground group-data-dragging:bg-foreground"
        />
      </div>
      <div id={sideId} className={cn('min-w-0', sideClassName)}>
        {side}
      </div>
    </div>
  );
}
