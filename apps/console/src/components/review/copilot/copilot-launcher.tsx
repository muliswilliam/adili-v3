import { cn, focusRing, Icon, Spinner } from '@adili/ui';
import { Alert02Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { launcherStatus } from './copilot-view';
import { AiTile } from './panel-parts';
import { messages as t } from './messages';
import type { CaseCopilot } from './use-case-copilot';

const launcherTones = {
  ready: 'text-ai',
  busy: 'text-ai',
  warning: 'text-warning',
  off: 'text-muted-foreground',
} as const;

/** The Copilot bar above the case's side tabs: its state at a glance, and opens the panel. */
export function CopilotLauncher({
  state,
  onOpen,
}: {
  state: Pick<CaseCopilot, 'copilot' | 'error'>;
  onOpen: () => void;
}) {
  const { text, tone } = launcherStatus(state.copilot, state.error);
  const off = tone === 'off';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t.launcher.open(text)}
      className={cn(
        focusRing,
        'flex w-full cursor-pointer items-center gap-2.5 rounded-item bg-card py-2.5 pr-3 pl-2.5 text-left shadow-card transition-shadow hover:ring-1 hover:ring-ai',
      )}
    >
      <AiTile off={off} />
      <span className="text-[14.5px] font-semibold">{t.title}</span>
      <span
        className={cn(
          'ml-auto inline-flex items-center gap-[7px] text-[13px] font-medium',
          launcherTones[tone],
        )}
      >
        {tone === 'busy' ? <Spinner className="size-[13px]" /> : null}
        {tone === 'warning' ? <Icon icon={Alert02Icon} className="size-3.5" /> : null}
        {text}
      </span>
      <Icon icon={ArrowRight01Icon} className="text-muted-foreground" />
    </button>
  );
}
