import { Button, formatNumber, Icon, InfoTip, QrCode } from '@adili/ui';
import { Download04Icon, SecurityCheckIcon, Table01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { type Language, pageCopy, tableName, langParam } from '../../open-data/copy';
import type { OpenDataRelease } from '../../server/reporting/types';
import { PageCard } from './page-card';

/**
 * A release's file through the portal (`routes/api/open-data/...`): `<table>.csv` or
 * `release.json`, served as the public API serves it.
 */
export function fileHref(
  release: Pick<OpenDataRelease, 'fy' | 'kind' | 'version'>,
  file: string,
): string {
  return `/api/open-data/${String(release.fy)}/${release.kind}/${String(release.version)}/${file}`;
}

/**
 * The downloads of a release (spec 09b FE-4, S8): each table's CSV with its rows and SHA-256,
 * the release JSON, and the release's verification (QR, code and link to the verify page).
 */
export function DownloadsCard({
  release,
  language,
}: {
  release: OpenDataRelease;
  language: Language;
}) {
  const copy = pageCopy(language);
  return (
    <PageCard
      id="downloads"
      title={copy.downloads}
      tools={
        <Button asChild variant="secondary" size="sm">
          <a href={fileHref(release, 'release.json')} download>
            <Icon icon={Download04Icon} />
            {copy.releaseJson}
          </a>
        </Button>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">{copy.csvPerTable}</p>
          <ul className="divide-y rounded-xl shadow-[inset_0_0_0_1px_var(--border)]">
            {release.tables.map((file) => (
              <li key={file.table} className="flex items-center gap-3 px-3.5 py-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4"
                >
                  <Icon icon={Table01Icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {tableName(file.table, language)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
                    <span className="font-mono">{file.table}.csv</span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {copy.rows(formatNumber(file.rows))}
                      <InfoTip
                        label={copy.sha256}
                        content={
                          <span className="font-mono break-all">SHA-256 {file.sha256Csv}</span>
                        }
                      />
                    </span>
                  </div>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={fileHref(release, `${file.table}.csv`)}
                    download
                    aria-label={copy.downloadCsv(`${file.table}.csv`)}
                  >
                    <Icon icon={Download04Icon} />
                    <span className="hidden sm:inline">CSV</span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
          <div className="flex items-center gap-3">
            <QrCode
              value={release.verifyUrl}
              label={copy.qrLabel}
              size={76}
              className="shrink-0 rounded-md"
            />
            <div className="min-w-0">
              <div className="text-[12.5px] text-muted-foreground">{copy.verificationCode}</div>
              <div className="font-mono text-[13px] font-medium break-all">
                {release.manifestVerificationId}
              </div>
            </div>
          </div>
          <p className="text-[12.5px] text-muted-foreground">{copy.verifyHint}</p>
          <Button asChild variant="secondary" size="sm" className="self-start">
            <a href={release.verifyUrl} target="_blank" rel="noopener noreferrer">
              <Icon icon={SecurityCheckIcon} />
              {copy.verify}
            </a>
          </Button>
        </div>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        <Link
          to="/open-data/about"
          search={{ lang: langParam(language) }}
          className="font-medium text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground"
        >
          {copy.aboutLink}
        </Link>
      </p>
    </PageCard>
  );
}
