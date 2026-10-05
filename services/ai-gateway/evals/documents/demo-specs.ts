/**
 * The files Wanjiku uploads in the demo's live filing (#617): her KEMSA payslip, the Fielder's
 * logbook and the Kiambu title deed, drawn like the golden set (`specs.ts`) and consistent with
 * her registry records (`mocks/demo/REGISTRY_FLAGS.md`): Read into the form fills what Check
 * registries also offers. Synthetic, like every person and number here.
 *
 *   pnpm --filter @adili/ai-gateway eval:documents demo   # writes mocks/demo/files/
 */
import { logbook, type SyntheticDocument, titleDeed } from './specs.js';

export const DEMO_DOCUMENTS: readonly SyntheticDocument[] = [
  {
    file: 'payslip-kemsa-june-2026.pdf',
    output: 'pdf',
    pages: [
      [
        { kind: 'center', text: 'KENYA MEDICAL SUPPLIES AUTHORITY', size: 14, bold: true },
        { kind: 'center', text: 'PAYSLIP FOR THE MONTH OF JUNE 2026', size: 11 },
        { kind: 'rule' },
        { kind: 'field', label: 'Employee Name', value: 'Wanjiku Njoki Kamau' },
        { kind: 'field', label: 'Personal No.', value: 'KEMSA/2011/0457' },
        { kind: 'field', label: 'KRA PIN', value: 'A004518637K' },
        { kind: 'field', label: 'Designation', value: 'Senior Procurement Officer' },
        { kind: 'field', label: 'Job Group', value: 'M' },
        { kind: 'field', label: 'Station', value: 'KEMSA Headquarters, Embakasi, Nairobi' },
        { kind: 'rule' },
        {
          kind: 'amounts',
          rows: [
            ['Basic Salary', '182,000.00'],
            ['House Allowance', '50,000.00'],
            ['Commuter Allowance', '28,000.00'],
            ['GROSS PAY', '260,000.00'],
            ['PAYE', '70,231.25'],
            ['Social Health Insurance Fund', '7,150.00'],
            ['NSSF', '4,320.00'],
            ['Housing Levy', '3,900.00'],
            ['Kenya Medical Supplies Sacco', '18,500.00'],
            ['TOTAL DEDUCTIONS', '104,101.25'],
            ['NET PAY', '155,898.75'],
          ],
        },
        { kind: 'rule' },
        {
          kind: 'text',
          size: 9,
          text: 'Bank: Uhuru Commercial Bank, Embakasi branch. Account 0213847566102.',
        },
      ],
    ],
  },
  {
    file: 'logbook-fielder-kcx-214j.jpg',
    output: 'jpeg',
    scan: {
      tiltDegrees: 1.6,
      zoom: 0.94,
      shadow: true,
      noise: 20,
      blur: 0.4,
      seed: 21,
      background: '#6f675c',
    },
    pages: [
      logbook([
        ['Registration No.', 'KCX 214J'],
        ['Make', 'TOYOTA'],
        ['Model', 'FIELDER'],
        ['Body Type', 'STATION WAGON'],
        ['Colour', 'SILVER'],
        ['Year of Manufacture', '2016'],
        ['Engine Rating', '1496 CC'],
        ['Chassis/Frame No.', 'NKE165-7104582'],
        ['Fuel', 'PETROL'],
        ['Registered Owner', 'WANJIKU NJOKI KAMAU'],
        ['Owner PIN', 'A004518637K'],
        ['Date of Registration', '12/05/2019'],
      ]),
    ],
  },
  {
    file: 'title-deed-kiambu-ruiru.pdf',
    output: 'scanned-pdf',
    serif: true,
    scan: { tiltDegrees: -0.6, seed: 23 },
    pages: [
      titleDeed([
        ['Title Number', 'KIAMBU/RUIRU EAST BLOCK 2/4417'],
        ['Approximate Area', '0.045 Ha'],
        ['Registry Map Sheet No.', '22'],
        ['Name of Proprietor', 'WANJIKU NJOKI KAMAU'],
        ['ID No.', '27451863'],
        ['Address', 'P.O. Box 47715-00100, Nairobi'],
        ['Tenure', 'Freehold'],
        ['Date of Registration', '3rd September 2014'],
      ]),
    ],
  },
];
