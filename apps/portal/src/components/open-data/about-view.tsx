import { Icon } from '@adili/ui';
import { ArrowDown01Icon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';

import {
  aboutCopy,
  columnWords,
  GLOSSARY,
  type Language,
  tableName,
  langParam,
} from '../../open-data/copy';
import { OPEN_DATA_TABLES, type OpenDataTableName } from '../../server/reporting/types';
import { OpenDataHeading } from './open-data-shell';
import { PageCard } from './page-card';
import { UnshownLegend } from './unshown';

/** Each table's columns as the files carry them (#491 `tables.ts`), the marker last. */
const COLUMNS: Record<OpenDataTableName, string[]> = {
  'filing-by-commission': [
    'commission',
    'commissionName',
    'reportStatus',
    'cycle',
    'expected',
    'filed',
    'nonFilers',
    'filingRate',
  ],
  'compliance-by-commission': [
    'commission',
    'commissionName',
    'determinationsCompliant',
    'determinationsNonCompliant',
    'determinationsFurtherAction',
    'clarificationsIssued',
    'clarificationsResolved',
    'actionsNoticeToComply',
    'actionsWarning',
    'actionsSalaryStoppage',
    'actionsDisciplinaryReferral',
    'referrals',
  ],
  'by-entity-type': ['entityType', 'cycle', 'expected', 'filed', 'nonFilers', 'filingRate'],
  'by-cycle': ['cycle', 'expected', 'filed', 'nonFilers', 'filingRate'],
  'access-requests': ['commission', 'commissionName', 'received', 'granted', 'declined'],
  'national-totals': ['measure', 'value'],
};

const OPERATIONS = [
  '/releases',
  '/releases/{fy}/{kind}/{version}',
  '/releases/{fy}/{kind}/{version}/tables/{table}',
  '/releases/{fy}/{kind}/{version}/tables/{table}.csv',
];

/**
 * About this data (spec 09b FE-4): the privacy rule, the bilingual glossary, every table's
 * columns in English and Swahili, and the public API with an example.
 */
export function AboutView({ language, apiBase }: { language: Language; apiBase: string }) {
  const copy = aboutCopy(language);
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-[880px]">
      <OpenDataHeading
        title={copy.title}
        language={language}
        onLanguage={(next) => {
          void navigate({
            to: '/open-data/about',
            search: { lang: langParam(next) },
          });
        }}
      >
        <Link
          to="/open-data"
          search={{ lang: langParam(language) }}
          className="mb-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-secondary-foreground hover:text-foreground [&_svg]:size-[15px]"
        >
          <Icon icon={ArrowLeft01Icon} />
          {copy.back}
        </Link>
      </OpenDataHeading>
      <div className="grid gap-5">
        <PageCard id="privacy" title={copy.privacy}>
          <UnshownLegend
            threshold={10}
            language={language}
            keys={['suppressed', 'not-reported', 'not-collected']}
          />
          <p className="text-sm text-secondary-foreground">{copy.privacyText}</p>
        </PageCard>

        <PageCard id="definitions" title={copy.definitions}>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {GLOSSARY.map(({ term, meaning }) => (
              <div key={term.en}>
                <dt className="text-sm font-semibold">
                  <span lang="en">{term.en}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span lang="sw" className="font-medium text-secondary-foreground">
                    {term.sw}
                  </span>
                </dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">{meaning[language]}</dd>
              </div>
            ))}
          </dl>
        </PageCard>

        <PageCard id="columns" title={copy.columns}>
          <div className="grid gap-2">
            {OPEN_DATA_TABLES.map((table) => (
              <details
                key={table}
                className="group rounded-xl shadow-[inset_0_0_0_1px_var(--border)]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-mono font-medium">{table}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {tableName(table, language)}
                  </span>
                  <Icon
                    icon={ArrowDown01Icon}
                    className="size-4 text-muted-foreground transition-transform group-open:-scale-y-100"
                  />
                </summary>
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[12.5px] text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">
                          {copy.column}
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium" lang="en">
                          English
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium" lang="sw">
                          Kiswahili
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {[...COLUMNS[table], '_suppressed'].map((column) => {
                        const words = columnWords(column === '_suppressed' ? 'suppressed' : column);
                        const label = (part: 'en' | 'sw') =>
                          words.group
                            ? `${words.group[part]}: ${words[part].toLowerCase()}`
                            : words[part];
                        return (
                          <tr key={column}>
                            <td className="px-4 py-2 font-mono text-[13px]">{column}</td>
                            <td className="px-4 py-2" lang="en">
                              {label('en')}
                            </td>
                            <td className="px-4 py-2" lang="sw">
                              {label('sw')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </PageCard>

        <PageCard id="api" title={copy.api}>
          <ul className="divide-y rounded-xl shadow-[inset_0_0_0_1px_var(--border)]">
            {OPERATIONS.map((path, index) => (
              <li key={path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="rounded-md bg-success-subtle px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-success-subtle-foreground">
                  GET
                </span>
                <code className="font-mono text-[13px]">{path}</code>
                <span className="text-[12.5px] text-muted-foreground">{copy.apiOps[index]}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-secondary-foreground">{copy.apiNote}</p>
          <p className="text-[13px] text-secondary-foreground">{copy.csvNote}</p>
          <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 font-mono text-[12.5px]">
            curl {apiBase}/releases/2025/annual/1/tables/filing-by-commission.csv
          </pre>
        </PageCard>
      </div>
    </div>
  );
}
