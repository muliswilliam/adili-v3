import ExcelJS from 'exceljs';

/** Reads an XLSX file as a workbook. */
export async function readXlsx(body: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS types `load` for browser buffers; it takes a Node Buffer too.
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return workbook;
}

/** The sheet named `name`; fails the test when there is none. */
export function sheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const found = workbook.getWorksheet(name);
  if (!found) throw new Error(`No sheet named ${name}`);
  return found;
}

/** The values of one row, from column A. */
export function rowValues(worksheet: ExcelJS.Worksheet, row: number): unknown[] {
  return (worksheet.getRow(row).values as unknown[]).slice(1);
}

/** The text values of column `column` from row `from` (1-based) on. */
export function columnText(worksheet: ExcelJS.Worksheet, column: number, from: number): string[] {
  return worksheet
    .getColumn(column)
    .values.slice(from)
    .map((value) => (typeof value === 'string' ? value : ''));
}
