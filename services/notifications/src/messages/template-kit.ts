import type { z } from 'zod';

/**
 * What every template is made of: the channels and locales, `define`, and the parts emails are
 * built from.
 */

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

export interface Template<TChannel extends Channel, TParams extends z.ZodType> {
  channel: TChannel;
  params: TParams;
  /** English is required; other locales fall back to it until translated. */
  copy: { en: (params: z.infer<TParams>) => Rendered<TChannel> } & Partial<
    Record<Exclude<Locale, 'en'>, (params: z.infer<TParams>) => Rendered<TChannel>>
  >;
}

export const define = <TChannel extends Channel, TParams extends z.ZodType>(
  template: Template<TChannel, TParams>,
) => template;

/** One paragraph of an email, as plain text and as HTML. */
export interface Paragraph {
  text: string;
  html: string;
}

/** A paragraph of plain words, escaped for the HTML body. */
export const paragraph = (text: string): Paragraph => ({ text, html: escapeHtml(text) });

/** "Sign in to Adili Online at <portal> <rest>", the portal linked in the HTML body. */
export const signInParagraph = (portalUrl: string, rest: string): Paragraph => ({
  text: `Sign in to Adili Online at ${portalUrl} ${rest}`,
  html: `Sign in to Adili Online at <a href="${escapeHtml(portalUrl)}">${escapeHtml(portalUrl)}</a> ${escapeHtml(rest)}`,
});

/** An email of `paragraphs`: blank-line separated in the text body, one `<p>` each in HTML. */
export const email = (subject: string, paragraphs: readonly Paragraph[]): RenderedEmail => ({
  subject,
  text: paragraphs.map((p) => p.text).join('\n\n'),
  html: paragraphs.map((p) => `<p>${p.html}</p>`).join('\n'),
});

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
export function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${String(day)} ${MONTHS[(month ?? 1) - 1] ?? ''} ${String(year)}`;
}

export const NEVER_ASKS = 'Adili Online will never ask you for your password or sign-in code.';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
