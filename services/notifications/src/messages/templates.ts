import { VERIFICATION_ID_PATTERN } from '@adili/events/contracts';
import {
  DECLARATION_TYPES,
  declarationSchemes,
  InvalidReferenceError,
  parse,
} from '@adili/numbering/references';
import { z } from 'zod';

import { accessTemplates } from './access-templates.js';
import {
  CHANNELS,
  type Channel,
  define,
  email,
  LOCALES,
  type Locale,
  longDate,
  NEVER_ASKS,
  paragraph,
  type RenderedEmail,
  type RenderedSms,
  signInParagraph,
} from './template-kit.js';

export { CHANNELS, type Channel, LOCALES, type Locale, type RenderedEmail, type RenderedSms };

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

const days = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);

const statementDateParagraph = (statementDate: string) =>
  paragraph(
    `It declares your income, assets and liabilities as at the statement date, ${longDate(statementDate)}.`,
  );

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

const acknowledgementParams = z
  .strictObject({
    reference: z.string().superRefine((reference, ctx) => {
      try {
        parse(reference, DECLARATION_SCHEMES);
      } catch (error) {
        if (!(error instanceof InvalidReferenceError)) throw error;
        ctx.addIssue({
          code: 'custom',
          message:
            error.reason === 'bad-check-character'
              ? 'has a wrong check character'
              : 'must be a DCI, DCB or DCF declaration reference',
        });
      }
    }),
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

/**
 * Every message the service can send, by template id. Params are validated before rendering.
 *
 * Later specs add theirs here, which widens the contract's `TemplateId` enum: 07a clarifications
 * (issued, reminder), 08 decisions, notices, salary stopped and reinstated, 09 Form M (draft
 * ready, reminder, chase, receipt) and the access request acknowledgement. Spec 10's access
 * templates are in access-templates.ts.
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
  ...accessTemplates,
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
