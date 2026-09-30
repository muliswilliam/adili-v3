import { hasValidCheckCharacter } from '@adili/numbering';
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

/** Declaration reference prefix by type (ADR-011): `DCB-TSC-2027-0012345-K`. */
const REFERENCE_SCHEMES = { initial: 'DCI', biennial: 'DCB', final: 'DCF' } as const;

const acknowledgementParams = z
  .strictObject({
    reference: z
      .string()
      // Aborts, so a malformed reference is not also reported for its check character.
      .regex(/^DC[IBF]-[A-Z0-9]{2,8}-\d{4}-\d{7}-[0-9A-Z]$/, {
        message: 'must be a declaration reference',
        abort: true,
      })
      .refine(hasValidCheckCharacter, 'has a wrong check character'),
    type: z.enum(OBLIGATION_TYPES),
    commissionName: z.string().trim().min(1).max(120),
    /** Civil date `YYYY-MM-DD`, as the declarations service stores it. */
    statementDate: z.iso.date(),
    /** Printed under the QR on the slip (ADR-010), e.g. `ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9K`. */
    verificationCode: z
      .string()
      .max(40)
      .regex(/^ADL(-[0-9A-Z]{1,8})+$/, 'must be a verification code such as ADL-7Q4K-M2XR'),
    /** Where the declarant signs in to download the slip; the email carries no attachment. */
    portalUrl: z.url({ protocol: /^https?$/ }).max(200),
  })
  .refine((params) => params.reference.startsWith(REFERENCE_SCHEMES[params.type]), {
    path: ['type'],
    message: 'is not the type the reference names',
    // Compare only a valid reference and type, so either one malformed reports one issue.
    when: (payload) =>
      payload.issues.every(
        (issue) => issue.path?.[0] !== 'reference' && issue.path?.[0] !== 'type',
      ),
  });
type AcknowledgementParams = z.infer<typeof acknowledgementParams>;

function acknowledgementEmail(params: AcknowledgementParams): RenderedEmail {
  const paragraphs: { text: string; html: string }[] = [
    `Your ${params.type} declaration for ${params.commissionName} has been received. Its reference number is ${params.reference}.`,
    `It declares your income, assets and liabilities as at the statement date, ${longDate(params.statementDate)}.`,
    `Your acknowledgement slip is ready. Its verification code is ${params.verificationCode}: anyone you show the slip to can use it, or the QR code on the slip, to check that it is genuine.`,
  ].map((text) => ({ text, html: escapeHtml(text) }));
  // The slip names the declarant and the Commission, so it stays behind sign-in, never attached.
  const download =
    'to download the slip. It is not attached to this email, so that only you can open it.';
  paragraphs.push({
    text: `Sign in to Adili Online at ${params.portalUrl} ${download}`,
    html: `Sign in to Adili Online at <a href="${escapeHtml(params.portalUrl)}">${escapeHtml(params.portalUrl)}</a> ${escapeHtml(download)}`,
  });
  const closing =
    'If you did not submit this declaration, contact your Commission at once. Adili Online will never ask you for your password or sign-in code.';
  paragraphs.push({ text: closing, html: escapeHtml(closing) });
  return {
    subject: `Declaration ${params.reference} received`,
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
  'acknowledgement-email': define({
    channel: 'email',
    params: acknowledgementParams,
    copy: { en: acknowledgementEmail },
  }),
  'acknowledgement-sms': define({
    channel: 'sms',
    params: acknowledgementParams,
    // The reference and code reveal nothing on their own; the SMS names no Commission or link.
    copy: {
      en: (params) => ({
        text: `Adili: declaration ${params.reference} received. Verification code ${params.verificationCode}. Your slip is in Adili Online.`,
      }),
    },
  }),
} as const;

export type TemplateId = keyof typeof templates;

/** Every template id, in registration order (the contract's `TemplateId` enum). */
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
