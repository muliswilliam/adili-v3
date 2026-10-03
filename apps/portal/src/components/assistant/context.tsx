import { Button, cn, Icon, Tooltip } from '@adili/ui';
import { SparklesIcon } from '@hugeicons/core-free-icons';
import { createContext, type RefObject, useContext, useEffect } from 'react';

import type { AskCopy } from '../../assistant/copy';
import type { Category } from '../../declaration/statement';

/**
 * What the page shares with Ask Adili, and the ways in that only need it (the launcher, the phone
 * bar's button, a statement screen's tab), kept apart from the panel so screens that use them do
 * not load the panel's server calls. Each renders nothing without an `AskAdiliProvider`.
 */

export interface AskAdili {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  copy: AskCopy;
  /** A statement screen's tab, so "On:" and the suggestions follow it. */
  setTab: (tab: Category | null) => void;
  /** The launcher, where focus goes back when what opened the panel is gone. */
  launcherRef: RefObject<HTMLButtonElement | null>;
}

export const AskAdiliContext = createContext<AskAdili | null>(null);

/** Tells Ask Adili which tab of a financial statement is showing. No-op without the panel. */
export function useAskAdiliTab(tab: Category) {
  const context = useContext(AskAdiliContext);
  const setTab = context?.setTab;
  useEffect(() => {
    if (!setTab) return;
    setTab(tab);
    return () => {
      setTab(null);
    };
  }, [setTab, tab]);
}

/** The round "Ask Adili" button fixed at the bottom right of the page; none without the panel. */
export function AskAdiliLauncher({ className }: { className?: string }) {
  const context = useContext(AskAdiliContext);
  if (!context) return null;
  const { isOpen, open, copy, launcherRef } = context;
  // Hidden rather than removed while the panel is open, so focus can come back to it.
  return (
    <button
      ref={launcherRef}
      type="button"
      onClick={open}
      hidden={isOpen}
      aria-expanded={isOpen}
      className={cn(
        'fixed right-4 bottom-5 z-30 inline-flex [&[hidden]]:hidden size-[50px] cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-semibold text-primary-foreground shadow-[0_10px_28px_-8px_rgba(20,20,20,0.45)] outline-offset-2 hover:bg-black focus-visible:outline-2 focus-visible:outline-ring sm:right-7 sm:bottom-7 sm:h-[46px] sm:w-auto sm:pr-[18px] sm:pl-[15px] [&_svg]:size-[17px] [&_svg]:text-ai-subtle',
        className,
      )}
    >
      <Icon icon={SparklesIcon} />
      <span className="sr-only sm:not-sr-only">{copy.open}</span>
    </button>
  );
}

/** The workspace phone bar's icon button that opens the panel. */
export function AskAdiliBarButton({ className }: { className?: string }) {
  const context = useContext(AskAdiliContext);
  if (!context) return null;
  const { open, copy } = context;
  return (
    <Tooltip content={copy.open}>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={open}
        className={cn('size-[34px] text-ai [&_svg]:size-4', className)}
      >
        <Icon icon={SparklesIcon} />
        <span className="sr-only">{copy.open}</span>
      </Button>
    </Tooltip>
  );
}
