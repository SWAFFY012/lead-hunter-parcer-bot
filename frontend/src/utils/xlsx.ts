import type { SheetData } from 'write-excel-file/browser';

export type ExcelValue = string | number | boolean;

export async function saveXlsx(filename: string, rows: ExcelValue[][]) {
  if (!rows.length) return;
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const sheetData: SheetData = rows.map((row, rowIndex) => row.map((value) => ({
    value,
    type: typeof value === 'number' ? Number : typeof value === 'boolean' ? Boolean : String,
    fontWeight: rowIndex === 0 ? 'bold' : undefined,
    backgroundColor: rowIndex === 0 ? '#E8EEF9' : undefined,
    wrap: true,
    align: rowIndex === 0 ? 'center' : 'left',
  })));
  const columnCount = Math.max(...rows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxLength = Math.max(...rows.map((row) => String(row[columnIndex] ?? '').length));
    return { width: Math.min(45, Math.max(12, maxLength + 2)) };
  });

  await writeXlsxFile(sheetData, { columns, stickyRowsCount: 1 }).toFile(filename);
}
