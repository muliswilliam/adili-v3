import type { IconProps } from '@adili/ui';
import type { ComponentType } from 'react';

import type { InboxKind } from '../../approvals/kinds';
import type { InboxItem } from '../../server/approvals.server';
import type { Assignee } from '../../server/review/types';
import type { FailureText } from '../dialog-parts';

/**
 * What one kind of approval brings to the inbox (spec 08 FE-3). The inbox owns the page, the
 * tabs, counts, paging, Reassign and the refusal dialog's frame; each kind owns its tab label and
 * icon, its card, its decision dialogs (approve, and return or decline), the calls behind them and
 * what their refusals mean. See `kinds.tsx` for the registry and how to add a kind.
 */

/** The inbox item of kind `K`. */
export type ItemOf<K extends InboxKind> = Extract<InboxItem, { kind: K }>;

/** A refusal or conflict the inbox shows in a dialog after a kind's decision call. */
export interface ApprovalNotice {
  title: string;
  /** In red: what was refused, with the problem it answered. */
  failure: FailureText;
  /** What it means now, under it; null for nothing more to say. */
  after: string | null;
  /** Offer Reassign to another supervisor (a separation-of-duties refusal). */
  offerReassign: boolean;
}

/** How a kind's decision call ended: the inbox refreshes the list either way. */
export type Settled =
  { kind: 'decided'; toast: string } | { kind: 'notice'; notice: ApprovalNotice };

export interface KindApprovalProps<I extends InboxItem> {
  item: I;
  viewer: Assignee;
  /** The server's clock when the inbox loaded, for how long it has waited. */
  now: number;
  /** Opens Reassign for this approval. */
  onReassign: () => void;
  /** A decision call answered: the inbox toasts or shows the notice, then reloads. */
  onSettled: (settled: Settled) => Promise<void>;
  /** A fresh Idempotency-Key per decision; tests fix it. */
  newKey: () => string;
}

export interface InboxKindView<K extends InboxKind> {
  /** The tab's label. */
  label: string;
  icon: IconProps['icon'];
  /** What the approval is about, in a dialog's subtitle ("DCB-… · Esther Moraa Onyango"). */
  subject: (item: ItemOf<K>) => string;
  /** The card with its decision dialogs. */
  Approval: ComponentType<KindApprovalProps<ItemOf<K>>>;
}
