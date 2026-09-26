import { DismissableLayerBranch } from '@radix-ui/react-dismissable-layer';
import { cva } from 'class-variance-authority';
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

import { CloseIcon } from '../lib/close-icon';

export type ToastVariant = 'default' | 'destructive';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /**
   * How screen readers announce the toast. `polite` waits for the user to be idle; `assertive`
   * interrupts. Defaults to `assertive` for destructive toasts and `polite` otherwise.
   */
  politeness?: 'polite' | 'assertive';
  /** Milliseconds before the toast dismisses itself; `null` keeps it until dismissed. */
  duration?: number | null;
}

interface ToastRecord {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  politeness: 'polite' | 'assertive';
  duration: number | null;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children?: ReactNode;
  /** Default auto-dismiss delay in milliseconds. */
  duration?: number;
}

/**
 * Hosts toasts for everything below it. The polite and assertive live regions are rendered up
 * front and stay mounted, because screen readers only announce changes to regions that already
 * exist.
 */
export function ToastProvider({ children, duration = 5000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'default', politeness, duration: ms }: ToastOptions) => {
      nextId.current += 1;
      const id = `toast-${nextId.current}`;
      const record: ToastRecord = {
        id,
        title,
        description,
        variant,
        politeness: politeness ?? (variant === 'destructive' ? 'assertive' : 'polite'),
        duration: ms === undefined ? duration : ms,
      };
      setToasts((current) => [...current, record]);
      return id;
    },
    [duration],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const polite = toasts.filter((item) => item.politeness === 'polite');
  const assertive = toasts.filter((item) => item.politeness === 'assertive');

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* A layer branch, so dismissing a toast does not count as a click outside an open dialog. */}
      <DismissableLayerBranch className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
          {polite.map((item) => (
            <ToastItem key={item.id} toast={item} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2">
          {assertive.map((item) => (
            <ToastItem key={item.id} toast={item} onDismiss={dismiss} />
          ))}
        </div>
      </DismissableLayerBranch>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}

const toastVariants = cva(
  'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg py-3 pr-2 pl-4 text-sm shadow-lg',
  {
    variants: {
      variant: {
        default: 'bg-foreground text-background',
        destructive: 'bg-destructive text-destructive-foreground',
      },
    },
  },
);

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const { id, duration } = toast;

  useEffect(() => {
    if (duration === null || paused) return;
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [id, duration, paused, onDismiss]);

  return (
    // Hover and focus pause the timer so the message can be read and acted on.
    <div
      className={toastVariants({ variant: toast.variant })}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <div className="grid flex-1 gap-0.5 py-0.5">
        <p className="leading-5 font-medium">{toast.title}</p>
        {toast.description ? <p className="leading-5 opacity-90">{toast.description}</p> : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          onDismiss(id);
        }}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md opacity-80 transition-opacity outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
