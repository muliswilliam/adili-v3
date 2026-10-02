import { type CSSProperties, type RefCallback, useCallback, useState } from 'react';

/** Which ends of a sideways-scrolling element have more content past them. */
export interface ScrollEdges {
  /** Content is scrolled out of view at the start (left). */
  start: boolean;
  /** Content runs on past the end (right). */
  end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/**
 * Tracks whether a sideways-scrolling element has more to see at either end, as it scrolls and
 * as it or its children change size. Give the ref to the scrolling element.
 */
export function useScrollEdges<T extends HTMLElement>(): [RefCallback<T>, ScrollEdges] {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  const ref = useCallback((element: T | null) => {
    if (!element) return;
    const measure = () => {
      const { scrollLeft, scrollWidth, clientWidth } = element;
      // Only the padding past an edge: nothing more to see there. A pixel of slack, as zoomed
      // layouts round scroll positions.
      const style = getComputedStyle(element);
      const before = (parseFloat(style.paddingLeft) || 0) + 1;
      const after = (parseFloat(style.paddingRight) || 0) + 1;
      const next = {
        start: scrollLeft > before,
        end: scrollLeft + clientWidth < scrollWidth - after,
      };
      setEdges((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(element);
    for (const child of element.children) resized?.observe(child);
    return () => {
      element.removeEventListener('scroll', measure);
      resized?.disconnect();
    };
  }, []);
  return [ref, edges];
}

/** How far the fade at a scrolling edge reaches, in pixels. */
const FADE_PX = 40;

/**
 * A mask fading the content out at each edge with more past it, so a row that scrolls sideways
 * shows there is more. The bottom pixel (a tab list's hairline) is left whole.
 */
export function scrollEdgeFade(edges: ScrollEdges): CSSProperties | undefined {
  if (!edges.start && !edges.end) return undefined;
  const start = edges.start ? 'transparent' : '#000';
  const end = edges.end ? 'transparent' : '#000';
  return {
    maskImage: `linear-gradient(to right, ${start}, #000 ${String(FADE_PX)}px, #000 calc(100% - ${String(FADE_PX)}px), ${end}), linear-gradient(#000, #000)`,
    maskSize: '100% calc(100% - 1px), 100% 1px',
    maskPosition: 'top, bottom',
    maskRepeat: 'no-repeat',
  };
}
