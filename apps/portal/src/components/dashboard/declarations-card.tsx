import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  formatDate,
  formatDateTime,
  Icon,
  ProgressBar,
  Skeleton,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Clock01Icon,
  File01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, Suspense, use } from 'react';

import { DISCARDED_TOAST, DiscardDraftButton } from '../declaration/discard-dialog';
import { OBLIGATION_TYPE_LABELS } from '../../declaration/labels';
import { orderDeclarations } from '../../declaration/my-declarations';
import type { DeclarationListResult } from '../../server/declarations.server';
import type { DeclarationListItem, DeclarationStatus } from '../../server/declarations/types';

const STATUS_BADGES: Record<
  DeclarationStatus,
  { label: string; variant: 'default' | 'brand' | 'success' }
> = {
  draft: { label: 'Draft', variant: 'brand' },
  amending: { label: 'Amending', variant: 'brand' },
  submitted: { label: 'Submitted', variant: 'success' },
  discarded: { label: 'Discarded', variant: 'default' },
};

/**
 * A filed declaration says which version is in force and when it was submitted; a draft or an
 * amendment says when it was last saved.
 */
function facts(item: DeclarationListItem): string {
  const statementDate = `Statement date ${formatDate(item.statementDate)}`;
  if (item.status === 'submitted' && item.currentVersion !== null && item.submittedAt !== null) {
    return `${statementDate} · Version ${String(item.currentVersion)} · Submitted ${formatDateTime(item.submittedAt)}`;
  }
  return `${statementDate} · Saved ${formatDateTime(item.updatedAt)}`;
}

const isOpen = (item: DeclarationListItem) => item.status === 'draft' || item.status === 'amending';

function DeclarationRow({ item }: { item: DeclarationListItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const title = `${OBLIGATION_TYPE_LABELS[item.type]} declaration`;
  const badge = STATUS_BADGES[item.status];
  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid flex-1 gap-0.5">
          <h3 className="font-semibold">
            {title} · {item.commission.name}
          </h3>
          <p className="text-sm text-muted-foreground">{facts(item)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.status === 'submitted' && item.late ? (
            <Badge variant="warning">
              <Icon icon={Clock01Icon} />
              Filed late
            </Badge>
          ) : null}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>
      {isOpen(item) ? (
        <>
          <div className="flex max-w-[360px] items-center gap-3">
            <ProgressBar
              className="flex-1"
              label={`${title} progress`}
              value={item.completenessPercent}
              size="sm"
              showValue={false}
            />
            <span className="text-sm font-semibold tabular-nums">
              {item.completenessPercent}% complete
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link
                to="/declarations/$id"
                params={{ id: item.id }}
                aria-label={`Continue ${title}`}
              >
                Continue
                <Icon icon={ArrowRight01Icon} />
              </Link>
            </Button>
            {item.status === 'draft' ? (
              <DiscardDraftButton
                declarationId={item.id}
                label="Discard"
                srContext={title}
                onDiscarded={async () => {
                  toast({ title: DISCARDED_TOAST });
                  await router.invalidate();
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </li>
  );
}

/**
 * "Your declarations" while `declarations` is on its way (a placeholder row), then the card: the
 * route loader does not wait for them, so the rest of the dashboard renders at once.
 */
export function DeclarationsSection({
  declarations,
}: {
  declarations: Promise<DeclarationListResult>;
}) {
  return (
    <Suspense fallback={<DeclarationsCardSkeleton />}>
      <ResolvedDeclarationsCard promise={declarations} />
    </Suspense>
  );
}

function ResolvedDeclarationsCard({ promise }: { promise: Promise<DeclarationListResult> }) {
  return <DeclarationsCard declarations={use(promise)} />;
}

function DeclarationsCardFrame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your declarations</CardTitle>
        <CardDescription>Drafts save as you type. Continue where you left off.</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

/** The card with a placeholder row while the declarations load. */
export function DeclarationsCardSkeleton() {
  return (
    <DeclarationsCardFrame>
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading your declarations"
        className="grid gap-3"
      >
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="w-2/5" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </DeclarationsCardFrame>
  );
}

/**
 * "Your declarations" on the dashboard (FE-9, S16): each draft with its completeness,
 * Continue and Discard; other declarations are listed read-only, with their versions, slips
 * and amending on My declarations (spec 06 FE-4).
 */
export function DeclarationsCard({ declarations }: { declarations: DeclarationListResult }) {
  const items = declarations.status === 'ok' ? orderDeclarations(declarations.declarations) : [];
  return (
    <DeclarationsCardFrame
      footer={
        items.length > 0 ? (
          <Button asChild variant="secondary" size="sm">
            <Link to="/declarations">
              My declarations
              <Icon icon={ArrowRight01Icon} />
            </Link>
          </Button>
        ) : null
      }
    >
      {declarations.status === 'unavailable' ? (
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>
            We could not load your declarations. Try again in a few minutes.
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Icon icon={File01Icon} />}
          title="No declarations yet"
          text="Start one from your filing obligations when it is due."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <DeclarationRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </DeclarationsCardFrame>
  );
}
