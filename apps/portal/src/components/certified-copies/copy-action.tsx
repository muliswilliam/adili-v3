import { Button, formatDate, Icon, Spinner } from '@adili/ui';
import { Download01Icon, RefreshIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import { COPIES_COPY as COPY } from '../../access/history-copy';
import type { CertifiedCopies, CopyTarget } from './use-certified-copies';

/**
 * A version's certified copy button (spec 10 FE-4, S13): Request certified copy, "Preparing…"
 * while it is issued, then Download; Try again when it could not be prepared. `label` names the
 * version for screen readers, e.g. "Initial declaration, version 2".
 */
export function CopyAction({
  target,
  label,
  copies,
  variant = 'secondary',
}: {
  target: CopyTarget;
  label: string;
  copies: CertifiedCopies;
  /** Ghost beside other version actions (My declarations), where Download names the copy. */
  variant?: 'secondary' | 'ghost';
}) {
  const state = copies.stateOf(target.declarationId, target.version);
  switch (state.step) {
    case 'preparing':
      return (
        <Button type="button" variant={variant} size="sm" disabled aria-live="polite">
          <Spinner />
          {COPY.preparing}
        </Button>
      );
    case 'issued': {
      const busy = copies.downloading === state.copy.documentId;
      return (
        <Button
          type="button"
          variant={variant}
          size="sm"
          disabled={busy}
          aria-label={COPY.downloadOf(label)}
          onClick={() => void copies.download(state.copy.documentId)}
        >
          {busy ? <Spinner /> : <Icon icon={Download01Icon} />}
          {variant === 'ghost' ? COPY.copyName : COPY.download}
        </Button>
      );
    }
    case 'failed':
      return (
        <Button
          type="button"
          variant={variant}
          size="sm"
          aria-label={COPY.tryAgainOf(label)}
          onClick={() => void copies.request(target)}
        >
          <Icon icon={RefreshIcon} />
          {COPY.tryAgain}
        </Button>
      );
    case 'none':
      return (
        <Button
          type="button"
          variant={variant}
          size="sm"
          aria-label={COPY.requestOf(label)}
          onClick={() => void copies.request(target)}
        >
          {COPY.request}
        </Button>
      );
  }
}

/** Under the version: "Certified 3 Jun 2026", or why there is no copy. Nothing otherwise. */
export function CopyNote({ target, copies }: { target: CopyTarget; copies: CertifiedCopies }) {
  const state = copies.stateOf(target.declarationId, target.version);
  if (state.step === 'issued' && state.copy.issuedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
        <Icon icon={Tick02Icon} className="size-[13px]" strokeWidth={2.4} />
        {COPY.certified(formatDate(state.copy.issuedAt))}
      </span>
    );
  }
  if (state.step === 'failed') {
    return <span className="text-[13px] font-medium text-destructive">{COPY.failed}</span>;
  }
  return null;
}
