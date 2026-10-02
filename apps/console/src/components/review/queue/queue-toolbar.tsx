import {
  Button,
  CopyButton,
  FilterChip,
  Icon,
  PRIORITY_BADGE_MESSAGES,
  Select,
  SelectItem,
} from '@adili/ui';
import {
  Cancel01Icon,
  Clock01Icon,
  MessageQuestionIcon,
  WifiOff02Icon,
} from '@hugeicons/core-free-icons';
import { useId } from 'react';

import { CASE_COPY } from '../../../review-case/messages';
import { CASE_STATUSES } from '../../../review-case/labels';
import { QUEUE_COPY as m } from '../../../review-queue/messages';
import {
  QUEUE_BANDS,
  QUEUE_FILTER_STATUSES,
  QUEUE_TYPES,
  type QueueSearch,
  hasQueueFilters,
  toggleSwitch,
  withFilter,
} from '../../../review-queue/query';
import type { Reviewer } from '../../../server/review-case.server';
import { SearchBox } from '../../search-box';

/** Radix Select items cannot have an empty value, so "all" is this sentinel. */
const ALL = 'all';
const ANY = 'any';

export interface QueueToolbarProps {
  search: QueueSearch;
  onSearchChange: (next: QueueSearch, options?: { replace?: boolean }) => void;
  /** Statement years to filter by. */
  cycles: readonly number[];
  /** A supervisor's reviewers to filter by (themselves aside: that is Mine); null for reviewers. */
  reviewers: readonly Reviewer[] | null;
  /** The page's address, for Copy link. */
  href: string;
}

const SELECT = 'h-9 w-auto text-sm';

/**
 * The queue's filters (spec 07a FE-2, spec 07b's Registry unavailable): search, status, priority,
 * type, cycle and assignee on the first row; the switches, Clear filters and Copy link on the
 * second. Every change goes to the URL (S19).
 */
export function QueueToolbar({
  search,
  onSearchChange,
  cycles,
  reviewers,
  href,
}: QueueToolbarProps) {
  const id = useId();
  const assignee = search.assignee ?? ANY;
  const knownReviewer =
    assignee === ANY ||
    assignee === 'mine' ||
    assignee === 'unassigned' ||
    (reviewers ?? []).some((reviewer) => reviewer.subject === assignee);

  return (
    <div role="search" className="flex flex-col gap-2.5 border-b px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          id={`${id}-search`}
          label={m.searchLabel}
          placeholder={m.searchPlaceholder}
          maxLength={100}
          applied={search.search ?? ''}
          // Wide enough for the whole placeholder, short of a phone too narrow for it.
          className="max-w-105 min-w-[min(100%,280px)] flex-1"
          onSearch={(value) => {
            onSearchChange(withFilter(search, 'search', value || undefined), { replace: true });
          }}
        />
        <Select
          aria-label={m.statusLabel}
          value={search.status ?? ALL}
          className={`${SELECT} min-w-36`}
          onValueChange={(value) => {
            onSearchChange(
              withFilter(
                search,
                'status',
                QUEUE_FILTER_STATUSES.find((status) => status === value),
              ),
            );
          }}
        >
          <SelectItem value={ALL}>{m.statusAll}</SelectItem>
          {QUEUE_FILTER_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {CASE_STATUSES[status].label}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label={m.priorityLabel}
          value={search.band ?? ALL}
          className={`${SELECT} min-w-34`}
          onValueChange={(value) => {
            onSearchChange(
              withFilter(
                search,
                'band',
                QUEUE_BANDS.find((band) => band === value),
              ),
            );
          }}
        >
          <SelectItem value={ALL}>{m.priorityAll}</SelectItem>
          {QUEUE_BANDS.map((band) => (
            <SelectItem key={band} value={band}>
              {PRIORITY_BADGE_MESSAGES.bands[band]}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label={m.typeLabel}
          value={search.type ?? ALL}
          className={`${SELECT} min-w-28`}
          onValueChange={(value) => {
            onSearchChange(
              withFilter(
                search,
                'type',
                QUEUE_TYPES.find((type) => type === value),
              ),
            );
          }}
        >
          <SelectItem value={ALL}>{m.typeAll}</SelectItem>
          {QUEUE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {CASE_COPY.type[type]}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label={m.cycleLabel}
          value={search.cycle === undefined ? ALL : String(search.cycle)}
          className={`${SELECT} min-w-28`}
          onValueChange={(value) => {
            onSearchChange(withFilter(search, 'cycle', value === ALL ? undefined : Number(value)));
          }}
        >
          <SelectItem value={ALL}>{m.cycleAll}</SelectItem>
          {cycles.map((year) => (
            <SelectItem key={year} value={String(year)}>
              {String(year)}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label={m.assigneeLabel}
          value={assignee}
          className={`${SELECT} min-w-30`}
          onValueChange={(value) => {
            onSearchChange(withFilter(search, 'assignee', value === ANY ? undefined : value));
          }}
        >
          <SelectItem value={ANY}>{m.assigneeAny}</SelectItem>
          <SelectItem value="mine">{m.assigneeMine}</SelectItem>
          <SelectItem value="unassigned">{m.assigneeUnassigned}</SelectItem>
          {(reviewers ?? []).map((reviewer) => (
            <SelectItem key={reviewer.subject} value={reviewer.subject}>
              {reviewer.name}
            </SelectItem>
          ))}
          {/* A reviewer from a shared link who holds no case now. */}
          {knownReviewer ? null : <SelectItem value={assignee}>{m.assigneeOther}</SelectItem>}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          icon={Clock01Icon}
          pressed={search.late === true}
          onPressedChange={() => {
            onSearchChange(toggleSwitch(search, 'late'));
          }}
        >
          {m.late}
        </FilterChip>
        <FilterChip
          icon={MessageQuestionIcon}
          pressed={search.openClarification === true}
          onPressedChange={() => {
            onSearchChange(toggleSwitch(search, 'openClarification'));
          }}
        >
          {m.openClarification}
        </FilterChip>
        <FilterChip
          icon={WifiOff02Icon}
          pressed={search.registryUnavailable === true}
          onPressedChange={() => {
            onSearchChange(toggleSwitch(search, 'registryUnavailable'));
          }}
        >
          {m.registryUnavailable}
        </FilterChip>
        {hasQueueFilters(search) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearchChange({});
            }}
          >
            <Icon icon={Cancel01Icon} />
            {m.clear}
          </Button>
        ) : null}
        <CopyButton
          value={href}
          label={m.copyLink}
          title={m.copyLinkHint}
          copiedMessage={m.linkCopied}
          showLabel
          size="sm"
          className="ml-auto"
        />
      </div>
    </div>
  );
}
