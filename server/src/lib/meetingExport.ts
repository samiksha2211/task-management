import ExcelJS from "exceljs";

export interface AgendaExportRow {
  serial: number;
  taskId: string;
  title: string;
  coordinator: string;
  section: string;
  status: string;
  frequency: string;
  priority: string;
  lastDiscussed: string | null;
  nextDiscussion: string | null;
  estimatedMinutes: number;
  latestReviewNote: string;
  schedulingReason: string;
  outcome: string;
  notes: string;
  meetingDate: string;
}

export interface AgendaExportMeta {
  meetingDate: string;
  status: string;
  taskCount: number;
  totalMinutes: number;
  limitMinutes: number;
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
  { header: "Task ID", key: "taskId", width: 28 },
  { header: "Task Name", key: "title", width: 40, wrap: true },
  { header: "Co-ordinator Officer", key: "coordinator", width: 20 },
  { header: "Agenda Section", key: "section", width: 24 },
  { header: "Status", key: "status", width: 12 },
  { header: "Frequency", key: "frequency", width: 14 },
  { header: "Priority", key: "priority", width: 10 },
  { header: "Last Discussed", key: "lastDiscussed", width: 15, date: true },
  { header: "Next Discussion Date", key: "nextDiscussion", width: 15, date: true },
  { header: "Estimated Discussion Duration (min)", key: "estimatedMinutes", width: 14 },
  { header: "Latest PDF Update", key: "latestReviewNote", width: 40, wrap: true },
  { header: "Scheduling Reason", key: "schedulingReason", width: 45, wrap: true },
  { header: "Outcome", key: "outcome", width: 14 },
  { header: "Discussion Notes / Decisions", key: "notes", width: 45, wrap: true },
  { header: "Meeting Date", key: "meetingDate", width: 15, date: true },
];

const DATE_FORMAT = "dd-mmm-yyyy";

function excelDate(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

export async function exportAgendaToXlsx(rows: AgendaExportRow[], meta: AgendaExportMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RailWork";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Agenda", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  for (const row of rows) {
    const values: Record<string, unknown> = { ...row };
    for (const c of COLUMNS) if (c.date) values[c.key] = excelDate(row[c.key] as string | null);
    sheet.addRow(values);
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 32;

  COLUMNS.forEach((c, index) => {
    const column = sheet.getColumn(index + 1);
    if (c.date) column.numFmt = DATE_FORMAT;
    column.alignment = { vertical: "top", wrapText: Boolean(c.wrap) };
  });
  header.alignment = { vertical: "middle", wrapText: true };

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: COLUMNS.length },
  };

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Item", key: "item", width: 32 },
    { header: "Value", key: "value", width: 20 },
  ];
  summary.addRows([
    { item: "Meeting date", value: excelDate(meta.meetingDate) },
    { item: "Agenda status", value: meta.status },
    { item: "Tasks to discuss", value: meta.taskCount },
    { item: "Estimated discussion time (min)", value: meta.totalMinutes },
    { item: "Meeting time available (min)", value: meta.limitMinutes },
    {
      item: "Over the limit by (min)",
      value: Math.max(0, meta.totalMinutes - meta.limitMinutes),
    },
  ]);
  summary.getRow(1).font = { bold: true };
  summary.getCell("B2").numFmt = DATE_FORMAT;

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
