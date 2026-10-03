import { z } from 'zod';

/** A SHA-256 digest as the service stores and prints it: 64 lowercase hex digits. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

export const sha256Schema = z.string().regex(SHA256_HEX);
