import { normalizeVerificationId } from '@adili/events/contracts';

/** Longest code shown back on a malformed-code page; anything longer is cut. */
const SHOWN_MAX = 64;

/**
 * What the result page does with the code in its URL: look up a code in its printed form,
 * redirect any other spelling of a code to the printed form (one address per document), or
 * show a code that cannot be one as malformed without asking the API.
 */
export type CodeResolution =
  | { action: 'look-up'; verificationId: string }
  | { action: 'redirect'; verificationId: string }
  | { action: 'malformed'; shown: string };

export function resolveCode(param: string): CodeResolution {
  const verificationId = normalizeVerificationId(param);
  if (!verificationId) return { action: 'malformed', shown: param.slice(0, SHOWN_MAX) };
  return verificationId === param
    ? { action: 'look-up', verificationId }
    : { action: 'redirect', verificationId };
}
