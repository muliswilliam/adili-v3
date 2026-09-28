/**
 * The results the BFF modules share when a backend call does not settle normally, so routes can
 * branch on `status` whichever service answered.
 */

export interface Unavailable {
  status: 'unavailable';
}
export interface NotFound {
  status: 'not-found';
}
/** The declarant's session has ended; sign in again. */
export interface Unauthenticated {
  status: 'unauthenticated';
}

export const unavailable: Unavailable = { status: 'unavailable' };
export const notFound: NotFound = { status: 'not-found' };

/** Runs a backend call, reading a thrown error (network, timeout) as the service being down. */
export async function attempt<T>(call: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await call();
  } catch {
    return unavailable;
  }
}
