import { formatDateTime, groundMeta } from '@adili/ui';
import { CheckmarkCircle02Icon, UnavailableIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { OutcomeLine, SideCard } from '../side-cards';
import type { Decision } from './decision-rules';
import { messages as m } from './messages';
import { scopeText } from './scope-text';

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * A decision as recorded (S6), final: the outcome, the scope a partial grant released, the
 * Regulation 24 grounds cited, the reasons, and who decided when. Form K and law enforcement
 * requests (#265) alike; the supervisor reads it too.
 */
export function DecidedCard({ decision }: { decision: Decision }) {
  const deny = decision.outcome === 'deny';
  return (
    <SideCard
      id="decision"
      title={m.decisionTitle}
      actions={<span className="text-[13px] text-muted-foreground">{m.final}</span>}
    >
      <OutcomeLine
        icon={deny ? UnavailableIcon : CheckmarkCircle02Icon}
        tone={deny ? 'destructive' : 'success'}
      >
        {m.decided[decision.outcome]}
      </OutcomeLine>
      <dl className="grid gap-3 text-sm">
        {decision.outcome === 'partial-grant' && decision.grantedScope ? (
          <Item term={m.grantedScope}>
            <span className="font-medium">{scopeText(decision.grantedScope)}</span>
          </Item>
        ) : null}
        {decision.grounds.length > 0 ? (
          <Item term={m.grounds}>
            <ul className="grid gap-0.5 font-medium">
              {decision.grounds.map((ground) => (
                <li key={ground}>{groundMeta[ground].label}</li>
              ))}
            </ul>
          </Item>
        ) : null}
        <Item term={m.reasons}>
          <span className="whitespace-pre-line">{decision.reasons}</span>
        </Item>
        <Item term={m.decidedBy}>
          <span className="font-medium">
            {decision.decidedBy.name} · {formatDateTime(decision.decidedAt)}
          </span>
        </Item>
      </dl>
    </SideCard>
  );
}
