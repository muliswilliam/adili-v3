import { Cancel01Icon } from '@hugeicons/core-free-icons';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /** Defaults to polite. Assertive toasts are styled as errors. */
  urgency?: ToastUrgency;
  /**
   * Milliseconds before the toast dismisses itself. Polite toasts default to 6000; assertive
   * toasts stay until dismissed so the user has time to read them.
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

/**
 * Renders both live regions on mount, before any toast exists, so screen readers pick up
 * toasts added later. Mount once near the app root.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

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
  const polite = toasts.filter((entry) => (entry.urgency ?? 'polite') === 'polite');
  const assertive = toasts.filter((entry) => entry.urgency === 'assertive');

  return (
    <ToastContext value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        <div role="alert" aria-live="assertive" className="flex w-full flex-col gap-2">
          {assertive.map((entry) => (
            <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
          ))}
        </div>
        <div role="status" aria-live="polite" className="flex w-full flex-col gap-2">
          {polite.map((entry) => (
            <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext>
  );
}

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const assertive = entry.urgency === 'assertive';
  const duration = entry.duration ?? (assertive ? undefined : DEFAULT_POLITE_DURATION);

  useEffect(() => {
    if (duration === undefined) return;
    const timer = setTimeout(() => {
      onDismiss(entry.id);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, entry.id, onDismiss]);

  return (
    <div
      className={cn(
        'pointer-events-auto relative grid gap-1 rounded-lg border py-3 pr-10 pl-4 text-sm shadow-lg',
        assertive
          ? 'border-transparent bg-destructive-subtle text-destructive-subtle-foreground'
          : 'bg-card text-card-foreground',
      )}
    >
      <div className="leading-5 font-medium">{entry.title}</div>
      {entry.description ? <div className="leading-5 opacity-90">{entry.description}</div> : null}
      <button
        type="button"
        onClick={() => {
          onDismiss(entry.id);
        }}
        className="absolute top-3 right-3 rounded-sm p-0.5 opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
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
