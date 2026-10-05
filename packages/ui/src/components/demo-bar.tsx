import { ArrowDown01Icon, Tick02Icon, UserSwitchIcon } from '@hugeicons/core-free-icons';
import { useRef } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon } from './icon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu';

export interface DemoBarAccount {
  demoKey: string;
  name: string;
  role: string;
  organisation?: string;
  purpose: string;
}

export interface DemoBarProps {
  /** The accounts this app can switch to, in menu order. */
  accounts: readonly DemoBarAccount[];
  /** The signed-in demo account's key; null when signed out or not a demo account. */
  current: string | null;
  /** Where the switch form posts, e.g. `/auth/demo-switch`. */
  action?: string;
  /**
   * `floating` (default): fixed at the bottom left of the window. `inline`: in a header's flow,
   * e.g. the console's top bar beside the sidebar; while one is on the page, a floating one hides.
   */
  variant?: 'floating' | 'inline';
}

/**
 * The hackathon demo's banner and role switcher (#616), shown only in demo mode: a pill that says
 * the data is synthetic and switches the signed-in account in one click. Picking an account
 * posts the switch form: the server records the switch and signs the account in afresh.
 */
export function DemoBar({
  accounts,
  current,
  action = '/auth/demo-switch',
  variant = 'floating',
}: DemoBarProps) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const acting = accounts.find((account) => account.demoKey === current);

  return (
    <div
      role="region"
      aria-label="Demo"
      data-demo-bar={variant}
      className={cn(
        'flex items-center gap-1 rounded-full bg-warning p-1 pl-3.5 text-[13px] text-primary-foreground print:hidden',
        variant === 'floating'
          ? 'fixed bottom-4 left-4 z-[55] shadow-pop [body:has([data-demo-bar=inline])_&]:hidden'
          : 'shrink-0',
      )}
    >
      <span className="font-semibold tracking-[0.04em]">DEMO</span>
      <span className={cn('mr-1.5 opacity-90', variant === 'inline' && 'max-[900px]:sr-only')}>
        synthetic data
      </span>
      <form ref={form} method="post" action={action}>
        <input ref={input} type="hidden" name="as" defaultValue="" />
        <Menu>
          <MenuTrigger
            className={cn(
              focusRing,
              'flex h-8 items-center gap-1.5 rounded-full bg-background px-3 font-medium text-foreground hover:bg-muted',
            )}
          >
            <Icon icon={UserSwitchIcon} className="size-4 text-muted-foreground" />
            <span className="max-w-[260px] truncate">
              {acting ? (
                <>
                  Acting as {acting.name}
                  <span className="text-muted-foreground"> · {acting.role}</span>
                </>
              ) : (
                'Act as'
              )}
            </span>
            <Icon icon={ArrowDown01Icon} className="size-4 text-muted-foreground" />
          </MenuTrigger>
          <MenuContent
            align={variant === 'floating' ? 'start' : 'end'}
            side={variant === 'floating' ? 'top' : 'bottom'}
            className="max-h-[min(70dvh,560px)] w-[380px] max-w-[calc(100vw-2rem)] overflow-y-auto"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              Demo: act as
            </p>
            {accounts.map((account) => (
              <MenuItem
                key={account.demoKey}
                className="items-start py-2"
                onSelect={() => {
                  if (!input.current || !form.current) return;
                  input.current.value = account.demoKey;
                  form.current.requestSubmit();
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {account.name}
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {account.role}
                      {account.organisation ? `, ${account.organisation}` : ''}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{account.purpose}</span>
                </span>
                {account.demoKey === current ? (
                  <Icon icon={Tick02Icon} aria-label="Signed in" className="mt-0.5 text-brand!" />
                ) : null}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </form>
    </div>
  );
}
