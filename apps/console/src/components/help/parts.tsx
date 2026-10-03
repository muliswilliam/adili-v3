import { Badge, cn, formatDate, Icon, TabsLink, TabsNav } from '@adili/ui';
import {
  Archive02Icon,
  ChartColumnIcon,
  Clock01Icon,
  File01Icon,
  JusticeScale01Icon,
  PencilEdit02Icon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { PageHead } from '../page';
import { messages as m } from './messages';
import { type ArticleStatus } from './model';
import type { HelpWorkspace } from './scope';

export type HelpTab = 'articles' | 'corpus' | 'themes';

const TAB_ICONS = { articles: File01Icon, corpus: JusticeScale01Icon, themes: ChartColumnIcon };

/**
 * The help pages' title, read-only badge and actions, over the tabs between them: the
 * platform's articles and the legal corpus for platform admins, the Commission's articles and
 * its question themes for its staff. Links between pages, as a `TabsNav`.
 */
export function HelpHeader({
  workspace,
  current,
  actions,
}: {
  workspace: HelpWorkspace;
  current: HelpTab;
  actions?: ReactNode;
}) {
  const tabs: { tab: HelpTab; to: '/help' | '/help/corpus' | '/help/themes'; label: string }[] =
    workspace.scope.kind === 'platform'
      ? [
          { tab: 'articles', to: '/help', label: m.tabPlatformArticles },
          { tab: 'corpus', to: '/help/corpus', label: m.tabCorpus },
        ]
      : [
          { tab: 'articles', to: '/help', label: m.tabArticles },
          { tab: 'themes', to: '/help/themes', label: m.tabThemes },
        ];
  return (
    <>
      <PageHead title={m.title} actions={actions}>
        {workspace.readOnly ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReadOnlyBadge />
          </div>
        ) : null}
      </PageHead>
      <TabsNav aria-label={m.tabsLabel} className="mb-[18px]">
        {tabs.map(({ tab, to, label }) => (
          <TabsLink key={tab} asChild current={tab === current}>
            <Link to={to}>
              <Icon icon={TAB_ICONS[tab]} className="size-4" />
              {label}
            </Link>
          </TabsLink>
        ))}
      </TabsNav>
    </>
  );
}

export function ReadOnlyBadge() {
  return (
    <Badge>
      <Icon icon={ViewIcon} className="size-3" />
      {m.readOnly}
    </Badge>
  );
}

const STATUS_STYLE: Record<
  ArticleStatus,
  { variant: 'success' | 'info' | 'default'; icon: typeof Tick02Icon }
> = {
  published: { variant: 'success', icon: Tick02Icon },
  scheduled: { variant: 'info', icon: Clock01Icon },
  draft: { variant: 'default', icon: PencilEdit02Icon },
  expired: { variant: 'default', icon: Archive02Icon },
};

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  const { variant, icon } = STATUS_STYLE[status];
  return (
    <Badge variant={variant} className="whitespace-nowrap">
      <Icon icon={icon} className="size-3" strokeWidth={2.2} />
      {m.status[status]}
    </Badge>
  );
}

/** "EN SW", the SW struck through when there is no Kiswahili text. */
export function Languages({ kiswahili }: { kiswahili: boolean }) {
  const chip =
    'inline-flex h-[22px] items-center rounded-sm px-[7px] text-[11.5px] font-semibold tracking-[0.02em]';
  return (
    <span
      role="img"
      aria-label={kiswahili ? m.englishAndKiswahili : m.englishOnly}
      className="inline-flex gap-1"
    >
      <span className={cn(chip, 'bg-muted text-secondary-foreground')}>EN</span>
      <span
        title={kiswahili ? m.kiswahili : m.noKiswahili}
        className={cn(
          chip,
          kiswahili
            ? 'bg-muted text-secondary-foreground'
            : 'border text-muted-foreground line-through',
        )}
      >
        SW
      </span>
    </span>
  );
}

/** "From 1 Jul 2026", or "1 Nov 2025 - 30 Jun 2026" for a period that ends. */
export function inEffect({
  effectiveFrom,
  effectiveTo,
}: {
  effectiveFrom: string;
  effectiveTo: string | null;
}): string {
  return effectiveTo
    ? m.inEffectRange(formatDate(effectiveFrom), formatDate(effectiveTo))
    : m.inEffectFrom(formatDate(effectiveFrom));
}

/** A corpus citation as the prototype's `.cite` chip, with the scales icon. */
export function CitationTag({ citation, help = false }: { citation: string; help?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-[5px] rounded-chip px-2 text-[12.5px] font-medium whitespace-nowrap',
        help
          ? 'bg-brand-subtle text-brand-subtle-foreground'
          : 'bg-muted text-secondary-foreground',
      )}
    >
      <Icon icon={help ? File01Icon : JusticeScale01Icon} className="size-3" strokeWidth={2} />
      {citation}
    </span>
  );
}
