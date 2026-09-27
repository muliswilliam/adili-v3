import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { ReactNode } from 'react';

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
