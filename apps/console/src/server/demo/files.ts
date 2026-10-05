/**
 * The files a presenter uploads during the demo (#679), as the demo panel offers them. The stack
 * serves them (`/demo/files/<name>`, from the mocks), so they always match the fixtures the
 * stack was seeded from: a roster file from another checkout can rename an officer back to a name
 * the IPRS mock no longer holds, and onboarding then fails the identity check.
 */
export const DEMO_FILES = [
  {
    name: 'psc-roster.csv',
    label: 'PSC roster file',
    beat: 'A. Roster import, as Grace Mutiso',
  },
  {
    name: 'payslip-kemsa-june-2026.pdf',
    label: 'Payslip, KEMSA, June 2026',
    beat: 'C. Filing, as Wanjiku Kamau',
  },
  {
    name: 'logbook-fielder-kcx-214j.jpg',
    label: 'Logbook, Toyota Fielder KCX 214J',
    beat: 'C. Filing, as Wanjiku Kamau',
  },
  {
    name: 'title-deed-kiambu-ruiru.pdf',
    label: 'Title deed, Kiambu Ruiru',
    beat: 'C. Filing, as Wanjiku Kamau',
  },
] as const;

export type DemoFile = (typeof DEMO_FILES)[number];

/** Where the console serves a demo file. */
export function demoFileHref(file: DemoFile): string {
  return `/demo/files/${file.name}`;
}
