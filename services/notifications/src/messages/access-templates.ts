import { VERIFICATION_ID_PATTERN } from '@adili/events/contracts';
import {
  declarationSchemes,
  GRANT_REFERENCE_PATTERN,
  InvalidReferenceError,
  isGrantReference,
  parse,
} from '@adili/numbering/references';
import { z } from 'zod';

import { define, email, longDate, NEVER_ASKS, paragraph, signInParagraph } from './template-kit.js';

/**
 * Templates of access to declarations (spec 10): to the declarant (a request was made, what was
 * decided, a law-enforcement grant), to the applicant (the acknowledgement of their Form K) or
 * law-enforcement officer (the decision, the package), to the access officer (reminders, a
 * law-enforcement request withdrawn) and the declarant's certified copy. They name
 * the request and the Commission only: who asked, why, and what was disclosed stay behind
 * sign-in.
 */

/**
 * An access grant's reference (ADR-011) of the schemes given, its check character verified:
 * `ARQ` for a Form K request, `LEA` for a law-enforcement request.
 */
function grantReference(schemes: readonly ('ARQ' | 'LEA')[], expected: string) {
  return z.string().superRefine((reference, ctx) => {
    const ofScheme = schemes.some((scheme) => reference.startsWith(`${scheme}-`));
    if (ofScheme && isGrantReference(reference)) return;
    ctx.addIssue({
      code: 'custom',
      message:
        ofScheme && GRANT_REFERENCE_PATTERN.test(reference)
          ? 'has a wrong check character'
          : `must be ${expected}`,
    });
  });
}

const accessReference = grantReference(
  ['ARQ'],
  'an access request reference such as ARQ-PSC-2026-0000012-H',
);
const leaReference = grantReference(
  ['LEA'],
  'a law-enforcement request reference such as LEA-PSC-2026-0000004-3',
);
const requestReference = grantReference(
  ['ARQ', 'LEA'],
  'an ARQ or LEA request reference such as ARQ-PSC-2026-0000012-H',
);

const commissionName = z.string().trim().min(1).max(120);
/** Where the recipient signs in: the portal for applicants and declarants, the console for officers. */
const signInUrl = z.url({ protocol: /^https?$/ }).max(200);

const DECLARATION_SCHEMES = Object.values(declarationSchemes);
const declarationReference = z.string().superRefine((reference, ctx) => {
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
});

const UNDER_SECTION_36 = 'under section 36 of the Conflict of Interest Act';

// ---- To the applicant: Form K received (the acknowledgement, Regulation 22) ----

const APPLICANT_IDENTITY_STATUSES = ['verified', 'pending-verification'] as const;

const acknowledgementParams = z.strictObject({
  reference: accessReference,
  commissionName,
  /** Civil date `YYYY-MM-DD`: the decision deadline (receipt + 30 days). */
  decideBy: z.iso.date(),
  /**
   * `pending-verification` for a passport applicant whose particulars the access officer still
   * has to check: the request waits until then.
   */
  identityStatus: z.enum(APPLICANT_IDENTITY_STATUSES),
  signInUrl,
});
type AcknowledgementParams = z.infer<typeof acknowledgementParams>;

function acknowledgementEmail(params: AcknowledgementParams) {
  return email(`Request ${params.reference} received`, [
    paragraph(
      `${params.commissionName} has received your request ${params.reference} to see a declaration ${UNDER_SECTION_36}. Quote this reference whenever you contact the Commission about it.`,
    ),
    ...(params.identityStatus === 'pending-verification'
      ? [
          paragraph(
            'You registered with a passport, so the Commission will first check the particulars you entered. Your request goes ahead once it has.',
          ),
        ]
      : []),
    paragraph(
      `The Commission must decide by ${longDate(params.decideBy)}. We will tell you when it has.`,
    ),
    signInParagraph(
      params.signInUrl,
      'to follow your request, or to withdraw it before it is decided.',
    ),
    paragraph(NEVER_ASKS),
  ]);
}

// ---- To the declarant: a request was made (before any decision, Act s.36(3)) ----

const notifiedParams = z.strictObject({
  reference: accessReference,
  commissionName,
  /** Civil date `YYYY-MM-DD`: the last day of the window for representations. */
  respondBy: z.iso.date(),
  signInUrl,
});

// ---- Decisions ----

const APPLICANT_OUTCOMES = ['granted', 'partially-granted', 'denied', 'cannot-identify'] as const;
const DECLARANT_OUTCOMES = ['granted', 'partially-granted', 'denied'] as const;
const LEA_OUTCOMES = ['granted', 'denied'] as const;

const applicantDecisionParams = z.strictObject({
  reference: accessReference,
  commissionName,
  outcome: z.enum(APPLICANT_OUTCOMES),
  signInUrl,
});
type ApplicantDecisionParams = z.infer<typeof applicantDecisionParams>;

