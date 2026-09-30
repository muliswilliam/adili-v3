import { Card, Icon, QrCode } from '@adili/ui';
import {
  File01Icon,
  QrCodeIcon,
  SecurityCheckIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router';

import { CodeForm } from '../components/code-form';
import { verifyMessages as copy } from '../copy';

/** The code printed on the sample footer, and the host its QR code points at. */
const SAMPLE_CODE = 'ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P';
const SAMPLE_HOST = 'verify.adili.go.ke';

export const Route = createFileRoute('/')({
  // "Edit code" on a not-found result comes back with the code to correct.
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search.code === 'string' && search.code.length <= 40 ? { code: search.code } : {},
  component: VerifyHome,
});

function VerifyHome() {
  const navigate = useNavigate();
  const { code } = Route.useSearch();
  const pending = useRouterState({ select: (state) => state.status === 'pending' });

  return (
    <div className="grid gap-[26px]">
      <div className="text-center">
        <div className="mx-auto mb-[18px] flex size-[52px] items-center justify-center rounded-item bg-brand-subtle text-brand-subtle-foreground">
          <Icon icon={QrCodeIcon} className="size-[26px]" />
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance">
          {copy.homeHeading}
        </h1>
        <p className="mt-2.5 text-[15.5px] text-pretty text-muted-foreground">{copy.homeIntro}</p>
      </div>
      <Card>
        <CodeForm
          key={code}
          initialCode={code}
          pending={pending}
          onSubmit={(verificationId) => {
            void navigate({ to: '/v/$verificationId', params: { verificationId } });
          }}
        />
      </Card>
      <div className="mt-1.5 grid gap-7">
        <section aria-labelledby="where-heading">
          <h2 id="where-heading" className="text-base font-semibold tracking-[-0.01em]">
            {copy.whereHeading}
          </h2>
          <figure className="mt-3 flex items-center gap-3.5 rounded-xl bg-card p-3.5 shadow-card">
            <QrCode
              value={`https://${SAMPLE_HOST}/v/${SAMPLE_CODE}`}
              label={copy.whereAlt}
              size={64}
            />
            <figcaption className="min-w-0 text-[13px] text-muted-foreground">
              <span className="block">{copy.whereVerifyAt(SAMPLE_HOST)}</span>
              <span className="my-1 inline-block rounded-xs bg-highlight font-mono text-[11.5px] font-semibold tracking-[0.03em] text-balance text-foreground ring-3 ring-highlight sm:text-[13px]">
                {SAMPLE_CODE}
              </span>
              <span className="block">{copy.whereSample}</span>
            </figcaption>
          </figure>
        </section>
        <section aria-labelledby="shows-heading">
          <h2 id="shows-heading" className="text-base font-semibold tracking-[-0.01em]">
            {copy.showsHeading}
          </h2>
          <ul className="mt-3 grid gap-2.5 text-[14.5px]">
            <ShowsItem icon={SecurityCheckIcon} className="bg-success-subtle text-success">
              {copy.showsGenuine}
            </ShowsItem>
            <ShowsItem icon={File01Icon} className="bg-muted text-secondary-foreground">
              {copy.showsDetails}
            </ShowsItem>
            <ShowsItem icon={ViewOffSlashIcon} className="bg-destructive-subtle text-destructive">
              {copy.showsNever}
            </ShowsItem>
          </ul>
          <Link
            to="/about"
            className="mt-3 inline-block text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {copy.showsMore}
          </Link>
        </section>
      </div>
    </div>
  );
}

function ShowsItem({
  icon,
  className,
  children,
}: {
  icon: typeof File01Icon;
  className: string;
  children: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex size-[30px] shrink-0 items-center justify-center rounded-lg ${className}`}
      >
        <Icon icon={icon} />
      </span>
      {children}
    </li>
  );
}
