import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { clamp } from '../lib/clamp';
import { cn } from '../lib/cn';

/** Half the handle's 16px column: a drag keeps the grip under the pointer. */
const HALF_HANDLE = 8;

export interface SplitPaneProps {
  /** The wide pane on the left, e.g. the declaration as filed. */
  main: ReactNode;
  /** The resizable pane on the right, e.g. the review tools. */
  side: ReactNode;
  /** Names the main pane's region. */
  mainLabel: string;
  /** Names the side pane's region (an `aside`). */
  sideLabel: string;
  /** Names the handle: "Resize review panel". */
  handleLabel: string;
  /** The handle's value in words, for screen readers: `460` → "460 pixels wide". */
  handleValueText?: (width: number) => string;
  /** The side pane's width in px, when the parent holds it (to keep it across visits). */
  sideWidth?: number;
  /** The starting width when uncontrolled. */
  defaultSideWidth?: number;
  minSideWidth?: number;
  maxSideWidth?: number;
  /** The side pane never grows past what leaves the main pane this wide. */
  minMainWidth?: number;
  /** How far one arrow key press moves the handle. */
  step?: number;
  onSideWidthChange?: (width: number) => void;
  /**
   * Below 800px of its own width the panes stack and the handle goes. Set this to show only one
   * pane there, with `narrowSwitch` to choose it.
   */
  narrowPane?: 'main' | 'side';
  /** Shown above the panes only while they stack, e.g. a SegmentedChoice between the two. */
  narrowSwitch?: ReactNode;
  className?: string;
  mainClassName?: string;
  /** The side pane is sticky under the console's 56px top bar and scrolls on its own. */
  sideClassName?: string;
}

/**
 * Two panes side by side, the right one resizable: drag the handle, or focus it and use the left
 * and right arrow keys (Home widens the side pane to its maximum, End narrows it to its minimum).
 * The handle is a `separator` whose value is the side pane's width. Under 800px of its own width
 * the panes stack, or show one at a time with `narrowPane`.
 */
export function SplitPane({
  main,
  side,
  mainLabel,
  sideLabel,
  handleLabel,
  handleValueText = (px) => `${String(px)} pixels wide`,
  sideWidth,
  defaultSideWidth = 440,
  minSideWidth = 340,
  maxSideWidth = 720,
  minMainWidth = 360,
  step = 24,
  onSideWidthChange,
  narrowPane,
  narrowSwitch,
  className,
  mainClassName,
  sideClassName,
}: SplitPaneProps) {
  const sideId = useId();
  const grid = useRef<HTMLDivElement>(null);
  const [ownWidth, setOwnWidth] = useState(defaultSideWidth);
  const [dragging, setDragging] = useState(false);
  const roomForSide = useRoomForSide(grid, minMainWidth);
  const measured = Number.isFinite(roomForSide);
  const maxWidth = Math.max(minSideWidth, Math.min(maxSideWidth, Math.floor(roomForSide)));
  const width = clamp(sideWidth ?? ownWidth, minSideWidth, maxWidth);

  const resize = (next: number) => {
    const clamped = Math.round(clamp(next, minSideWidth, maxWidth));
    if (clamped === width) return;
    if (sideWidth === undefined) setOwnWidth(clamped);
    onSideWidthChange?.(clamped);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Left is the browser's Back, Cmd and Ctrl with an arrow its own shortcuts.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const next = {
      ArrowLeft: width + step,
      ArrowRight: width - step,
      Home: maxWidth,
      End: minSideWidth,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    resize(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !grid.current) return;
    resize(grid.current.getBoundingClientRect().right - event.clientX - HALF_HANDLE);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  return (
    <div className={cn('@container', className)}>
      {narrowSwitch ? <div className="mb-3 @min-[800px]:hidden">{narrowSwitch}</div> : null}
      <div
        ref={grid}
        style={
          {
            // The limits are applied above, once the grid is measured. Before that (the server
            // render, and where ResizeObserver is missing) min() keeps the main pane its width.
            '--split-side': measured
              ? `${String(width)}px`
              : `min(${String(width)}px, calc(100% - 16px - ${String(minMainWidth)}px))`,
          } as CSSProperties
        }
        className="grid grid-cols-[minmax(0,1fr)] gap-4 @min-[800px]:grid-cols-[minmax(0,1fr)_16px_var(--split-side)] @min-[800px]:items-start @min-[800px]:gap-0"
      >
        <section
          aria-label={mainLabel}
          className={cn('min-w-0', narrowPane === 'side' && '@max-[800px]:hidden', mainClassName)}
        >
          {main}
        </section>
        <div
          role="separator"
          tabIndex={0}
          aria-label={handleLabel}
          aria-orientation="vertical"
          aria-controls={sideId}
          aria-valuemin={minSideWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          aria-valuetext={handleValueText(width)}
          data-dragging={dragging ? '' : undefined}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className="group hidden cursor-col-resize touch-none justify-center self-stretch outline-hidden @min-[800px]:flex"
        >
          <span
            aria-hidden="true"
            className="sticky top-[40vh] mt-[40vh] h-11 w-1 rounded-full bg-input transition-colors group-hover:bg-foreground group-focus-visible:bg-foreground group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring group-focus-visible:outline-solid group-data-dragging:bg-foreground motion-reduce:transition-none"
          />
        </div>
        <aside
          id={sideId}
          aria-label={sideLabel}
          // Its own scroll would clip a card's hairline and drop shadow: a pixel of room each side
          // (3px below), taken back from the gap so the card lines up with the main pane.
          className={cn(
            'min-w-0 @min-[800px]:sticky @min-[800px]:top-[72px] @min-[800px]:max-h-[calc(100dvh-88px)] @min-[800px]:overflow-auto @min-[800px]:-mx-px @min-[800px]:-mt-px @min-[800px]:p-px @min-[800px]:pb-[3px]',
            narrowPane === 'main' && '@max-[800px]:hidden',
            sideClassName,
          )}
        >
          {side}
        </aside>
      </div>
    </div>
  );
}

/**
 * The widest the side pane can be while the main pane keeps `minMainWidth`, from the grid's
 * width; infinite until measured, or where ResizeObserver is missing.
 */
function useRoomForSide(grid: { current: HTMLElement | null }, minMainWidth: number): number {
  const [gridWidth, setGridWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const element = grid.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setGridWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [grid]);
  return gridWidth - 2 * HALF_HANDLE - minMainWidth;
}