const declarantDecisionParams = z.strictObject({
  reference: accessReference,
  commissionName,
  outcome: z.enum(DECLARANT_OUTCOMES),
  signInUrl,
});
type DeclarantDecisionParams = z.infer<typeof declarantDecisionParams>;

const leaDecisionParams = z.strictObject({
  reference: leaReference,
  commissionName,
  outcome: z.enum(LEA_OUTCOMES),
  signInUrl,
});
type LeaDecisionParams = z.infer<typeof leaDecisionParams>;

const OUTCOME_WORDS: Record<(typeof APPLICANT_OUTCOMES)[number], string> = {
  granted: 'granted',
  'partially-granted': 'partly granted',
  denied: 'refused',
  'cannot-identify': 'closed',
};

function applicantDecisionEmail(params: ApplicantDecisionParams) {
  const request = `Your request ${params.reference} to ${params.commissionName} to see a declaration`;
  const body = {
    granted: [
      `${request} has been granted.`,
      'Your access package is being prepared. We will tell you when it is ready to download.',
    ],
    'partially-granted': [
      `${request} has been partly granted: the Commission granted access to less than you asked for.`,
      'Your access package is being prepared. We will tell you when it is ready to download.',
    ],
    denied: [`${request} has been refused.`, 'You may seek relief from the court.'],
    'cannot-identify': [
      `${request} has been closed: the Commission could not identify the officer you named.`,
      'You may make a new request with more details of the officer.',
    ],
  }[params.outcome];
  return email(`Request ${params.reference} ${OUTCOME_WORDS[params.outcome]}`, [
    ...body.map(paragraph),
    signInParagraph(params.signInUrl, 'to see the decision and its reasons.'),
    paragraph(NEVER_ASKS),
  ]);
}

function declarantDecisionEmail(params: DeclarantDecisionParams) {
  const decided = {
    granted: 'granted it',
    'partially-granted': 'granted part of it',
    denied: 'refused it',
  }[params.outcome];
  return email(`Decision on request ${params.reference} to see your declaration`, [
    paragraph(
      `${params.commissionName} has decided request ${params.reference} to see your declaration: it ${decided}.`,
    ),
    signInParagraph(
      params.signInUrl,
      params.outcome === 'denied'
        ? 'to see the decision and its reasons.'
        : 'to see what was disclosed, to whom, and why.',
    ),
    paragraph(NEVER_ASKS),
  ]);
}

function leaDecisionEmail(params: LeaDecisionParams) {
  const granted = params.outcome === 'granted';
  return email(`Request ${params.reference} ${granted ? 'granted' : 'refused'}`, [
    paragraph(
      granted
        ? `Your law-enforcement request ${params.reference} to ${params.commissionName} has been granted. Your access package is being prepared; we will tell you when it is ready to download.`
        : `Your law-enforcement request ${params.reference} to ${params.commissionName} has been refused.`,
    ),
    signInParagraph(params.signInUrl, 'to see the decision and its reasons.'),
  ]);
}

// ---- To the access officers: a law-enforcement request withdrawn before its decision ----

const leaWithdrawnParams = z.strictObject({
  reference: leaReference,
  commissionName,
  signInUrl,
});
type LeaWithdrawnParams = z.infer<typeof leaWithdrawnParams>;

function leaWithdrawnEmail(params: LeaWithdrawnParams) {
  return email(`Request ${params.reference} withdrawn`, [
    paragraph(
      `Law-enforcement request ${params.reference} to ${params.commissionName} was withdrawn by the officer who made it, before a decision. Nothing more is needed on it: it is closed, and the declarant is not told.`,
    ),
    signInParagraph(params.signInUrl, 'to see the request.'),
  ]);
}

// ---- The package ----

const packageReadyParams = z.strictObject({
  reference: requestReference,
  commissionName,
  /** Civil date `YYYY-MM-DD`: the last day the package can be downloaded. */
  downloadUntil: z.iso.date(),
  signInUrl,
});
type PackageReadyParams = z.infer<typeof packageReadyParams>;

function packageReadyEmail(params: PackageReadyParams) {
  return email(`Your access package for ${params.reference} is ready`, [
    paragraph(
      `The access package ${params.commissionName} granted on request ${params.reference} is ready. You can download it until ${longDate(params.downloadUntil)}; after that it can no longer be downloaded.`,
    ),
    paragraph(
      'Every page carries your name, the request reference and the date. Publishing or sharing what it discloses is an offence under section 36(4) of the Conflict of Interest Act.',
    ),
    signInParagraph(
      params.signInUrl,
      'to download it. It is not attached to this email, so that only you can open it.',
    ),
    paragraph(NEVER_ASKS),
  ]);
}

// ---- To the access officer ----

