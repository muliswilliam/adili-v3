import { useSyncExternalStore } from 'react';

/** Framing never changes for a page's life, so there is nothing to subscribe to. */
const subscribe = () => () => undefined;

function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent can make the comparison throw: that is a frame too.
    return true;
  }
}

/**
 * Whether the page runs inside a frame, e.g. a live app slide of the demo host's presentation
 * deck. False on the server and while hydrating, so the markup matches; the real answer after.
 */
export function useInFrame(): boolean {
  return useSyncExternalStore(subscribe, inFrame, () => false);
}
