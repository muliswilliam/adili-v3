import { VERIFICATION_ID_PATTERN } from '@adili/events/contracts';
import {
  CLR,
  DECLARATION_TYPES,
  declarationSchemes,
  InvalidReferenceError,
  parse,
} from '@adili/numbering/references';
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

/** One paragraph of an email, as plain text and as HTML. */
interface Paragraph {
  text: string;
  html: string;
}

/** A paragraph of plain words, escaped for the HTML body. */
const paragraph = (text: string): Paragraph => ({ text, html: escapeHtml(text) });

/** "Sign in to Adili Online at <portal> <rest>", the portal linked in the HTML body. */
const signInParagraph = (portalUrl: string, rest: string): Paragraph => ({
  text: `Sign in to Adili Online at ${portalUrl} ${rest}`,
  html: `Sign in to Adili Online at <a href="${escapeHtml(portalUrl)}">${escapeHtml(portalUrl)}</a> ${escapeHtml(rest)}`,
});

/** An email of `paragraphs`: blank-line separated in the text body, one `<p>` each in HTML. */
const email = (subject: string, paragraphs: readonly Paragraph[]): RenderedEmail => ({
  subject,
  text: paragraphs.map((p) => p.text).join('\n\n'),
  html: paragraphs.map((p) => `<p>${p.html}</p>`).join('\n'),
});

function otpEmail(
  subject: string,
  purpose: (params: OtpParams) => string,
): (params: OtpParams) => RenderedEmail {
  return (params) =>
    email(
      subject,
      [
        `Your Adili Online code is ${params.code}.`,
        `${purpose(params)} It expires in ${minutes(params.expiresInMinutes)}.`,
        'If you did not ask for this code, ignore this email. Nobody from Adili Online or your Commission will ever ask you for it.',
      ].map(paragraph),
    );
}

const forCommission = (params: OtpParams) =>
  params.commissionName ? ` with ${params.commissionName}` : '';

