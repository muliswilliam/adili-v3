/**
 * The contract between the `adili-otp` authenticator (Keycloak extension, #79) and the theme's
 * custom page `login-adili-otp.ftl`. The authenticator sets the page attributes below with
 * `form.setAttribute(name, value)` and reads the posted form fields in `action()`. Change a name
 * here only together with the Java side.
 */

export const ADILI_OTP_PAGE_ID = 'login-adili-otp.ftl';

export type OtpChannel = 'sms' | 'email';

/** Attributes the authenticator puts on the page (KcContextExtensionPerPage). */
// A type alias, not an interface: Keycloakify needs it assignable to Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type AdiliOtpAttributes = {
  /** Where the current code went. */
  channel: OtpChannel;
  /** The destination of the current code, already masked, e.g. `07** *** 123` or `j***@gmail.com`. */
  maskedDestination: string;
  /**
   * The other channel's destination, masked. Absent when the user has no contact on it, which
   * hides "Send it by email instead" (or by SMS).
   */
  alternativeDestination?: string;
  /** Wrong codes left before the sign-in stops (5 to start). */
  attemptsLeft: number;
  /** ISO-8601 instant from which "Resend code" works (last send + 60 s). Absent: now. */
  resendAvailableAt?: string;
  /** New codes left (3 to start). At 0, a resend ends the sign-in. */
  resendsLeft: number;
  /**
   * The last send failed: `sms` or `email` for that channel only (the page offers the other),
   * `both` when neither worked. Absent when the code went out.
   */
  sendFailed?: OtpChannel | 'both';
  /** Set for the step-up check before submitting a declaration (#133); no password was asked. */
  isStepUp?: boolean;
  /** Why the last posted code was refused. Absent on first render and after a resend. */
  otpError?: OtpError;
};

export type OtpError = 'invalid' | 'expired';

/** Names of the fields the page posts to `url.loginAction`. */
export const OTP_FIELDS = {
  /** The 6-digit code, digits only. Sent with action `verify`. */
  code: 'otp',
  /** What the user asked for; one of OTP_ACTIONS. */
  action: 'action',
} as const;

export const OTP_ACTIONS = {
  /** Check the code in `otp`. */
  verify: 'verify',
  /** Send a new code on the current channel (also "Try again" after both channels failed). */
  resend: 'resend',
  /** Send a code by SMS (switch channel, or "Try SMS again"). */
  sendSms: 'send-sms',
  /** Send a code by email (switch channel, or "Send by email" after SMS failed). */
  sendEmail: 'send-email',
} as const;

export type OtpAction = (typeof OTP_ACTIONS)[keyof typeof OTP_ACTIONS];

/**
 * Message keys the authenticator sets (`form.setError(key)`) when it stops the sign-in and sends
 * the user back to login.ftl. The theme defines their text (see i18n.ts), so Keycloak resolves
 * them from the theme's messages bundle.
 */
export const OTP_LOGIN_MESSAGES = {
  tooManyAttempts: 'adiliOtpTooManyAttempts',
  tooManyResends: 'adiliOtpTooManyResends',
} as const;
