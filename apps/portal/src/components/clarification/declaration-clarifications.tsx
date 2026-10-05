import { Button, Card, CardTitle, cn } from '@adili/ui';
import { Link } from '@tanstack/react-router';
import { Suspense, use } from 'react';

import { LIST_COPY as COPY } from '../../clarification/copy';
import { declarationClarifications } from '../../clarification/list';
import type { MyClarificationsLoad } from '../../server/clarifications';
import { ClarificationRows } from './clarification-list';

/**
 * The clarifications about one declaration, on its page (spec 07a FE-5, story 31): each with
 * its status, opening it to read the letter and respond. The route loader does not wait for the
 * list: nothing shows until it arrives, and nothing when there are none or it fails (the
 * Clarifications page says so and offers a retry).
 */
export function DeclarationClarificationsSection({
  clarifications,
  references,
  className,
}: {
  clarifications: Promise<MyClarificationsLoad>;
  /** The declaration's version references, which its clarifications name. */
  references: string[];
  className?: string;
}) {
  return (
    <Suspense fallback={null}>
      <ResolvedSection promise={clarifications} references={references} className={className} />
    </Suspense>
  );
}

function ResolvedSection({
  promise,
  references,
  className,
}: {
  promise: Promise<MyClarificationsLoad>;
  references: string[];
  className?: string;
}) {
  const load = use(promise);
  if (load.status !== 'ok') return null;
  const ours = declarationClarifications(load.clarifications, references);
  if (ours.length === 0) return null;
  return (
    <Card asChild className={cn('overflow-hidden p-0 sm:p-0', className)}>
      <section aria-labelledby="declaration-clarifications">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-[18px]">
          <CardTitle id="declaration-clarifications" className="flex-1">
            {COPY.onDeclaration}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/clarifications" aria-label={COPY.viewAllLabel}>
              {COPY.viewAll}
            </Link>
          </Button>
        </div>
        <ClarificationRows clarifications={ours} all={load.clarifications} now={load.now} />
      </section>
    </Card>
  );
}