const reminderParams = z
  .strictObject({
    type: z.enum(DECLARATION_TYPES),
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

const statementDateParagraph = (statementDate: string) =>
  paragraph(
    `It declares your income, assets and liabilities as at the statement date, ${longDate(statementDate)}.`,
  );

const NEVER_ASKS = 'Adili Online will never ask you for your password or sign-in code.';

function reminderEmail(params: ReminderParams): RenderedEmail {
  const due = longDate(params.dueDate);
  const when = params.daysLeft === 0 ? 'today' : `in ${days(params.daysLeft)}`;
  return email(
    params.daysLeft === 0
      ? `Reminder: your ${params.type} declaration is due today`
      : `Reminder: your ${params.type} declaration is due on ${due}`,
    [
      paragraph(
        `Your ${params.type} declaration for ${params.commissionName} is due on ${due}, ${when}.`,
      ),
      statementDateParagraph(params.statementDate),
      signInParagraph(params.portalUrl, 'to see your declarations and their due dates.'),
      paragraph(
        `If you have already declared by other means, contact your Commission. ${NEVER_ASKS}`,
      ),
    ],
  );
}

/** Declaration reference schemes (ADR-011): `DCB-TSC-2027-0012345-K`. */
const DECLARATION_SCHEMES = Object.values(declarationSchemes);

/** A reference of one of `schemes` with a valid check character; `expected` names them. */
const referenceOf = (schemes: Parameters<typeof parse>[1], expected: string) =>
  z.string().superRefine((reference, ctx) => {
    try {
      parse(reference, schemes);
    } catch (error) {
      if (!(error instanceof InvalidReferenceError)) throw error;
      ctx.addIssue({
        code: 'custom',
        message:
          error.reason === 'bad-check-character'
            ? 'has a wrong check character'
            : `must be ${expected}`,
      });
    }
  });

const acknowledgementParams = z
  .strictObject({
    reference: referenceOf(DECLARATION_SCHEMES, 'a DCI, DCB or DCF declaration reference'),
    type: z.enum(DECLARATION_TYPES),
    /** The submitted version the slip is for; above 1 is an amendment, same reference. */
    version: z.number().int().min(1).max(99),
    commissionName: z.string().trim().min(1).max(120),
    /** Civil date `YYYY-MM-DD`, as the declarations service stores it. */
    statementDate: z.iso.date(),
    /** Printed under the QR on the slip (ADR-010), e.g. `ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K`. */
    verificationCode: z
      .string()
      .regex(
        VERIFICATION_ID_PATTERN,
        'must be a verification code in its printed form, such as ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
      ),
    /** Where the declarant signs in to download the slip; the email carries no attachment. */
    portalUrl: z.url({ protocol: /^https?$/ }).max(200),
  })
  .refine((params) => params.reference.startsWith(`${declarationSchemes[params.type].code}-`), {
    path: ['type'],
    message: 'is not the type the reference names',
    // Compare only a valid reference and type, so either one malformed reports one issue.
    when: (payload) =>
      payload.issues.every(
        (issue) => issue.path?.[0] !== 'reference' && issue.path?.[0] !== 'type',
      ),
  });
type AcknowledgementParams = z.infer<typeof acknowledgementParams>;

/** `DCB-PSC-2027-0000001-1`, or `DCB-PSC-2027-0000001-1 version 2` for an amendment. */
const referenceAndVersion = (params: AcknowledgementParams) =>
  params.version > 1 ? `${params.reference} version ${String(params.version)}` : params.reference;

function acknowledgementEmail(params: AcknowledgementParams): RenderedEmail {
  const amended = params.version > 1;
  return email(`Declaration ${referenceAndVersion(params)} received`, [
    paragraph(
      amended
        ? `Version ${String(params.version)} of your ${params.type} declaration for ${params.commissionName}, your amendment, has been received. Its reference number stays ${params.reference}.`
        : `Your ${params.type} declaration for ${params.commissionName} has been received. Its reference number is ${params.reference}.`,
    ),
    statementDateParagraph(params.statementDate),
    paragraph(
      `${amended ? `Your acknowledgement slip for version ${String(params.version)} is ready and replaces the slip for the previous version, which now shows as superseded.` : 'Your acknowledgement slip is ready.'} Its verification code is ${params.verificationCode}: anyone you show the slip to can use it, or the QR code on the slip, to check that it is genuine.`,
    ),
    // The slip names the declarant and the Commission, so it stays behind sign-in, never attached.
    signInParagraph(
      params.portalUrl,
      'to download the slip. It is not attached to this email, so that only you can open it.',
    ),
    paragraph(
      `If you did not submit this declaration, contact your Commission at once. ${NEVER_ASKS}`,
    ),
  ]);
}

const clarificationFields = {
  /** The clarification request's reference (ADR-011): `CLR-PSC-2028-0000451-1`. */
  reference: referenceOf([CLR], 'a CLR clarification reference'),
  commissionName: z.string().trim().min(1).max(120),
  /** Civil date `YYYY-MM-DD`: the last day to respond, in Nairobi time. */
  dueDate: z.iso.date(),
  /** The portal page where the declarant reads the letter and responds. */
  portalUrl: z.url({ protocol: /^https?$/ }).max(200),
};

const clarificationIssuedParams = z.strictObject(clarificationFields);
type ClarificationIssuedParams = z.infer<typeof clarificationIssuedParams>;

const clarificationReminderParams = z.strictObject({
  ...clarificationFields,
  /** Whole days from the send to the due date; the caller computes it in Nairobi time. */
  daysLeft: z.number().int().min(0).max(366),
});
type ClarificationReminderParams = z.infer<typeof clarificationReminderParams>;

const LATE_RESPONSE =
  'You can still respond after that date, but your response will be recorded as late.';

const CLARIFICATION_QUESTIONS = `If you have questions about this request, contact your Commission. ${NEVER_ASKS}`;

function clarificationIssuedEmail(params: ClarificationIssuedParams): RenderedEmail {
  return email(`Clarification request ${params.reference}`, [
    paragraph(
      `${params.commissionName} has sent you a clarification request about your declaration. Its reference number is ${params.reference}.`,
    ),
    paragraph(`Please respond by ${longDate(params.dueDate)}. ${LATE_RESPONSE}`),
    // The letter names the declarant and the items asked about, so it stays behind sign-in.
    signInParagraph(
      params.portalUrl,
      'to read the letter and respond. It is not attached to this email, so that only you can open it.',
    ),
    paragraph(CLARIFICATION_QUESTIONS),
  ]);
}

function clarificationReminderEmail(params: ClarificationReminderParams): RenderedEmail {
  const due = longDate(params.dueDate);
  const when = params.daysLeft === 0 ? `today, ${due}` : `on ${due}, in ${days(params.daysLeft)}`;
  return email(
    params.daysLeft === 0
      ? `Reminder: clarification request ${params.reference} is due today`
      : `Reminder: clarification request ${params.reference} is due on ${due}`,
    [
      paragraph(
        `You have not yet responded to clarification request ${params.reference} from ${params.commissionName}. Your response is due ${when}. ${LATE_RESPONSE}`,
      ),
      signInParagraph(params.portalUrl, 'to read the letter and respond.'),
      paragraph(CLARIFICATION_QUESTIONS),
    ],
  );
}

/**
 * Every message the service can send, by template id. Params are validated before rendering.
 *
 * Later specs add theirs here, which widens the contract's `TemplateId` enum: 08 decisions, notices, salary stopped and reinstated, 09 Form M (draft
 * ready, reminder, chase, receipt), access requests (acknowledged, notified, decisions to
 * applicant and declarant, package ready, officer reminder), law-enforcement access (grant
 * notice, decision) and certified copies (ready).
 */
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
        text: `Adili: declaration ${referenceAndVersion(params)} received. Verification code ${params.verificationCode}. Slip in Adili Online.`,
      }),
    },
  }),
  'clarification-issued-email': define({
    channel: 'email',
    params: clarificationIssuedParams,
    copy: { en: clarificationIssuedEmail },
  }),
  'clarification-issued-sms': define({
    channel: 'sms',
    params: clarificationIssuedParams,
    copy: {
      en: (params) => ({
        text: `Adili: ${params.commissionName} has sent you clarification request ${params.reference}. Respond by ${longDate(params.dueDate)} at ${params.portalUrl}`,
      }),
    },
  }),
  'clarification-reminder-email': define({
    channel: 'email',
    params: clarificationReminderParams,
    copy: { en: clarificationReminderEmail },
  }),
  'clarification-reminder-sms': define({
    channel: 'sms',
    params: clarificationReminderParams,
    copy: {
      en: (params) => ({
        text: `Adili: clarification request ${params.reference} is due on ${longDate(params.dueDate)} (${params.daysLeft === 0 ? 'today' : days(params.daysLeft)}). Respond at ${params.portalUrl}`,
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

export interface RenderOptions {
  /**
   * Refuse a `portalUrl` that is not https: a link a declarant follows to sign in must not go out
   * in the clear. On outside development and test (`NODE_ENV=production`), where the portal runs
   * on plain http locally.
   */
  httpsLinksOnly?: boolean;
}

/**
 * Validates `params` against the template's schema and renders it in `locale`, falling back
 * to English. Throws a `ZodError` whose paths start at `params`.
 */
export function renderTemplate(
  id: TemplateId,
  locale: Locale,
  params: unknown,
  { httpsLinksOnly = false }: RenderOptions = {},
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
  const portalUrl = (parsed.data as { portalUrl?: unknown }).portalUrl;
  if (httpsLinksOnly && typeof portalUrl === 'string' && !portalUrl.startsWith('https:')) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['params', 'portalUrl'],
        message: 'must be an https URL',
        input: portalUrl,
      },
    ]);
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
