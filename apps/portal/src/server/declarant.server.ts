import { maskEmail, maskPhone } from '@adili/ui';

import type { Language } from '../language';
import type { DirectoryClient } from './directory/client.server';

/** A Commission the declarant is onboarded at. */
export interface DeclarantCommission {
  slug: string;
  name: string;
  /** ISO date-time. */
  onboardedAt: string;
}

/**
 * What the dashboard shows about an onboarded declarant. Contacts are masked here, on the
 * server, so the full email and phone never reach the browser.
 */
export interface DeclarantAccount {
  fullName: string;
  ofr: string;
  commissions: DeclarantCommission[];
  maskedEmail: string | null;
  maskedPhone: string | null;
  /**
   * The language a clarification letter to them starts in (spec 07c FE-3); null until they
   * choose one, when letters start in English.
   */
  preferredLanguage: Language | null;
}

export type DeclarantAccountResult =
  | { status: 'onboarded'; account: DeclarantAccount }
  /**
   * `GET /v1/me/declarant` answered 403 (the account has no declarant role) or 404 (it has, but
   * no onboarded roster record): the signed-in person is not a declarant.
   */
  | { status: 'not-declarant' }
  | { status: 'unavailable' };

/** `GET /v1/me/declarant`, reduced to what the dashboard's account card needs. */
export async function loadDeclarantAccount(
  client: DirectoryClient,
): Promise<DeclarantAccountResult> {
  try {
    const { data, response } = await client.GET('/v1/me/declarant');
    if (data) {
      return {
        status: 'onboarded',
        account: {
          fullName: data.fullName,
          ofr: data.ofr,
          commissions: data.commissions.flatMap((commission) =>
            commission.state === 'onboarded' && commission.onboardedAt
              ? [
                  {
                    slug: commission.slug,
                    name: commission.name,
                    onboardedAt: commission.onboardedAt,
                  },
                ]
              : [],
          ),
          maskedEmail: data.contacts.email === null ? null : maskEmail(data.contacts.email),
          maskedPhone: data.contacts.phone === null ? null : maskPhone(data.contacts.phone),
          preferredLanguage: data.preferredLanguage,
        },
      };
    }
    return response.status === 403 || response.status === 404
      ? { status: 'not-declarant' }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

export type SavePreferredLanguageResult =
  { status: 'saved'; preferredLanguage: Language } | { status: 'unavailable' };

/** `PUT /v1/me/declarant/preferred-language`: stores the language the declarant prefers. */
export async function savePreferredLanguage(
  client: DirectoryClient,
  language: Language,
): Promise<SavePreferredLanguageResult> {
  try {
    const { data } = await client.PUT('/v1/me/declarant/preferred-language', {
      body: { preferredLanguage: language },
    });
    return data?.preferredLanguage
      ? { status: 'saved', preferredLanguage: data.preferredLanguage }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
