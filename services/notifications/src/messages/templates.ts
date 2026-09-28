import { z } from 'zod';

export const CHANNELS = ['email', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];

/** English now; Swahili renders English until its copy is written. */
export const LOCALES = ['en', 'sw'] as const;
export type Locale = (typeof LOCALES)[number];

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface RenderedSms {
  text: string;
}

type Rendered<TChannel extends Channel> = TChannel extends 'email' ? RenderedEmail : RenderedSms;

interface Template<TChannel extends Channel, TParams extends z.ZodType> {
  channel: TChannel;
  params: TParams;
  /** English is required; other locales fall back to it until translated. */
  copy: { en: (params: z.infer<TParams>) => Rendered<TChannel> } & Partial<
    Record<Exclude<Locale, 'en'>, (params: z.infer<TParams>) => Rendered<TChannel>>
  >;
}

const define = <TChannel extends Channel, TParams extends z.ZodType>(
  template: Template<TChannel, TParams>,
) => template;

const otpParams = z.strictObject({
  code: z.string().regex(/^\d{4,8}$/, 'must be 4 to 8 digits'),
  commissionName: z.string().min(1).max(120).optional(),
  expiresInMinutes: z.number().int().min(1).max(60),
});
type OtpParams = z.infer<typeof otpParams>;

const minutes = (n: number) => (n === 1 ? '1 minute' : `${n} minutes`);

function otpEmail(
  subject: string,
  purpose: (params: OtpParams) => string,
): (params: OtpParams) => RenderedEmail {
  return (params) => {
    const lines = [
      `Your Adili Online code is ${params.code}.`,
      `${purpose(params)} It expires in ${minutes(params.expiresInMinutes)}.`,
      'If you did not ask for this code, ignore this email. Nobody from Adili Online or your Commission will ever ask you for it.',
    ];
    return {
      subject,
      text: lines.join('\n\n'),
      html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
    };
  };
}

const forCommission = (params: OtpParams) =>
  params.commissionName ? ` with ${params.commissionName}` : '';

/** Filing obligation types (declarations.yaml `ObligationType`), as written in a sentence. */
const OBLIGATION_TYPES = ['initial', 'biennial', 'final'] as const;

const reminderParams = z
  .strictObject({
    type: z.enum(OBLIGATION_TYPES),
    commissionName: z.string().trim().min(1).max(120),
    /** Civil dates `YYYY-MM-DD`, as the declarations service stores them. */
    statementDate: z.iso.date(),
    dueDate: z.iso.date(),
    /** Whole days from the send to the due date; the caller computes it in Nairobi time. */
    daysLeft: z.number().int().min(0).max(366),
    portalUrl: z.url({ protocol: /^https?$/ }).max(200),
  })
  .refine((params) => params.dueDate >= params.statementDate, {
    path: ['dueDate'],
    message: 'must be on or after the statement date',
    // Compare only two valid dates, so a malformed date reports one issue, not two.
    when: (payload) =>
      payload.issues.every(
        (issue) => issue.path?.[0] !== 'statementDate' && issue.path?.[0] !== 'dueDate',
      ),
  });
type ReminderParams = z.infer<typeof reminderParams>;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2027-12-31` as `31 December 2027`, without a time zone: the date is already civil. */
function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${String(day)} ${MONTHS[(month ?? 1) - 1] ?? ''} ${String(year)}`;
}

const days = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);

