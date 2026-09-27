import { DescriptionItem, DescriptionList, EmptyState, Icon } from '@adili/ui';
import { Building03Icon, UserGroupIcon } from '@hugeicons/core-free-icons';

import type { Commission } from '../../server/directory/types';
import { SectionCard } from '../page';
import { formatDateTime } from './format';
import { messages } from './messages';

/** Spec 01 order: Name, Commission key, Issuer code, Type, Categories, Policy version, Created. */
export function DetailsCard({ commission }: { commission: Commission }) {
  return (
    <SectionCard id="details" icon={Building03Icon} title={messages.detail.details}>
      <DescriptionList className="px-5 py-4">
        <DescriptionItem term={messages.detail.name}>{commission.name}</DescriptionItem>
        <DescriptionItem term={messages.detail.key}>
          <span className="font-mono">{commission.slug}</span>
        </DescriptionItem>
        <DescriptionItem term={messages.detail.issuerCode}>
          <span
            className="font-mono"
            title={messages.detail.issuerCodeExample(commission.issuerCode)}
          >
            {commission.issuerCode}
          </span>
        </DescriptionItem>
        <DescriptionItem term={messages.detail.type}>
          {messages.typeLong[commission.type]}
        </DescriptionItem>
        <DescriptionItem term={messages.detail.categories}>
          {commission.categories.length > 0 ? (
            <ul className="grid gap-2 text-left">
              {commission.categories.map((category) => (
                <li
                  key={category.code}
                  className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5 text-sm leading-[1.4] font-normal"
                >
                  <span className="text-[13px] font-medium text-secondary-foreground tabular-nums">
                    {category.citation}
                  </span>
                  <span>{category.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="font-normal text-muted-foreground">{messages.categoriesNone}</span>
          )}
        </DescriptionItem>
        <DescriptionItem term={messages.detail.policyVersion}>
          {messages.detail.policyVersionValue(commission.policyVersion)}
        </DescriptionItem>
        <DescriptionItem term={messages.detail.created}>
          <time dateTime={commission.createdAt}>{formatDateTime(commission.createdAt)}</time>
        </DescriptionItem>
      </DescriptionList>
    </SectionCard>
  );
}

/** Slice 01 shows the roster card in its no-roster state only; slice 02 replaces this card. */
export function RosterCard({ className }: { className?: string }) {
  return (
    <SectionCard
      id="roster"
      icon={UserGroupIcon}
      title={messages.detail.roster}
      className={className}
    >
      <EmptyState
        icon={<Icon icon={UserGroupIcon} />}
        title={messages.detail.rosterEmptyTitle}
        text={messages.detail.rosterEmptyText}
      />
    </SectionCard>
  );
}
