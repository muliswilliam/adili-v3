import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Icon,
  type IconProps,
  IconTile,
  Spinner,
  type Tone,
  toneClassNames,
  cn,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Clock01Icon,
  Download04Icon,
  InboxIcon,
  PackageIcon,
  SentIcon,
  Tick02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import type { ReferralIntakeItem } from '../../server/reporting/types';
import { ConfidentialBadge } from '../referrals/badges';
import { IcmsStatusBadge } from './badges';
import { Fact } from './fact';
import { messages as t } from './messages';
import { PushButton, pushable } from './push-button';

interface HistoryEntry {
  key: string;
  title: string;
  detail: string;
  icon: IconProps['icon'];
  tone: Tone;
}

/** What happened to the referral at EACC, the latest first. */
function intakeHistory(referral: ReferralIntakeItem): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  if (referral.icmsStatus === 'registered' && referral.icmsCaseNumber) {
    entries.push({
      key: 'registered',
      title: t.detail.registered(referral.icmsCaseNumber),
      detail: referral.icmsRegisteredAt ? t.detail.at(referral.icmsRegisteredAt) : '',
      icon: Tick02Icon,
      tone: 'success',
    });
  }
  if (referral.icmsStatus === 'push-failed' && referral.pushedAt) {
    const why = referral.error ? ` · ${t.pushErrors[referral.error]}` : '';
    entries.push({
      key: 'failed',
      title: t.detail.pushFailed,
      detail: `${t.detail.at(referral.pushedAt)}${why}`,
      icon: AlertCircleIcon,
      tone: 'destructive',
    });
  }
  if (referral.pushedAt && referral.pushedBy) {
    entries.push({
      key: 'pushed',
      title: t.detail.pushedBy(referral.pushedBy.name),
      detail: t.detail.at(referral.pushedAt),
      icon: SentIcon,
      tone: 'default',
    });
  }
  entries.push({
    key: 'received',
    title: t.detail.received,
    detail: t.detail.at(referral.sentAt),
    icon: InboxIcon,
    tone: 'default',
  });
  return entries;
}

/**
 * One referral received (spec 09 FE-5): its grounds and their legal basis, the declaration cycle,
 * the ICMS case number once registered, the Confidential evidence package, where the push stands
 * and its history. Push to ICMS (or Retry) for a referral not yet in ICMS.
 */
export function ReferralIntakeDrawer({
  referral,
  onClose,
  onPush,
  onDownload,
  downloading,
}: {
  /** The referral opened; null when closed. */
  referral: ReferralIntakeItem | null;
  onClose: () => void;
  onPush: (referral: ReferralIntakeItem) => void;
  onDownload: (referral: ReferralIntakeItem) => void;
  downloading: boolean;
}) {
  return (
    <Drawer
      open={referral !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {referral ? (
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-mono">{referral.reference}</DrawerTitle>
            <DrawerDescription>
              {t.detail.subtitle(referral.commission.name, referral.sentAt)}
            </DrawerDescription>
            <div className="mt-2.5">
              <IcmsStatusBadge status={referral.icmsStatus} />
            </div>
          </DrawerHeader>
          <DrawerBody className="gap-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Fact term={t.detail.grounds}>{t.grounds[referral.grounds]}</Fact>
              <Fact term={t.detail.legalBasis}>{t.legalBasis[referral.grounds]}</Fact>
              <Fact term={t.detail.cycle}>{String(referral.cycleYear)}</Fact>
              {referral.icmsCaseNumber ? (
                <Fact term={t.detail.caseNumber}>
                  <span className="font-mono font-normal">{referral.icmsCaseNumber}</span>
                </Fact>
              ) : null}
            </dl>

            <div className="flex items-center gap-3 rounded-xl px-3.5 py-3 ring-1 ring-border">
              <IconTile tone="destructive">
                <Icon icon={PackageIcon} />
              </IconTile>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.detail.packageTitle}</div>
                <div className="mt-1">
                  <ConfidentialBadge />
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={downloading}
                onClick={() => {
                  onDownload(referral);
                }}
              >
                {downloading ? <Spinner /> : <Icon icon={Download04Icon} />}
                {t.detail.download}
              </Button>
            </div>

            <StatusCallout referral={referral} />

            <section aria-labelledby="intake-history">
              <h3 id="intake-history" className="mb-2.5 text-sm font-semibold">
                {t.detail.history}
              </h3>
              <ol className="grid gap-3.5">
                {intakeHistory(referral).map((entry) => (
                  <li key={entry.key} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5',
                        toneClassNames[entry.tone],
                      )}
                    >
                      <Icon icon={entry.icon} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium">{entry.title}</div>
                      <div className="text-[13px] text-muted-foreground">{entry.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </DrawerBody>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="secondary">{t.detail.close}</Button>
            </DrawerClose>
            {pushable(referral) ? (
              <PushButton referral={referral} variant="default" onPush={onPush} />
            ) : null}
          </DrawerFooter>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function StatusCallout({ referral }: { referral: ReferralIntakeItem }) {
  if (referral.icmsStatus === 'push-failed') {
    return (
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{t.detail.failedTitle}</AlertTitle>
        {referral.error ? (
          <AlertDescription>{t.pushErrors[referral.error]}</AlertDescription>
        ) : null}
      </Alert>
    );
  }
  if (referral.icmsStatus === 'pushed') {
    return (
      <Alert variant="info">
        <Icon icon={Clock01Icon} />
        <AlertDescription>{t.detail.waiting}</AlertDescription>
      </Alert>
    );
  }
  if (referral.icmsStatus === 'registered' && referral.icmsCaseNumber) {
    return (
      <Alert variant="success">
        <Icon icon={ViewIcon} />
        <AlertDescription>{t.detail.commissionSees(referral.icmsCaseNumber)}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