/**
 * What the access officer is reminded to do: verify a passport applicant (a request held until
 * they do), identify the officer a request names, or decide.
 */
const OFFICER_TASKS = ['verify-applicant', 'identify-officer', 'decide'] as const;

const officerReminderParams = z.strictObject({
  reference: requestReference,
  commissionName,
  task: z.enum(OFFICER_TASKS),
  /** Civil date `YYYY-MM-DD`: the decision deadline. */
  dueDate: z.iso.date(),
  /** Whole days from the send to the deadline; the caller computes it in Nairobi time. */
  daysLeft: z.number().int().min(0).max(366),
  signInUrl,
});
type OfficerReminderParams = z.infer<typeof officerReminderParams>;

const daysLeft = (n: number) => (n === 0 ? 'today' : n === 1 ? 'in 1 day' : `in ${String(n)} days`);

function officerReminderEmail(params: OfficerReminderParams) {
  const due = `${longDate(params.dueDate)}, ${daysLeft(params.daysLeft)}`;
  const task = {
    'verify-applicant': `Request ${params.reference} to ${params.commissionName} is waiting for you to verify the applicant's identity. The officer it names cannot be identified, nor the request decided, until you do.`,
    'identify-officer': `Request ${params.reference} to ${params.commissionName} is waiting for you to identify the officer it names. The declarant cannot be notified, nor the request decided, until you do.`,
    decide: `Request ${params.reference} to ${params.commissionName} is waiting for your decision.`,
  }[params.task];
  return email(
    {
      'verify-applicant': `Reminder: verify the applicant for ${params.reference}`,
      'identify-officer': `Reminder: identify the officer for ${params.reference}`,
      decide: `Reminder: decide ${params.reference} by ${longDate(params.dueDate)}`,
    }[params.task],
    [
      paragraph(task),
      paragraph(`The decision is due on ${due}.`),
      signInParagraph(params.signInUrl, 'to open the request.'),
    ],
  );
}

// ---- To the declarant after a law-enforcement grant (Regulation 23(2)) ----

const leaGrantNoticeParams = z.strictObject({
  reference: leaReference,
  commissionName,
  agencyName: z.string().trim().min(1).max(120),
  /** Civil date `YYYY-MM-DD` of the grant. */
  grantedOn: z.iso.date(),
  signInUrl,
});
type LeaGrantNoticeParams = z.infer<typeof leaGrantNoticeParams>;

function leaGrantNoticeEmail(params: LeaGrantNoticeParams) {
  return email('A law-enforcement agency was granted access to your declaration', [
    paragraph(
      `On ${longDate(params.grantedOn)} ${params.commissionName} granted ${params.agencyName} access to your declaration, on law-enforcement request ${params.reference} ${UNDER_SECTION_36}.`,
    ),
    paragraph(
      'The law tells you of a law-enforcement request after access is granted, not before (Regulation 23(2)).',
    ),
    signInParagraph(params.signInUrl, 'to see what was disclosed.'),
    paragraph(NEVER_ASKS),
  ]);
}

function notifiedEmail(params: z.infer<typeof notifiedParams>) {
  return email('Someone has asked to see your declaration', [
    paragraph(
      `A request (${params.reference}) has been made to ${params.commissionName} to see your declaration ${UNDER_SECTION_36}.`,
    ),
    paragraph(
      `The Commission must hear you before it decides. You may object, consent or add context until ${longDate(params.respondBy)}.`,
    ),
    signInParagraph(
      params.signInUrl,
      'to see who asked, why and what they asked to see, and to respond.',
    ),
    paragraph(NEVER_ASKS),
  ]);
}

// ---- The declarant's certified copy ----

const certifiedCopyParams = z.strictObject({
  reference: declarationReference,
  version: z.number().int().min(1).max(99),
  commissionName,
  verificationCode: z
    .string()
    .regex(
      VERIFICATION_ID_PATTERN,
      'must be a verification code in its printed form, such as ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
    ),
  signInUrl,
});
type CertifiedCopyParams = z.infer<typeof certifiedCopyParams>;

function certifiedCopyEmail(params: CertifiedCopyParams) {
  return email(`Your certified copy of ${params.reference} is ready`, [
    paragraph(
      `Your certified copy of version ${String(params.version)} of declaration ${params.reference}, issued by ${params.commissionName}, is ready. Its verification code is ${params.verificationCode}: anyone you show it to can use it, or the QR code on the copy, to check that it is genuine.`,
    ),
    signInParagraph(
      params.signInUrl,
      'to download it. It is not attached to this email, so that only you can open it.',
    ),
    paragraph(NEVER_ASKS),
  ]);
}

