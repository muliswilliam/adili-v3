/**
 * What the summary says of a blocking issue (`CompletenessIssue`). The declarations service
 * words its own rules in full ("Add your spouse or tick “No spouse”."), but a schema check
 * reports a fragment for the field at its path ("is required", "must be ..."), which a section
 * shows under that field. The summary lists issues away from their fields, so a fragment is
 * given the field's name, and the item it is on: "Asset 2: explanation of the change is
 * required."
 */
export function issueText(issue: { path: string; message: string }): string {
  const { message } = issue;
  if (!/^[a-z]/.test(message)) return message;
  const { item, field } = fieldOf(issue.path);
  const sentence = item ? `${item}: ${field} ${message}` : `${capitalise(field)} ${message}`;
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}

/** Lists of items within a section, and what one of them is called. */
const ITEM_NOUNS: Record<string, string> = {
  income: 'Income item',
  assets: 'Asset',
  liabilities: 'Liability',
  spouses: 'Spouse',
  children: 'Child',
  directorships: 'Directorship',
  memberships: 'Membership',
  pendingCases: 'Pending case',
  materialChanges: 'Material change',
  attachments: 'Attachment',
};

/**
 * Field names by the end of their path (most specific first), as the sections label them; a
 * whole group is named when nothing in it is answered yet ("/birth" before either half).
 */
const FIELD_NAMES: [suffix: string, name: string][] = [
  ['birth/date', 'date of birth'],
  ['birth/place', 'place of birth'],
  ['birth', 'date and place of birth'],
  ['maritalStatusChange/explanation', 'explanation of the change in marital status'],
  ['address/postal', 'postal address'],
  ['address/physical', 'physical address'],
  ['address', 'postal and physical address'],
  ['employment/nature', 'nature of employment'],
  ['employment/natureOther', 'nature of employment'],
  ['location/county', 'county'],
  ['location/country', 'country'],
  ['original/currency', 'original currency'],
  ['original/minorUnits', 'original amount'],
  ['kesCents', 'amount'],
  ['joint/sharePercent', 'share'],
  ['sharePercent', 'share'],
  ['change/kind', 'what changed'],
  ['change/explanation', 'explanation of the change'],
  ['name/firstName', 'first name'],
  ['name/surname', 'surname'],
  ['dateOfBirth', 'date of birth'],
  ['separationDate', 'date of separation'],
  ['maritalStatus', 'marital status'],
  ['nationalId', 'national ID number'],
  ['kraPin', 'KRA PIN'],
];

function fieldOf(path: string): { item: string | null; field: string } {
  const segments = path.split('/').filter(Boolean);
  // The item is the last list entry on the path: `/spouses/items/0/...` or `/assets/2/...`.
  let item: string | null = null;
  let rest = segments;
  for (const [index, segment] of segments.entries()) {
    if (!/^\d+$/.test(segment)) continue;
    const list = segments[index - 1] === 'items' ? segments[index - 2] : segments[index - 1];
    item = `${(list && ITEM_NOUNS[list]) ?? 'Item'} ${String(Number(segment) + 1)}`;
    rest = segments.slice(index + 1);
  }
  const tail = rest.join('/');
  const named = FIELD_NAMES.find(([suffix]) => tail === suffix || tail.endsWith(`/${suffix}`));
  return { item, field: named ? named[1] : words(rest.at(-1) ?? 'this answer') };
}

/** `separationDate` → `separation date`. */
function words(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
