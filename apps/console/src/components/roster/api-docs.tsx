import { Card, CodeBlock, CodeComment, CodeKeyword, CodeString } from '@adili/ui';
import type { ReactNode } from 'react';

import type { RosterApiEndpoints } from '../../server/roster-api-endpoints';
import { ROSTER_API_RATE_LIMITS, ROSTER_BATCH_MAX_ROWS } from '../../server/directory/contract';
import { messages as m } from './messages';

/** The scope every HR-system credential carries. */
export const ROSTER_WRITE_SCOPE = 'roster:write';

/** Example Idempotency-Keys: any UUID, new for each logical request. */
const BATCH_KEY = '7f1c9a2e-5b8d-4e61-9c0a-2d3f4e5a6b7c';
const EXIT_KEY = '3b9e2f10-8c4a-4d7e-a1b2-c3d4e5f60718';

/**
 * Where the examples send their requests, for the viewer's Commission: the batch creates an
 * officer whose file number has slashes, and the exit encodes it (`/` as `%2F`).
 */
export function apiDocsExamples(slug: string, baseUrl: string) {
  const commission = `${baseUrl}/v1/commissions/${slug}/roster`;
  const fileNumber = `${slug.toUpperCase()}/2014/0457`;
  return {
    imports: `${commission}/imports`,
    importReport: `${commission}/imports/{importId}`,
    rejectedRows: `${commission}/imports/{importId}/rows?status=rejected`,
    exit: `${commission}/records/${encodeURIComponent(fileNumber)}/exit`,
    fileNumber,
  };
}

const K = CodeKeyword;
const S = CodeString;
const C = CodeComment;

/** `curl` with its first argument, the way every example starts. */
function Curl({ post = false, url }: { post?: boolean; url: string }) {
  return (
    <>
      <K>curl</K>
      {post ? ' -X POST ' : ' '}
      <S>{`'${url}'`}</S>
    </>
  );
}

const AUTH = <S>&quot;Authorization: Bearer $TOKEN&quot;</S>;

interface DocSection {
  id: string;
  title: string;
  text: string;
  code: ReactNode;
}

function sections(slug: string, { baseUrl, tokenEndpoint }: RosterApiEndpoints): DocSection[] {
  const urls = apiDocsExamples(slug, baseUrl);
  const { write } = ROSTER_API_RATE_LIMITS;
  return [
    {
      id: 'token',
      title: m.docsTokenTitle,
      text: m.docsTokenText,
      code: (
        <>
          <Curl post url={tokenEndpoint} /> \{'\n  '}-d{' '}
          <S>&apos;grant_type=client_credentials&apos;</S> \{'\n  '}-d{' '}
          <S>&quot;client_id=$ADILI_CLIENT_ID&quot;</S> \{'\n  '}-d{' '}
          <S>&quot;client_secret=$ADILI_CLIENT_SECRET&quot;</S>
          {'\n\n'}
          <C># 200 OK</C>
          {
            '\n{ "access_token": "eyJhbGciOiJSUzI1NiIs…", "expires_in": 300, "token_type": "Bearer", … }'
          }
        </>
      ),
    },
    {
      id: 'batch',
      title: m.docsBatchTitle,
      text: m.docsBatchText(ROSTER_BATCH_MAX_ROWS),
      code: (
        <>
          <Curl post url={urls.imports} /> \{'\n  '}-H {AUTH} \{'\n  '}-H{' '}
          <S>{`'Idempotency-Key: ${BATCH_KEY}'`}</S> \{'\n  '}-H{' '}
          <S>&apos;Content-Type: application/json&apos;</S> \{'\n  '}-d{' '}
          <S>
            {`'{
    "channel": "api",
    "rows": [
      { "personnelFileNumber": "${urls.fileNumber}", "fullName": "Mary Wanjiku Kamau",
        "nationalId": "23456781", "designation": "Senior Human Resource Officer",
        "jobGroup": "M", "reportingEntity": "Ministry of Health",
        "appointmentDate": "2014-03-01", "email": "m.kamau@health.go.ke",
        "phone": "0712345678" }
    ]
  }'`}
          </S>
          {'\n\n'}
          <C># 202 Accepted</C>
          {
            '\n{ "id": "0192f1c4-7d2a-7b31-9e0f-5c6d7e8f9a01", "channel": "api", "state": "pending", … }'
          }
        </>
      ),
    },
    {
      id: 'report',
      title: m.docsReportTitle,
      text: m.docsReportText,
      code: (
        <>
          <Curl url={urls.importReport} /> -H {AUTH}
          {'\n'}
          <Curl url={urls.rejectedRows} /> -H {AUTH}
          {'\n\n'}
          <C># 200 OK</C>
          {
            '\n{ "id": "0192f1c4-…", "state": "completed", "totalRows": 1,\n  "counts": { "accepted": 1, "created": 1, "updated": 0, "unchanged": 0, "rejected": 0, … }, … }'
          }
        </>
      ),
    },
    {
      id: 'exit',
      title: m.docsExitTitle,
      text: m.docsExitText,
      code: (
        <>
          <Curl post url={urls.exit} /> \{'\n  '}-H {AUTH} \{'\n  '}-H{' '}
          <S>{`'Idempotency-Key: ${EXIT_KEY}'`}</S> \{'\n  '}-H{' '}
          <S>&apos;Content-Type: application/json&apos;</S> \{'\n  '}-d{' '}
          <S>&apos;{'{ "exitDate": "2026-09-30" }'}&apos;</S>
          {'\n\n'}
          <C># 200 OK</C>
          {`\n{ "personnelFileNumber": "${urls.fileNumber}", "state": "exited", "exitDate": "2026-09-30", … }`}
        </>
      ),
    },
    {
      id: 'errors',
      title: m.docsErrorsTitle,
      text: m.docsErrorsText,
      code: (
        <>
          <C># 400 Bad Request</C>
          {`
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    { "path": "rows.3.nationalId", "message": "Invalid input: expected string, received number", "rowIndex": 3 }
  ],
  "instance": "/v1/commissions/${slug}/roster/imports"
}`}
        </>
      ),
    },
    {
      id: 'limits',
      title: m.docsLimitsTitle,
      text: m.docsLimitsText,
      code: (
        <>
          <C># 429 Too Many Requests</C>
          {`
RateLimit-Limit: ${write}
RateLimit-Remaining: 0
RateLimit-Reset: 60
Retry-After: 1

{ "type": "rate-limit-exceeded", "title": "Too Many Requests", "status": 429,
  "detail": "Rate limit of ${write} requests per 60 seconds exceeded. Retry after 1 seconds." }`}
        </>
      ),
    },
  ];
}

