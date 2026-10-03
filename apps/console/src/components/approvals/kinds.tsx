import { DEFAULT_INBOX_KIND, type InboxKind } from '../../approvals/kinds';
import { determinationKind } from './determination-approval';
import type { InboxKindView, ItemOf, KindApprovalProps } from './kind';

/**
 * The approvals inbox's kinds (spec 08 FE-3), one entry each, in `INBOX_KINDS` order.
 *
 * Adding a kind (the ladder's actions #205/#208, referrals #211):
 * 1. `approvals/kinds.ts`: add it to `INBOX_KINDS`, its summary type to `Summaries` and its zod
 *    schema to `SUMMARIES` (the fields review's `ApprovalSource` puts in `summary` for it).
 * 2. A `<kind>-approval.tsx` exporting an `InboxKindView<'<kind>'>`: tab label and icon, `subject`,
 *    and `Approval`, the card with its own dialogs and calls (approve, and decline with a note for
 *    actions and referrals), turning each answer into `onSettled` (a toast, or an
 *    `ApprovalNotice` for a refusal, with Reassign for separation of duties).
 * 3. Add it here. The type below fails until every inbox kind has an entry.
 * 4. The review mock: a `MockApprovalSource<'<kind>'>` in the kind's own mock module (as
 *    `determinationApprovals` in `server/review/determinations-mock.server.ts`), registered in the
 *    `sources` record `server/review/mock.server.ts` passes to `resetApprovalsMock`; that record
 *    is keyed by `INBOX_KINDS`, so the type check fails until it is. Shared mock types are in
 *    `server/review/mock-parts.server.ts`.
 * Bulk closures (#202) are not inbox items; they have their own page.
 */
export const KINDS: { [K in InboxKind]: InboxKindView<K> } = {
  determination: determinationKind,
};

export { DEFAULT_INBOX_KIND };

/** The view of an item's kind; type-safe for a union of kinds (checked with two). */
export function kindOf<K extends InboxKind>(item: ItemOf<K>): InboxKindView<K> {
  return KINDS[item.kind];
}

/** An item's card, by its kind. */
export function KindApproval<K extends InboxKind>(props: KindApprovalProps<ItemOf<K>>) {
  const { Approval } = kindOf<K>(props.item);
  return <Approval {...props} />;
}
