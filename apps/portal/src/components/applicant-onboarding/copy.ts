import { en, english } from '../../declaration/translatable';
import type { ApplicantOnboardingProblemCode } from '../../server/directory/types';
import { problemMessage } from '../onboarding/problems';

/**
 * Words for Get started as an applicant (spec 10): the frame, each step and the page titles.
 * English with an empty Swahili slot, until the Swahili copy is done; screens read English.
 */

/**
 * What the applicant reads for each problem code of the applicant onboarding contract
 * (`ApplicantOnboardingProblem`). The directory never sends user-facing text; codes shared with
 * the declarant's onboarding read the same as there.
 */
export const APPLICANT_PROBLEM_COPY: Record<
  ApplicantOnboardingProblemCode,
  (context: { attemptsLeft?: number; retryAfterSeconds?: number }) => string
> = {
  'identity-mismatch': () =>
    'These details do not match the national register. Enter your names and ID number exactly as they appear on your ID.',
  'already-onboarded': () => 'You already have an account.',
  'email-in-use': () =>
    'This email address already belongs to another Adili account, so your account could not be created. Start again with another email address, or sign in to that account.',
  'otp-invalid': (context) => problemMessage('otp-invalid', context),
  'otp-expired': () => problemMessage('otp-expired'),
  'otp-send-failed': () => problemMessage('otp-send-failed'),
  'resend-cooldown': (context) => problemMessage('resend-cooldown', context),
  'session-expired': () => problemMessage('session-expired'),
  'iprs-unavailable': () => problemMessage('iprs-unavailable'),
  'identity-unavailable': () => problemMessage('identity-unavailable'),
  'rate-limit-exceeded': (context) => problemMessage('rate-limit-exceeded', context),
  'wrong-step': () => problemMessage('wrong-step'),
};

export function applicantProblemMessage(
  code: ApplicantOnboardingProblemCode,
  context: { attemptsLeft?: number; retryAfterSeconds?: number } = {},
): string {
  return APPLICANT_PROBLEM_COPY[code](context);
}

const APPLICANT_FRAME = {
  back: en('Back'),
  /** Applicants have no Commission or reporting officer to ask yet. */
  help: en('Need help? Contact the EACC helpdesk.'),
};

export const APPLICANT_FRAME_COPY = english(APPLICANT_FRAME);

/** The five steps the stepper shows, one per route. */
const APPLICANT_STEPS = {
  chooseId: en('Choose your ID'),
  details: en('Your details'),
  verifyPhone: en('Verify your phone'),
  create: en('Create your account'),
  setPassword: en('Set your password'),
};

export const APPLICANT_STEPS_COPY = english(APPLICANT_STEPS);

/** The browser tab's title on each page. */
const APPLICANT_TITLES = {
  getStarted: en('Get started · Adili Online'),
  chooseId: en('Choose your ID · Adili Online'),
  details: en('Your details · Adili Online'),
  verifyPhone: en('Verify your phone · Adili Online'),
  create: en('Create your account · Adili Online'),
  checkEmail: en('Check your email · Adili Online'),
};

export const APPLICANT_TITLES_COPY = english(APPLICANT_TITLES);

/** A passport holder's identity is checked by people, not the national register. */
const PASSPORT = {
  notice: en(
    'Your identity will be verified by the Commission when you submit your first request.',
  ),
};

export const PASSPORT_NOTICE = english(PASSPORT).notice;

const ID_TYPE = {
  question: en('How will you identify yourself?'),
  nationalId: en('Kenyan national ID'),
  nationalIdDescription: en('Checked with the national register'),
  passport: en('Passport'),
  passportDescription: en('Checked by the Commission later'),
  continue: en('Continue'),
};

export const ID_TYPE_COPY = english(ID_TYPE);

const DETAILS = {
  title: en('Your details'),
  surname: en('Surname'),
  firstName: en('First name'),
  otherNames: en('Other names'),
  passportNumber: en('Passport number'),
  issuingCountry: en('Issuing country'),
  countryPlaceholder: en('Choose'),
  nationalIdNumber: en('National ID number'),
  mobile: en('Mobile number'),
  mobileHint: en('We send a code by SMS.'),
  kenyanPhonePlaceholder: en('0712 345 678'),
  anyPhonePlaceholder: en('+233 24 471 8265'),
  email: en('Email address'),
  emailHint: en('Your password link goes here.'),
  emailPlaceholder: en('name@example.com'),
  sendingCode: en('Sending code…'),
  checkingRegister: en('Checking the national register…'),
  tryAgainIn: en((clock: string) => `Try again in ${clock}`),
  continue: en('Continue'),
  signIn: en('Sign in'),
  recoverAccess: en('Recover access'),
};

export const DETAILS_COPY = english(DETAILS);

/** What the applicant reads for a field of Your details that is not right yet. */
const DETAILS_FIELD_ERRORS = {
  surname: en('Enter your surname.'),
  firstName: en('Enter your first name.'),
  name: en('Use letters, spaces, apostrophes and hyphens only.'),
  nationalId: en('Enter your national ID number (5 to 10 digits).'),
  passport: en('Enter your passport number (5 to 20 letters or numbers).'),
  country: en('Choose the country that issued your passport.'),
  kenyanPhone: en('Enter a mobile number, e.g. 0712 345 678.'),
  anyPhone: en('Enter your mobile number with the country code, e.g. +233 24 471 8265.'),
};

export const DETAILS_FIELD_ERRORS_COPY = english(DETAILS_FIELD_ERRORS);

/**
 * Verify your phone. The description reads `sentBefore`, the masked phone (or `phoneFallback`),
 * then `sentAfter`.
 */
const VERIFY_PHONE = {
  title: en('Verify your phone'),
  sentBefore: en('We sent a 6-digit code by SMS to '),
  phoneFallback: en('your phone'),
  sentAfter: en('.'),
  wrongNumber: en('Wrong number?'),
  changeIt: en('Change it'),
};

export const VERIFY_PHONE_COPY = english(VERIFY_PHONE);

const CREATE = {
  title: en('Create your account'),
  name: en('Name'),
  passport: en('Passport'),
  nationalId: en('National ID'),
  matchesRegister: en('Matches the register'),
  phone: en('Phone'),
  email: en('Email'),
  creating: en('Creating your account…'),
  create: en('Create account'),
  signIn: en('Sign in'),
  changeDetails: en('Change your details'),
};

export const CREATE_COPY = english(CREATE);

/**
 * Check your email. A description with the masked address reads `...Before`, the address (or
 * `addressFallback`), then `...After`.
 */
const CHECK_EMAIL = {
  newLinkTitle: en('Get a new link to set your password'),
  newLinkDescription: en(
    'We cannot send the email again from this browser. Use Forgot password on the sign-in page instead: enter your email address and we will email you a new link. It sets your password too.',
  ),
  forgotPassword: en('Forgot password'),
  signIn: en('Sign in'),
  addressFallback: en('your email address'),
  failedTitle: en('Your account is ready'),
  failedBefore: en('We could not send the email to set your password to '),
  failedAfter: en('. Send it now; the link expires 24 hours after it is sent.'),
  sentTitle: en('Check your email'),
  sentBefore: en('Your account is ready. Set your password with the link sent to '),
  sentAfter: en('. It expires in 24 hours.'),
};

export const CHECK_EMAIL_COPY = english(CHECK_EMAIL);