const ERRORS: readonly (readonly [status: number, text: string])[] = [
  [400, m.docsError400(ROSTER_BATCH_MAX_ROWS)],
  [401, m.docsError401],
  [403, m.docsError403],
  [404, m.docsError404],
  [409, m.docsError409],
  [422, m.docsError422],
  [429, m.docsError429],
];

/** One label and value of the facts card (the prototype's `.kv`). */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
    </div>
  );
}

function ScopeCode() {
  return (
    <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[13.5px]">
      {ROSTER_WRITE_SCOPE}
    </code>
  );
}

/**
 * The roster API for a Commission's IT team (spec 02, #55): what to call and how, with examples
 * for the viewer's Commission against this deployment's endpoints.
 */
export function ApiDocs({ slug, endpoints }: { slug: string; endpoints: RosterApiEndpoints }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Card>
        <dl className="grid gap-x-6 gap-y-3.5 min-[600px]:grid-cols-3">
          <Fact term={m.docsBaseUrl}>
            <span className="font-mono font-normal">{endpoints.baseUrl}</span>
          </Fact>
          <Fact term={m.docsScope}>
            <ScopeCode />
          </Fact>
          <Fact term={m.docsBatchSize}>{m.docsBatchSizeValue(ROSTER_BATCH_MAX_ROWS)}</Fact>
          <Fact term={m.docsIdempotency}>{m.docsIdempotencyValue}</Fact>
          <Fact term={m.docsRateLimit}>
            {m.docsRateLimitValue(ROSTER_API_RATE_LIMITS.write, ROSTER_API_RATE_LIMITS.read)}
          </Fact>
          <Fact term={m.docsFormats}>{m.docsFormatsValue}</Fact>
        </dl>
      </Card>
      {sections(slug, endpoints).map((section) => (
        <Card
          key={section.id}
          id={`doc-${section.id}`}
          role="region"
          aria-labelledby={`doc-${section.id}-title`}
        >
          <h2
            id={`doc-${section.id}-title`}
            className="text-[17px] font-semibold tracking-[-0.01em]"
          >
            {section.title}
          </h2>
          <p className="mt-1.5 max-w-[760px] text-[14.5px] text-secondary-foreground">
            {section.text}
          </p>
          {section.id === 'errors' ? <ErrorList /> : null}
          <CodeBlock label={m.docsExample(section.title)} className="mt-3">
            {section.code}
          </CodeBlock>
        </Card>
      ))}
    </div>
  );
}

function ErrorList() {
  return (
    <dl className="mt-3 grid max-w-[860px] gap-2 text-[14.5px]">
      {ERRORS.map(([status, text]) => (
        <div key={status} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3">
          <dt>
            <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[13.5px]">
              {status}
            </code>
          </dt>
          <dd className="text-secondary-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
