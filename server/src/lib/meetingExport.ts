import ExcelJS from "exceljs";

export interface AgendaExportRow {
  serial: number;
  taskId: number;
  title: string;
  coordinator: string;
  cycle: string;
  status: string;
  lastDiscussed: string | null;
  nextDiscussion: string | null;
  remarks: string;
  reason: string;
  outcome: string;
  notes: string;
  meetingDate: string;
}

interface Column {
  header: string;
  key: keyof AgendaExportRow;
  width: number;
  date?: boolean;
  wrap?: boolean;
}

const COLUMNS: Column[] = [
  { header: "S.No", key: "serial", width: 6 },
  { header: "Task ID", key: "taskId", width: 9 },
  { header: "Task Name", key: "title", width: 42, wrap: true },
  { header: "Co-ordinator", key: "coordinator", width: 18 },
  { header: "Discussion Cycle", key: "cycle", width: 14 },
  { header: "Status", key: "status", width: 12 },
  { header: "Last Discussed", key: "lastDiscussed", width: 15, date: true },
  { header: "Next Discussion", key: "nextDiscussion", width: 15, date: true },
  { header: "Latest Remarks / Update", key: "remarks", width: 50, wrap: true },
  { header: "Why on Agenda", key: "reason", width: 32, wrap: true },
  { header: "Outcome", key: "outcome", width: 16 },
  { header: "Discussion Notes", key: "notes", width: 40, wrap: true },
  { header: "Meeting Date", key: "meetingDate", width: 15, date: true },
];

const DATE_FORMAT = "dd-mmm-yyyy";

function excelDate(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

export async function exportAgendaToXlsx(
  rows: AgendaExportRow[],
  meta: { meetingDate: string; taskCount: number }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RailWork";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`Agenda ${meta.meetingDate}`, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  for (const row of rows) {
    const values: Record<string, unknown> = { ...row };
    for (const c of COLUMNS) if (c.date) values[c.key] = excelDate(row[c.key] as string | null);
    sheet.addRow(values);
  }

  COLUMNS.forEach((c, index) => {
    const column = sheet.getColumn(index + 1);
    if (c.date) column.numFmt = DATE_FORMAT;
    column.alignment = { vertical: "top", wrapText: Boolean(c.wrap) };
  });

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF163D6B" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: COLUMNS.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportAgendaToCsv(rows: AgendaExportRow[]): string {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c.key])).join(","));
  // BOM so Excel opens the file as UTF-8.
  return `﻿${lines.join("\r\n")}`;
}
