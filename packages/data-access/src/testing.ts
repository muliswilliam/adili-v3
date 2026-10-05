/** Test doubles (`@adili/data-access/testing`): import from tests only, never from service code. */
export { type FakeCipherCall, FakeCipher } from './cipher/fake-cipher.js';
export { isLockConflict, TRUNCATE_ATTEMPTS, truncateTables } from './truncate.js';
