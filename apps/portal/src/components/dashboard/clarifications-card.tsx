import { Suspense, use } from 'react';

import { LIST_COPY as COPY } from '../../clarification/copy';
import { homeClarifications } from '../../clarification/list';
import type { MyClarificationsLoad } from '../../server/clarifications';
import type { DeclarantClarification } from '../../server/review/types';
import { ClarificationRows, ClarificationsCardFrame } from '../clarification/clarification-list';

/**
 * The dashboard's "Clarifications" card (spec 07a FE-5): shown only once the declarant has
 * any, listing those that need a response (or the latest two when none does), with View all.
 * The route loader does not wait for the list: nothing shows until it arrives, and nothing when
 * it fails (the Clarifications page says so and offers a retry).
 */
export function ClarificationsSection({
  clarifications,
}: {
  clarifications: Promise<MyClarificationsLoad>;
}) {
  return (
    <Suspense fallback={null}>
      <ResolvedClarificationsCard promise={clarifications} />
    </Suspense>
  );
}

function ResolvedClarificationsCard({ promise }: { promise: Promise<MyClarificationsLoad> }) {
  const load = use(promise);
  if (load.status !== 'ok' || load.clarifications.length === 0) return null;
  return <ClarificationsCard clarifications={load.clarifications} now={load.now} />;
}

export function ClarificationsCard({
  clarifications,
  now,
}: {
  clarifications: DeclarantClarification[];
  /** The server's clock when the list loaded. */
  now: string;
}) {
  return (
    <ClarificationsCardFrame titleId="dashboard-clarifications" title={COPY.title}>
      <ClarificationRows
        clarifications={homeClarifications(clarifications)}
        all={clarifications}
        now={now}
      />
    </ClarificationsCardFrame>
  );
}