/** The access templates, registered with the others in `templates`. */
export const accessTemplates = {
  'access-acknowledgement-email': define({
    channel: 'email',
    params: acknowledgementParams,
    copy: { en: acknowledgementEmail },
  }),
  'access-acknowledgement-sms': define({
    channel: 'sms',
    params: acknowledgementParams,
    copy: {
      en: (params) => ({
        text: `Adili: your request ${params.reference} was received. Decision due by ${longDate(params.decideBy)}. Follow it at ${params.signInUrl}`,
      }),
    },
  }),
  'access-request-notified-email': define({
    channel: 'email',
    params: notifiedParams,
    copy: { en: notifiedEmail },
  }),
  'access-request-notified-sms': define({
    channel: 'sms',
    params: notifiedParams,
    copy: {
      en: (params) => ({
        text: `Adili: request ${params.reference} asks to see your declaration. Respond by ${longDate(params.respondBy)} at ${params.signInUrl}`,
      }),
    },
  }),
  'access-decision-applicant-email': define({
    channel: 'email',
    params: applicantDecisionParams,
    copy: { en: applicantDecisionEmail },
  }),
  'access-decision-applicant-sms': define({
    channel: 'sms',
    params: applicantDecisionParams,
    copy: {
      en: (params) => ({
        text: `Adili: your request ${params.reference} was ${OUTCOME_WORDS[params.outcome]}. Details at ${params.signInUrl}`,
      }),
    },
  }),
  'access-decision-declarant-email': define({
    channel: 'email',
    params: declarantDecisionParams,
    copy: { en: declarantDecisionEmail },
  }),
  'access-decision-declarant-sms': define({
    channel: 'sms',
    params: declarantDecisionParams,
    copy: {
      en: (params) => ({
        text: `Adili: request ${params.reference} to see your declaration was ${OUTCOME_WORDS[params.outcome]}. Details at ${params.signInUrl}`,
      }),
    },
  }),
  'access-package-ready-email': define({
    channel: 'email',
    params: packageReadyParams,
    copy: { en: packageReadyEmail },
  }),
  'access-package-ready-sms': define({
    channel: 'sms',
    params: packageReadyParams,
    copy: {
      en: (params) => ({
        text: `Adili: your access package for ${params.reference} is ready. Download it by ${longDate(params.downloadUntil)} at ${params.signInUrl}`,
      }),
    },
  }),
  'access-officer-reminder-email': define({
    channel: 'email',
    params: officerReminderParams,
    copy: { en: officerReminderEmail },
  }),
  'access-officer-reminder-sms': define({
    channel: 'sms',
    params: officerReminderParams,
    copy: {
      en: (params) => ({
        text: {
          'verify-applicant': `Adili: verify the applicant for request ${params.reference}. Decision due ${longDate(params.dueDate)}.`,
          'identify-officer': `Adili: identify the officer for request ${params.reference}. Decision due ${longDate(params.dueDate)}.`,
          decide: `Adili: decide request ${params.reference} by ${longDate(params.dueDate)} (${daysLeft(params.daysLeft)}).`,
        }[params.task],
      }),
    },
  }),
  'lea-grant-notice-email': define({
    channel: 'email',
    params: leaGrantNoticeParams,
    copy: { en: leaGrantNoticeEmail },
  }),
  'lea-grant-notice-sms': define({
    channel: 'sms',
    params: leaGrantNoticeParams,
    copy: {
      en: (params) => ({
        text: `Adili: a law-enforcement agency was granted access to your declaration on ${longDate(params.grantedOn)} (${params.reference}). Details at ${params.signInUrl}`,
      }),
    },
  }),
  'lea-decision-email': define({
    channel: 'email',
    params: leaDecisionParams,
    copy: { en: leaDecisionEmail },
  }),
  'lea-decision-sms': define({
    channel: 'sms',
    params: leaDecisionParams,
    copy: {
      en: (params) => ({
        text: `Adili: law-enforcement request ${params.reference} was ${OUTCOME_WORDS[params.outcome]}. Details at ${params.signInUrl}`,
      }),
    },
  }),
  'lea-withdrawn-email': define({
    channel: 'email',
    params: leaWithdrawnParams,
    copy: { en: leaWithdrawnEmail },
  }),
  'lea-withdrawn-sms': define({
    channel: 'sms',
    params: leaWithdrawnParams,
    copy: {
      en: (params) => ({
        text: `Adili: law-enforcement request ${params.reference} was withdrawn before a decision. Nothing more is needed.`,
      }),
    },
  }),
  'certified-copy-ready-email': define({
    channel: 'email',
    params: certifiedCopyParams,
    copy: { en: certifiedCopyEmail },
  }),
  'certified-copy-ready-sms': define({
    channel: 'sms',
    params: certifiedCopyParams,
    copy: {
      en: (params) => ({
        text: `Adili: your certified copy of ${params.reference} version ${String(params.version)} is ready. Code ${params.verificationCode}.`,
      }),
    },
  }),
} as const;
