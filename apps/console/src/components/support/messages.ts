/** Copy for Account support, the helpdesk's person lookup (spec 03). */
export const messages = {
  title: 'Account support',
  intro:
    'Find a person by their officer reference to help them sign in or recover access. You see account details only, never their roster records or declarations, and every lookup is recorded in the audit trail.',
  noAccess: 'Account support is for the helpdesk.',
  search: {
    label: 'Look up a person',
    field: 'Officer reference',
    hint: 'OFR-0482913-L',
    help: 'On their onboarding confirmation, their acknowledgement slips and their portal profile.',
    submit: 'Look up',
    invalid: 'Enter an officer reference like OFR-0482913-L.',
  },
  result: {
    title: 'Account found',
    name: 'Name',
    ofr: 'Officer reference',
    commissions: 'Onboarded at',
    noCommissions: 'No Commission yet',
    email: 'Verified email',
    phone: 'Verified phone',
    onFile: 'On file',
    notOnFile: 'None on file',
    created: 'Account created',
    recovery:
      'Recovery codes go only to the contacts on file. If neither is on file, the person onboards again with their reporting officer.',
  },
  notFound: {
    title: 'No account with this officer reference',
    text: 'Check the reference with the person. Someone who has not onboarded yet has no officer reference.',
  },
  mistyped: {
    title: 'That officer reference has a typo',
    text: 'Its last character does not match the rest. Check each character with the person.',
  },
  unavailable: {
    title: 'The directory is not answering',
    text: 'Try the lookup again in a moment.',
  },
  forbidden: {
    title: 'You cannot look people up',
    text: 'Only the helpdesk and platform admins can.',
  },
} as const;