function reminderEmail(params: ReminderParams): RenderedEmail {
  const due = longDate(params.dueDate);
  const when = params.daysLeft === 0 ? 'today' : `in ${days(params.daysLeft)}`;
  const paragraphs: { text: string; html: string }[] = [
    `Your ${params.type} declaration for ${params.commissionName} is due on ${due}, ${when}.`,
    `It declares your income, assets and liabilities as at the statement date, ${longDate(params.statementDate)}.`,
  ].map((text) => ({ text, html: escapeHtml(text) }));
  paragraphs.push({
    text: `Sign in to Adili Online at ${params.portalUrl} to see your declarations and their due dates.`,
    html: `Sign in to Adili Online at <a href="${escapeHtml(params.portalUrl)}">${escapeHtml(params.portalUrl)}</a> to see your declarations and their due dates.`,
  });
  const closing =
    'If you have already declared by other means, contact your Commission. Adili Online will never ask you for your password or sign-in code.';
  paragraphs.push({ text: closing, html: escapeHtml(closing) });
  return {
    subject:
      params.daysLeft === 0
        ? `Reminder: your ${params.type} declaration is due today`
        : `Reminder: your ${params.type} declaration is due on ${due}`,
    text: paragraphs.map((p) => p.text).join('\n\n'),
    html: paragraphs.map((p) => `<p>${p.html}</p>`).join('\n'),
  };
}

/** Every message the service can send, by template id. Params are validated before rendering. */
export const templates = {
  'onboarding-otp-email': define({
    channel: 'email',
    params: otpParams,
    copy: {
      en: (params) =>
        otpEmail(
          `Your Adili code: ${params.code}`,
          (p) => `Enter it to continue setting up your declarant account${forCommission(p)}.`,
        )(params),
    },
  }),
  'onboarding-otp-sms': define({
    channel: 'sms',
    params: otpParams,
    copy: {
      en: (params) => ({
        text: `Adili: your code to set up your account${forCommission(params)} is ${params.code}. It expires in ${minutes(params.expiresInMinutes)}. Did not ask for it? Ignore this SMS. Do not share it.`,
      }),
    },
  }),
  'login-otp-sms': define({
    channel: 'sms',
    params: otpParams,
    copy: {
      en: (params) => ({
        text: `Adili: your sign-in code is ${params.code}. It expires in ${minutes(params.expiresInMinutes)}. Do not share it.`,
      }),
    },
  }),
  'login-otp-email': define({
    channel: 'email',
    params: otpParams,
    copy: {
      en: (params) =>
        otpEmail(
          `Your Adili sign-in code: ${params.code}`,
          () => 'Enter it to finish signing in to Adili Online.',
        )(params),
    },
  }),
  'obligation-reminder-sms': define({
    channel: 'sms',
    params: reminderParams,
    copy: {
      en: (params) => ({
        text: `Adili: your ${params.type} declaration for ${params.commissionName} is due on ${longDate(params.dueDate)} (${params.daysLeft === 0 ? 'today' : days(params.daysLeft)}). Sign in at ${params.portalUrl}`,
      }),
    },
  }),
  'obligation-reminder-email': define({
    channel: 'email',
    params: reminderParams,
    copy: { en: reminderEmail },
  }),
} as const;

export type TemplateId = keyof typeof templates;

/** Every template id, in registration order. */
export const TEMPLATE_IDS = Object.keys(templates) as [TemplateId, ...TemplateId[]];

export function isTemplateId(id: string): id is TemplateId {
  return Object.hasOwn(templates, id);
}

export function templateChannel(id: TemplateId): Channel {
  return templates[id].channel;
}

/** Schema the template's params must satisfy. */
export function templateParams(id: TemplateId): z.ZodType {
  return templates[id].params;
}

type RenderFn = (params: unknown) => RenderedEmail | RenderedSms;

/**
 * Validates `params` against the template's schema and renders it in `locale`, falling back
 * to English. Throws a `ZodError` whose paths start at `params`.
 */
export function renderTemplate(
  id: TemplateId,
  locale: Locale,
  params: unknown,
): Partial<RenderedEmail> & { text: string } {
  const template = templates[id] as unknown as {
    params: z.ZodType;
    copy: { en: RenderFn } & Partial<Record<Locale, RenderFn>>;
  };
  const parsed = template.params.safeParse(params);
  if (!parsed.success) {
    throw new z.ZodError(
      parsed.error.issues.map((issue) => ({ ...issue, path: ['params', ...issue.path] })),
    );
  }
  return (template.copy[locale] ?? template.copy.en)(parsed.data);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
