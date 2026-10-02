import ExcelJS from 'exceljs';

import { ROSTER_COLUMNS } from './columns.js';

export const ROSTER_TEMPLATE_FORMATS = ['csv', 'xlsx'] as const;
export type RosterTemplateFormat = (typeof ROSTER_TEMPLATE_FORMATS)[number];

export interface RosterTemplateFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

const FILE_NAME = 'adili-roster-template';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Excel's built-in "Text" number format. */
const TEXT_FORMAT = '@';

/** Guidance under the column table on the XLSX template's Notes sheet. */
const GENERAL_NOTES = [
  'Fill one row per officer on the Roster sheet, starting on row 2, and delete the sample row.',
  'Keep the header names as they are. Column order does not matter and extra columns are ignored.',
  'Save as .xlsx, or as CSV (UTF-8). Up to 50 MB and 1,000,000 rows.',
];

/**
 * The roster template in `format`, generated from the roster columns: the ten headers and a
 * sample row. The XLSX adds a Notes sheet documenting each column, and formats the identifier
 * columns (`textCell`) as text so Excel keeps their leading zeros.
 */
export async function rosterTemplate(format: RosterTemplateFormat): Promise<RosterTemplateFile> {
  return format === 'csv'
    ? {
        fileName: `${FILE_NAME}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: rosterTemplateCsv(),
      }
    : {
        fileName: `${FILE_NAME}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: await rosterTemplateXlsx(),
      };
}

/** RFC 4180 CSV in UTF-8 with a byte order mark, so Excel opens it as UTF-8. */
function rosterTemplateCsv(): Buffer {
  const rows = [
    ROSTER_COLUMNS.map((column) => column.name),
    ROSTER_COLUMNS.map((column) => column.example),
  ];
  const text = rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
  return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')]);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function rosterTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adili Online';

  const roster = workbook.addWorksheet('Roster', { views: [{ state: 'frozen', ySplit: 1 }] });
  roster.columns = ROSTER_COLUMNS.map((column) => ({
    header: column.name,
    key: column.name,
    width: Math.max(column.name.length, column.example.length) + 4,
    // Column-wide, so the rows HR staff add are text too.
    style: column.textCell ? { numFmt: TEXT_FORMAT } : {},
  }));
  roster.getRow(1).font = { bold: true };
  roster.addRow(Object.fromEntries(ROSTER_COLUMNS.map((column) => [column.name, column.example])));

  const notes = workbook.addWorksheet('Notes');
  notes.columns = [
    { header: 'Column', key: 'name', width: 24 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Format', key: 'format', width: 50 },
    { header: 'Example', key: 'example', width: 32 },
    { header: 'Notes', key: 'note', width: 70 },
  ];
  notes.getRow(1).font = { bold: true };
  for (const column of ROSTER_COLUMNS) {
    notes.addRow({
      name: column.name,
      required: column.required ? 'Yes' : 'No',
      format: column.format,
      example: column.example,
      note: column.note,
    });
  }
  for (const key of ['format', 'note']) {
    notes.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }
  notes.addRow([]);
  for (const note of GENERAL_NOTES) notes.addRow([note]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
