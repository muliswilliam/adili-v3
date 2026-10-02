import { PLATFORM_TENANT, TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import {
  CHANNELS,
  isTemplateId,
  LOCALES,
  TEMPLATE_IDS,
  templateChannel,
  templateParams,
} from './templates.js';

/**
 * Request bodies of the messages API (responses are in representation.ts). They are the contract:
 * the OpenAPI document, packages/schemas/internal/notifications.yaml, is generated from them
 * (`pnpm contracts`).
 */

// ITU-T E.164: a plus, a country code that never starts with 0, at most 15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;
const email = z.email();

export const channelSchema = z.enum(CHANNELS);

export const templateIdSchema = z
  .enum(TEMPLATE_IDS)
  .meta({ description: 'Registered templates; each declares its channel and params' });

export const recipientSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('address'),
    to: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .meta({ description: 'Email address or E.164 phone number, matching the channel' }),
  }),
  z.object({
    kind: z.literal('person'),
    personId: z.uuid().meta({
      description:
        "The person's verified contacts are resolved through the directory at the message's `tenant` (required for a person; cached for 10 minutes) and the one for the channel is used. None for the channel, or a person not onboarded at that tenant, is status failed with error no-contact; a directory that cannot answer is failed with error contact-lookup-failed (worth retrying).",
    }),
  }),
]);

/** `SendMessage`: body of `POST /internal/v1/messages` as the contract states it. */
export const sendMessageBody = z.object({
  channel: channelSchema,
  recipient: recipientSchema,
  template: templateIdSchema,
  params: z.record(z.string(), z.unknown()).meta({
    description:
      "Validated against the template's parameter schema. `obligation-reminder-sms` and `obligation-reminder-email` take exactly `type` (initial, biennial, final), `commissionName` (1 to 120 characters), `statementDate` and `dueDate` (`YYYY-MM-DD`, due on or after statement), `daysLeft` (integer 0 to 366) and `portalUrl` (http or https URL). `acknowledgement-email` and `acknowledgement-sms` take exactly `reference` (a DCI, DCB or DCF declaration reference with a valid check character), `type` (the one the reference names), `version` (integer 1 to 99; above 1 the copy names the version, an amendment), `commissionName`, `statementDate`, `verificationCode` (`ADL-` and hyphenated groups of 0-9 and A-Z, at most 40 characters) and `portalUrl`; the email links to the portal and attaches nothing, the SMS carries only the reference and verification code. The access templates (spec 10), each an `-email` and an `-sms`, take a `signInUrl` (http or https URL: the portal, or the console for officers) and a `commissionName`, and name the request only: `access-acknowledgement` (to the applicant, Form K received) `reference` (ARQ), `decideBy` (`YYYY-MM-DD`) and `identityStatus` (verified, pending-verification: a passport applicant's particulars are still to be checked); `access-request-notified` (to the declarant) `reference` (ARQ) and `respondBy` (`YYYY-MM-DD`); `access-decision-applicant` `reference` (ARQ) and `outcome` (granted, partially-granted, denied, cannot-identify); `access-decision-declarant` `reference` (ARQ) and `outcome` (granted, partially-granted, denied); `access-package-ready` `reference` (ARQ or LEA) and `downloadUntil` (`YYYY-MM-DD`); `access-officer-reminder` `reference` (ARQ or LEA), `task` (verify-applicant, identify-officer, decide), `dueDate` (`YYYY-MM-DD`) and `daysLeft` (0 to 366); `lea-grant-notice` (to the declarant) `reference` (LEA), `agencyName` and `grantedOn` (`YYYY-MM-DD`); `lea-decision` `reference` (LEA) and `outcome` (granted, denied); `certified-copy-ready` `reference` (a declaration reference), `version` (1 to 99) and `verificationCode`.",
  }),
  locale: z.enum(LOCALES).default('en'),
  tenant: z.string().regex(TENANT_KEY).optional().meta({
    description:
      'Tenant key for audit and per-tenant branding. Required for a person recipient (whose contacts are read at that tenant); optional for platform messages to an address',
  }),
});

/**
 * Validates `POST /internal/v1/messages`. The template is first taken as any string so that an
 * unknown one is reported together with the recipient and params errors.
 */
export const sendMessageSchema = sendMessageBody
  .extend({ template: z.string().min(1) })
  // One pass, so a caller sees every recipient, template and params error in one response.
  .superRefine((body, ctx) => {
    const { channel, recipient, template, params } = body;
    // A person's contacts come from the directory at send time, read at the message's tenant.
    if (recipient.kind === 'person' && body.tenant === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenant'],
        message: 'is required for a person recipient',
      });
    } else if (recipient.kind === 'person' && body.tenant === PLATFORM_TENANT) {
      // The directory would refuse the lookup, and the retries would never end.
      ctx.addIssue({
        code: 'custom',
        path: ['tenant'],
        message: 'must name the Commission the person is onboarded at, not platform',
      });
    }
    // Only an address is checked here.
    if (recipient.kind === 'address') {
      if (channel === 'email' && !email.safeParse(recipient.to).success) {
        ctx.addIssue({
          code: 'custom',
          path: ['recipient', 'to'],
          message: 'must be an email address on the email channel',
        });
      } else if (channel === 'sms' && !E164.test(recipient.to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['recipient', 'to'],
          message: 'must be an E.164 phone number such as +254712345678 on the sms channel',
        });
      }
    }
    if (!isTemplateId(template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'unknown template' });
    } else {
      if (templateChannel(template) !== channel) {
        ctx.addIssue({
          code: 'custom',
          path: ['template'],
          message: `is a ${templateChannel(template)} template, not ${channel}`,
        });
      }
      for (const issue of templateParams(template).safeParse(params).error?.issues ?? []) {
        ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
      }
    }
  })
  .transform(({ template, ...body }, ctx) => {
    // Narrows the type; the refinement above has already rejected unknown templates.
    if (!isTemplateId(template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'unknown template' });
      return z.NEVER;
    }
    return { ...body, template };
  });

export type SendMessage = z.infer<typeof sendMessageSchema>;
