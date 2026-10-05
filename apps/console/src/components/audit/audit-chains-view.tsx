import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  AlertCircleIcon,
  LockKeyIcon,
  SecurityCheckIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { AuditChain, AuditChainPage, AuditChainVerification } from '../../server/audit/types';
import { checkAuditChain } from '../../server/audit-trail';
import type { ServiceResult } from '../../server/service-call';
import { LoadError } from '../load-error';
import { ShortId } from './kind-badge';
import { messages as t } from './messages';

type Check =
  { state: 'checking' } | { state: 'done'; result: ServiceResult<AuditChainVerification> };

const keyOf = (chain: Pick<AuditChain, 'tenant' | 'chainDay'>) =>
  `${chain.tenant}|${chain.chainDay}`;

/**
 * The hash chains per tenant per day (ADR-008 Pipeline steps 4 to 6): how many events each holds,
 * its head, whether it is anchored, and Verify, which recomputes it and compares it with its
 * anchor on the spot.
 */
export function AuditChainsView({
  result,
  verify = (tenant, chainDay) => checkAuditChain({ data: { tenant, chainDay } }),
}: {
  result: ServiceResult<AuditChainPage> | null;
  /** Verifies a chain; tests may stub it. */
  verify?: (tenant: string, chainDay: string) => Promise<ServiceResult<AuditChainVerification>>;
}) {
  const [checks, setChecks] = useState<Record<string, Check>>({});

  async function run(chain: AuditChain) {
    const key = keyOf(chain);
    setChecks((all) => ({ ...all, [key]: { state: 'checking' } }));
    const answer = await verify(chain.tenant, chain.chainDay).catch(
      () => ({ ok: false, error: { kind: 'unavailable', detail: null } }) as const,
    );
    setChecks((all) => ({ ...all, [key]: { state: 'done', result: answer } }));
  }

  const items = result?.ok ? result.data.items : [];
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <p className="border-b px-4 py-3.5 text-[13.5px] text-muted-foreground">{t.chains.intro}</p>
      {result === null ? (
        <div className="space-y-3 p-5" aria-hidden="true">
          {Array.from({ length: 5 }, (_, at) => (
            <Skeleton key={at} className="h-10 w-full" />
          ))}
        </div>
      ) : !result.ok ? (
        <div className="p-5">
          <LoadError
            title={t.chains.loadFailed.title}
            detail={t.chains.loadFailed.body}
            retryLabel={t.chains.loadFailed.retry}
          />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Icon icon={LockKeyIcon} />}
          title={t.chains.emptyTitle}
          description={t.chains.emptyBody}
        />
      ) : (
        <Table caption={t.chains.caption} className="[&_caption]:sr-only">
          <TableHeader>
            <TableRow>
              <TableHead>{t.chains.day}</TableHead>
              <TableHead>{t.chains.tenant}</TableHead>
              <TableHead className="text-right">{t.chains.events}</TableHead>
              <TableHead>{t.chains.head}</TableHead>
              <TableHead>{t.chains.anchor}</TableHead>
              <TableHead>
                <span className="sr-only">{t.chains.verify}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((chain) => {
              const check = checks[keyOf(chain)];
              return (
                <TableRow key={keyOf(chain)}>
                  <TableCell className="whitespace-nowrap tabular-nums">{chain.chainDay}</TableCell>
                  <TableCell>
                    <Badge size="tag">{chain.tenant}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{chain.events}</TableCell>
                  <TableCell className="text-[13px]">
                    <ShortId value={chain.headHash} />
                  </TableCell>
                  <TableCell>
                    {chain.anchor ? (
                      <Badge variant="success">
                        <Icon icon={LockKeyIcon} />
                        {t.chains.anchoredAt(chain.anchor.anchoredAt)}
                      </Badge>
                    ) : (
                      <Badge>{t.chains.notAnchored}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <div className="flex flex-col items-end gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t.chains.verifyLabel(chain.tenant, chain.chainDay)}
                        disabled={check?.state === 'checking'}
                        onClick={() => {
                          void run(chain);
                        }}
                      >
                        {check?.state === 'checking' ? (
                          <Spinner />
                        ) : (
                          <Icon icon={SecurityCheckIcon} />
                        )}
                        {check?.state === 'checking' ? t.chains.verifying : t.chains.verify}
                      </Button>
                      {check?.state === 'done' ? <CheckResult result={check.result} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function CheckResult({ result }: { result: ServiceResult<AuditChainVerification> }) {
  if (!result.ok) {
    return (
      <p role="status" className="text-right text-[12.5px] text-destructive">
        {t.chains.verifyFailed}
      </p>
    );
  }
  const verification = result.data;
  if (verification.status === 'intact') {
    return (
      <div role="status" className="flex flex-col items-end gap-1 text-right">
        <Badge variant="success">
          <Icon icon={Tick02Icon} />
          {t.chains.intact}
        </Badge>
        <span className="text-[12.5px] text-muted-foreground">
          {t.chains.intactDetail(verification.events, verification.anchor.status === 'matches')}
        </span>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col items-end gap-1 text-right">
      <Badge variant="destructive">
        <Icon icon={AlertCircleIcon} />
        {t.chains.tampered}
      </Badge>
      <ul className="text-[12.5px] text-destructive">
        {verification.problems.map((problem, at) => (
          <li key={at}>{t.chains.problemAt(t.chains.problems[problem.kind], problem.seq)}</li>
        ))}
      </ul>
    </div>
  );
}
