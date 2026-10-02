import { Button, Card, CardTitle } from '@adili/ui';
import { Link } from '@tanstack/react-router';
import { Suspense, use } from 'react';

import { LIST_COPY as COPY } from '../../clarification/copy';
import { homeClarifications } from '../../clarification/list';
import type { MyClarificationsLoad } from '../../server/clarifications';
import type { DeclarantClarification } from '../../server/review/types';
import { ClarificationRows } from '../clarification/clarification-list';

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
    <Card asChild className="overflow-hidden p-0 sm:p-0">
      <section aria-labelledby="dashboard-clarifications">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-[18px]">
          <CardTitle id="dashboard-clarifications" className="flex-1">
            {COPY.title}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/clarifications" aria-label={COPY.viewAllLabel}>
              {COPY.viewAll}
            </Link>
          </Button>
        </div>
        <ClarificationRows
          clarifications={homeClarifications(clarifications)}
          all={clarifications}
          now={now}
        />
      </section>
    </Card>
  );
}
