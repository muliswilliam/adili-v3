import { Alert02Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';
import { Icon } from './icon';

/**
 * `polite` waits for the screen reader to finish (confirmations); `assertive` interrupts
 * (failures the user must act on).
 */
export type ToastUrgency = 'polite' | 'assertive';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Defaults to polite. Assertive toasts are styled as destructive, with a warning icon. */
  urgency?: ToastUrgency;
  /**
   * Milliseconds before the toast dismisses itself. Polite toasts default to 6000; assertive
   * toasts stay until dismissed so the user has time to read them. The countdown pauses while
   * the toast is hovered or has focus.
   */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_POLITE_DURATION = 6000;

/** Whether an event target is inside the toast viewport, so a dialog can ignore it. */
export function isInToastViewport(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-toast-viewport]') !== null;
}

function urgencyOf(entry: ToastOptions): ToastUrgency {
  return entry.urgency ?? 'polite';
}

const subscribeToNothing = () => () => undefined;

/**
 * Renders both live regions on mount, before any toast exists, so screen readers pick up
 * toasts added later. They are portalled to the body, above modal dialogs, so a dialog that
 * hides the rest of the page from assistive technology does not hide them. Mount once near
 * the app root.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  // No document during server rendering; the regions mount on the client.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...options, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const polite = toasts.filter((entry) => urgencyOf(entry) === 'polite');
  const assertive = toasts.filter((entry) => urgencyOf(entry) === 'assertive');

  return (
    <ToastContext value={api}>
      {children}
      {isClient
        ? createPortal(
            <div
              data-toast-viewport=""
              className="pointer-events-none fixed inset-x-4 bottom-6 z-[60] flex flex-col items-center gap-2"
            >
              <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2">
                {assertive.map((entry) => (
                  <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
                ))}
              </div>
              <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
                {polite.map((entry) => (
                  <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </ToastContext>
  );
}

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const urgency = urgencyOf(entry);
  const assertive = urgency === 'assertive';
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(entry.duration ?? (assertive ? undefined : DEFAULT_POLITE_DURATION));

  useEffect(() => {
    if (remaining.current === undefined || hovered || focused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      onDismiss(entry.id);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== undefined) remaining.current -= Date.now() - startedAt;
    };
  }, [hovered, focused, entry.id, onDismiss]);

  return (
    <div
      data-urgency={urgency}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className={cn(
        'pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl py-[11px] pr-2 pl-4 text-sm shadow-pop',
        assertive ? 'bg-destructive text-destructive-foreground' : 'bg-foreground text-background',
      )}
    >
      <Icon icon={assertive ? Alert02Icon : Tick02Icon} className="mt-0.5" />
      <div className="grid min-w-0 gap-0.5">
        <div className="font-medium">{entry.title}</div>
        {entry.description ? <div className="opacity-80">{entry.description}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => {
          onDismiss(entry.id);
        }}
        className={cn(
          '-my-0.5 flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2',
          assertive
            ? 'focus-visible:outline-destructive-foreground'
            : 'focus-visible:outline-background',
        )}
      >
        <Icon icon={Cancel01Icon} />
        <span className="sr-only">Dismiss notification</span>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}
