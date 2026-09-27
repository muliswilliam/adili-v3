import { cn, Icon, type IconProps } from '@adili/ui';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { ReactNode } from 'react';

const tones = {
  success: 'bg-success-subtle text-success-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  danger: 'bg-destructive-subtle text-destructive-subtle-foreground',
  neutral: 'bg-muted text-muted-foreground',
} as const;

/** Page title with an icon above it, for outcome pages (done, expired, failed). */
export function StateTitle({
  icon,
  tone,
  children,
}: {
  icon: IconProps['icon'];
  tone: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span className="grid justify-items-start gap-4">
      <span className={cn('grid size-11 place-items-center rounded-full', tones[tone])}>
        <Icon icon={icon} className="size-5" />
      </span>
      <span>{children}</span>
    </span>
  );
}

/** Muted text under the page title. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="-mt-2 text-sm leading-6 text-muted-foreground">{children}</p>;
}

export interface Step {
  title: ReactNode;
  detail?: ReactNode;
  done?: boolean;
  /** Content under the step, e.g. a QR code or an input. */
  children?: ReactNode;
}

/** Numbered steps in a bordered box. */
export function Steps({ steps, label }: { steps: Step[]; label?: string }) {
  return (
    <ol aria-label={label} className="grid gap-4 rounded-xl bg-muted/60 p-4 sm:p-5">
      {steps.map((step, index) => (
        <li key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full text-xs font-semibold',
              step.done
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-secondary-foreground shadow-card',
            )}
            aria-hidden="true"
          >
            {step.done ? (
              <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.5} />
            ) : (
              index + 1
            )}
          </span>
          <div className="grid gap-0.5 pt-1">
            <span className="text-sm leading-5 font-medium">{step.title}</span>
            {step.detail ? (
              <span className="text-sm leading-5 text-muted-foreground">{step.detail}</span>
            ) : null}
            {step.children ? <div className="mt-3">{step.children}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A Keycloak field error (may contain Keycloak's HTML), announced when it appears. */
export function FieldError({ id, html }: { id: string; html: string }) {
  return (
    <p
      id={id}
      className="text-[13px] font-medium text-destructive"
      aria-live="polite"
      dangerouslySetInnerHTML={{ __html: kcSanitize(html) }}
    />
  );
}

/** Checkbox row styled like the rest of the form. */
export function CheckboxRow({ name, id, label }: { name: string; id: string; label: ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input type="checkbox" id={id} name={name} value="on" className="size-4 accent-primary" />
      {label}
    </label>
  );
}
