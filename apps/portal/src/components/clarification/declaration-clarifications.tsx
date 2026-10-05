import { Suspense, use } from 'react';

import { LIST_COPY as COPY } from '../../clarification/copy';
import { declarationClarifications } from '../../clarification/list';
import type { MyClarificationsLoad } from '../../server/clarifications';
import { ClarificationRows, ClarificationsCardFrame } from './clarification-list';

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
      <LoadedSection promise={clarifications} references={references} className={className} />
    </Suspense>
  );
}

function LoadedSection({
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
    <ClarificationsCardFrame
      titleId="declaration-clarifications"
      title={COPY.onDeclaration}
      className={className}
    >
      <ClarificationRows clarifications={ours} all={load.clarifications} now={load.now} />
    </ClarificationsCardFrame>
  );
}
