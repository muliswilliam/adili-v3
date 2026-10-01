/** The channels a person is reached on: an email address, or a phone number. */
export const CONTACT_CHANNELS = ['email', 'phone'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
