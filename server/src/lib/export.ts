import fs from "node:fs";

import PDFDocument from "pdfkit";

import type {

  Task,

  User,

  TaskAdditionalAssignee,

  TaskOfficerUpdate,

} from "@prisma/client";



// export type ExportTask = Task & { officer: User };

export type ExportTask = Task & {

  officer: User;



  additionalAssignees: (

    TaskAdditionalAssignee & {

      officer: User;

    }

  )[];

  officerUpdates: (TaskOfficerUpdate & {

    officer:User;

}

)[];

};



export interface TaskExportRow {

  serial: number;

  date: string;



  task: string;

  description: string;

  coordinatorOfficer: string;

  otherOfficers: string;



  actionPlan: string;

  actionPlanTdc: string;

  executionTdc: string;



  status: string;







  drmRemark: string;

  drmAttachment: string;



  boRemark: string;

  boAttachment: string;



}



function fmtDate(value: Date | string): string {

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "";

  return d.toLocaleDateString("en-GB", {

    day: "2-digit",

    month: "short",

    year: "numeric",

  });

}



function statusLabel(task: Task): string {

  if (task.status === "COMPLETED") return "Completed";

  const now = new Date();

  const due = Date.UTC(

    task.dueDate.getUTCFullYear(),

    task.dueDate.getUTCMonth(),

    task.dueDate.getUTCDate()

  );

  const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return due < startToday ? "Overdue" : "Pending";

}



export function rowsFromTasks(

  tasks: ExportTask[]

): TaskExportRow[] {

  return tasks.map((t, i) => {

    const boRemarks = (t.officerUpdates ?? [])

      .filter((update) => update.remark?.trim())

      .map((update) => update.remark!.trim())

      .join("\n");



    const boAttachments = (t.officerUpdates ?? [])

      .filter((update) => update.attachmentUrl)

      .map((update) => update.attachmentUrl!)

      .join("\n");



    const officerActionPlans = (t.officerUpdates ?? [])

      .filter((update) => update.actionPlan?.trim())

      .map((update) => update.actionPlan!.trim())

      .join("\n");



    return {

      serial: i + 1,



      date: fmtDate(t.date),



      task: t.title,

      description: t.description ?? "",



      coordinatorOfficer:

        t.officer?.designation ?? "",



      otherOfficers:

        t.additionalAssignees?.length

          ? t.additionalAssignees

              .map(

                (assignment) =>

                  assignment.officer.designation

              )

              .join(", ")

          : "-",



      actionPlan:

        t.actionPlan?.trim() ||

        officerActionPlans ||

        "-",



      actionPlanTdc:

        t.actionPlanTdc

          ? fmtDate(t.actionPlanTdc)

          : "-",



      executionTdc:

        fmtDate(t.dueDate),



      status:

        statusLabel(t),



      drmRemark:

        t.remarks?.trim() || "-",



      drmAttachment:

        t.attachmentUrl ?? "",



      boRemark:

        boRemarks || "-",



      boAttachment:

        boAttachments || "",

    };

  });

}





/* ------------------------------- CSV ------------------------------- */



const CSV_HEADERS = [
  "S.No", "Date", "Task", "Description", "Co-ordinator Officer", "Other Officers",
  "Action Plan", "Action Plan TDC", "Execution TDC", "Status", "DRM Remark",
  "DRM Attachment", "BO Remark", "BO Attachment",
];

const ROW_KEYS: (keyof TaskExportRow)[] = [
  "serial", "date", "task", "description", "coordinatorOfficer", "otherOfficers",
  "actionPlan", "actionPlanTdc", "executionTdc", "status", "drmRemark",
  "drmAttachment", "boRemark", "boAttachment",
];

function csvCell(value: unknown): string {

  const s = String(value ?? "");

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

}



export function exportToCsv(rows: TaskExportRow[]): string {

  const lines = [

    CSV_HEADERS.map(csvCell).join(","),

    ...rows.map((r) => ROW_KEYS.map((k) => csvCell(r[k])).join(",")),

  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;

}



/* ------------------------------- PDF ------------------------------- */

type CellAlign = "left" | "center";

interface PdfColumn {
  key: "serial" | "date" | "task" | "coordinatorOfficer" | "otherOfficers" |
       "actionPlan" | "actionPlanTdc" | "executionTdc" | "status" |
       "drmRemark" | "boRemark";
  label: string;
  pct: number;
  align: CellAlign;
}

interface PdfLayoutColumn extends PdfColumn {
  width: number;
}

// Clean 11-column report. Attachments are rendered inside the corresponding
// DRM/BO remark cells so they do not consume separate narrow columns.
const PDF_LAYOUT: PdfColumn[] = [
  { key: "serial", label: "S.No.", pct: 4, align: "center" },
  { key: "date", label: "Date", pct: 7, align: "center" },
  { key: "task", label: "Task / Description", pct: 19, align: "left" },
  { key: "coordinatorOfficer", label: "Co-ordinator", pct: 9, align: "left" },
  { key: "otherOfficers", label: "Other Officers", pct: 10, align: "left" },
  { key: "actionPlan", label: "Action Plan", pct: 13, align: "left" },
  { key: "actionPlanTdc", label: "Action Plan TDC", pct: 8, align: "center" },
  { key: "executionTdc", label: "Execution TDC", pct: 8, align: "center" },
  { key: "status", label: "Status", pct: 7, align: "center" },
  { key: "drmRemark", label: "DRM Remark / File", pct: 8, align: "left" },
  { key: "boRemark", label: "BO Remark / File", pct: 7, align: "left" },
];

const A4_LANDSCAPE_WIDTH = 841.89;
const PDF_MARGIN = 30;
const PAGE_WIDTH = A4_LANDSCAPE_WIDTH - PDF_MARGIN * 2;

const CELL_PAD_X = 6;
const CELL_PAD_Y = 7;
const LINE_HEIGHT = 12;
const HEADER_H = 34;
const HEADER_SIZE = 8;
const TITLE_SIZE = 9.5;
const DESC_SIZE = 8.5;
const CELL_SIZE = 8.25;
const LINK_SIZE = 7.75;

const HEAD_BG = "#17457B";
const HEAD_FG = "#FFFFFF";
const SEP_COLOR = "#D9E1EA";
const VSEP_COLOR = "#E7ECF2";
const ALT_ROW_BG = "#F7F9FC";
const TITLE_COLOR = "#163D6B";
const TASK_TITLE_COLOR = "#1F2937";
const TASK_DESC_COLOR = "#4B5563";
const CELL_TEXT_COLOR = "#374151";
const LINK_COLOR = "#2563EB";

const STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  Completed: { bg: "#E2F3E7", fg: "#1E7A3C" },
  Pending: { bg: "#FFF3D6", fg: "#9A6B00" },
  Overdue: { bg: "#FBE3E3", fg: "#C1241E" },
};

const FONT_SET = { regular: "Arial", bold: "Arial-Bold" };
const FONT_FALLBACK = { regular: "Helvetica", bold: "Helvetica-Bold" };
type Fonts = { regular: string; bold: string };

const tableWidth = (cols: PdfLayoutColumn[]): number =>
  cols.reduce((s, c) => s + c.width, 0);

function buildColumns(): PdfLayoutColumn[] {
  const base = PDF_LAYOUT.map((c) => Math.round((c.pct / 100) * PAGE_WIDTH));
  const total = base.reduce((s, w) => s + w, 0);
  const cols = PDF_LAYOUT.map((c, i): PdfLayoutColumn => ({ ...c, width: base[i] }));
  const task = cols.find((c) => c.key === "task");
  if (task) task.width += Math.round(PAGE_WIDTH - total);
  return cols;
}

function registerFonts(doc: PDFKit.PDFDocument): Fonts {
  // Works locally on Windows. On Linux/Vercel PDFKit falls back to Helvetica.
  const regular = "C:\\Windows\\Fonts\\arial.ttf";
  const bold = "C:\\Windows\\Fonts\\arialbd.ttf";
  try {
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      doc.registerFont(FONT_SET.regular, regular);
      doc.registerFont(FONT_SET.bold, bold);
      return FONT_SET;
    }
  } catch {
    // use PDFKit built-in fonts
  }
  return FONT_FALLBACK;
}

// Breaks both normal text and very long strings without spaces. This prevents
// task text from running into the next PDF column.
function wrap(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  size: number
): string[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [""];

  const output: string[] = [];
  const paragraphs = raw.split(/\r?\n/);

  const splitLongWord = (word: string): string[] => {
    if (doc.widthOfString(word) <= width) return [word];
    const pieces: string[] = [];
    let part = "";
    for (const ch of word) {
      const test = part + ch;
      if (part && doc.widthOfString(test) > width) {
        pieces.push(part);
        part = ch;
      } else {
        part = test;
      }
    }
    if (part) pieces.push(part);
    return pieces.length ? pieces : [word];
  };

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push("");
      continue;
    }

    let current = "";
    for (const original of words) {
      const pieces = splitLongWord(original);
      for (const piece of pieces) {
        const test = current ? `${current} ${piece}` : piece;
        if (doc.widthOfString(test) <= width) {
          current = test;
        } else {
          if (current) output.push(current);
          current = piece;
        }
      }
    }
    if (current) output.push(current);
  }

  return output.length ? output : [""];
}

function measureLines(
  doc: PDFKit.PDFDocument,
  font: string,
  text: string,
  width: number,
  size: number
): string[] {
  doc.font(font).fontSize(size);
  return wrap(doc, text, width, size);
}

function cellValue(row: TaskExportRow, col: PdfColumn): string {
  return String(row[col.key] ?? "");
}

const PDF_ATTACHMENT_BASE_URL = (
  process.env.PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");

function attachmentLinks(value: string): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) =>
      /^https?:\/\//i.test(v)
        ? v
        : `${PDF_ATTACHMENT_BASE_URL}/${v.replace(/^\/+/, "")}`
    );
}

function taskLines(
  doc: PDFKit.PDFDocument,
  row: TaskExportRow,
  width: number,
  fonts: Fonts
): { title: string[]; desc: string[]; count: number } {
  const title = measureLines(doc, fonts.bold, row.task, width, TITLE_SIZE);
  const desc = row.description
    ? measureLines(doc, fonts.regular, row.description, width, DESC_SIZE)
    : [];
  return { title, desc, count: title.length + desc.length };
}

function remarkMetrics(
  doc: PDFKit.PDFDocument,
  row: TaskExportRow,
  col: PdfLayoutColumn,
  fonts: Fonts
): { lines: string[]; links: string[]; count: number } {
  const contentW = col.width - CELL_PAD_X * 2;
  const isDrm = col.key === "drmRemark";
  const text = isDrm ? row.drmRemark : row.boRemark;
  const attachment = isDrm ? row.drmAttachment : row.boAttachment;
  const lines = measureLines(doc, fonts.regular, text, contentW, CELL_SIZE);
  const links = attachmentLinks(attachment);
  return { lines, links, count: lines.length + links.length };
}

function rowHeight(
  doc: PDFKit.PDFDocument,
  cols: PdfLayoutColumn[],
  row: TaskExportRow,
  fonts: Fonts
): number {
  let maxLines = 1;
  for (const col of cols) {
    if (col.key === "status") continue;
    const contentW = col.width - CELL_PAD_X * 2;
    let n: number;
    if (col.key === "task") {
      n = taskLines(doc, row, contentW, fonts).count;
    } else if (col.key === "drmRemark" || col.key === "boRemark") {
      n = remarkMetrics(doc, row, col, fonts).count;
    } else {
      n = measureLines(doc, fonts.regular, cellValue(row, col), contentW, CELL_SIZE).length;
    }
    maxLines = Math.max(maxLines, n);
  }
  return Math.max(30, maxLines * LINE_HEIGHT + CELL_PAD_Y * 2);
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  cols: PdfLayoutColumn[],
  fonts: Fonts,
  x: number,
  y: number
): number {
  doc.rect(x, y, tableWidth(cols), HEADER_H).fill(HEAD_BG);
  let cx = x;
  doc.font(fonts.bold).fontSize(HEADER_SIZE).fillColor(HEAD_FG);

  for (const col of cols) {
    const contentW = col.width - CELL_PAD_X * 2;
    const lines = measureLines(doc, fonts.bold, col.label, contentW, HEADER_SIZE);
    const textH = lines.length * 9;
    let ty = y + (HEADER_H - textH) / 2;

    for (const line of lines) {
      doc.text(line, cx + CELL_PAD_X, ty, {
        width: contentW,
        align: col.align,
        lineGap: 0,
      });
      ty += 9;
    }
    cx += col.width;
  }
  return y + HEADER_H;
}

function drawStatusBadge(
  doc: PDFKit.PDFDocument,
  col: PdfLayoutColumn,
  cx: number,
  y: number,
  rowH: number,
  fonts: Fonts,
  status: string
): void {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.Pending;
  const size = 7.5;
  const padX = 6;
  doc.font(fonts.bold).fontSize(size);
  const maxW = Math.max(20, col.width - 8);
  const naturalW = doc.widthOfString(status) + padX * 2;
  const bw = Math.min(naturalW, maxW);
  const bh = 16;
  const bx = cx + (col.width - bw) / 2;
  const by = y + (rowH - bh) / 2;
  doc.roundedRect(bx, by, bw, bh, bh / 2).fill(style.bg);
  doc.fillColor(style.fg).text(status, bx, by + 4, {
    width: bw,
    align: "center",
    lineGap: 0,
  });
}

function drawRemarkCell(
  doc: PDFKit.PDFDocument,
  col: PdfLayoutColumn,
  fonts: Fonts,
  cx: number,
  y: number,
  rowH: number,
  row: TaskExportRow
): void {
  const contentW = col.width - CELL_PAD_X * 2;
  const { lines, links } = remarkMetrics(doc, row, col, fonts);
  const totalH = (lines.length + links.length) * LINE_HEIGHT;
  let ty = y + CELL_PAD_Y + (rowH - CELL_PAD_Y * 2 - totalH) / 2;

  doc.font(fonts.regular).fontSize(CELL_SIZE).fillColor(CELL_TEXT_COLOR);
  for (const line of lines) {
    doc.text(line, cx + CELL_PAD_X, ty, { width: contentW, lineGap: 0 });
    ty += LINE_HEIGHT;
  }

  links.forEach((link, index) => {
    const label = links.length === 1 ? "View Attachment" : `View Attachment ${index + 1}`;
    doc.font(fonts.regular).fontSize(LINK_SIZE).fillColor(LINK_COLOR).text(
      label,
      cx + CELL_PAD_X,
      ty,
      { width: contentW, link, underline: true, lineGap: 0 }
    );
    ty += LINE_HEIGHT;
  });
}

function drawRowContent(
  doc: PDFKit.PDFDocument,
  cols: PdfLayoutColumn[],
  fonts: Fonts,
  x: number,
  row: TaskExportRow,
  y: number,
  rowH: number,
  isAlt: boolean
): void {
  doc.rect(x, y, tableWidth(cols), rowH).fill(isAlt ? ALT_ROW_BG : "#FFFFFF");

  let vx = x;
  for (let i = 0; i < cols.length - 1; i++) {
    vx += cols[i].width;
    doc.moveTo(vx, y).lineTo(vx, y + rowH).strokeColor(VSEP_COLOR).lineWidth(0.5).stroke();
  }

  let cx = x;
  for (const col of cols) {
    const contentW = col.width - CELL_PAD_X * 2;

    if (col.key === "status") {
      drawStatusBadge(doc, col, cx, y, rowH, fonts, row.status);
    } else if (col.key === "task") {
      const { title, desc } = taskLines(doc, row, contentW, fonts);
      const total = title.length + desc.length;
      let ty = y + CELL_PAD_Y + (rowH - CELL_PAD_Y * 2 - total * LINE_HEIGHT) / 2;

      doc.font(fonts.bold).fontSize(TITLE_SIZE).fillColor(TASK_TITLE_COLOR);
      for (const line of title) {
        doc.text(line, cx + CELL_PAD_X, ty, { width: contentW, lineGap: 0 });
        ty += LINE_HEIGHT;
      }

      if (desc.length) {
        doc.font(fonts.regular).fontSize(DESC_SIZE).fillColor(TASK_DESC_COLOR);
        for (const line of desc) {
          doc.text(line, cx + CELL_PAD_X, ty, { width: contentW, lineGap: 0 });
          ty += LINE_HEIGHT;
        }
      }
    } else if (col.key === "drmRemark" || col.key === "boRemark") {
      drawRemarkCell(doc, col, fonts, cx, y, rowH, row);
    } else {
      const lines = measureLines(doc, fonts.regular, cellValue(row, col), contentW, CELL_SIZE);
      const textH = lines.length * LINE_HEIGHT;
      let ty = y + CELL_PAD_Y + (rowH - CELL_PAD_Y * 2 - textH) / 2;
      doc.font(fonts.regular).fontSize(CELL_SIZE).fillColor(CELL_TEXT_COLOR);
      for (const line of lines) {
        doc.text(line, cx + CELL_PAD_X, ty, {
          width: contentW,
          align: col.align,
          lineGap: 0,
        });
        ty += LINE_HEIGHT;
      }
    }

    cx += col.width;
  }
}

export async function exportToPdf(
  rows: TaskExportRow[],
  meta: { title: string; subtitle: string }
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PDF_MARGIN,
    info: { Title: meta.title },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const fonts = registerFonts(doc);
  const cols = buildColumns();
  const tableW = tableWidth(cols);
  const pageWidth = doc.page.width - PDF_MARGIN * 2;
  const x = PDF_MARGIN + (pageWidth - tableW) / 2;

  doc.font(fonts.bold).fontSize(17).fillColor(TITLE_COLOR)
    .text(meta.title, PDF_MARGIN, PDF_MARGIN - 2);
  doc.font(fonts.regular).fontSize(9).fillColor("#6B7280")
    .text(meta.subtitle, PDF_MARGIN, PDF_MARGIN + 20);
  doc.moveTo(x, PDF_MARGIN + 36).lineTo(x + tableW, PDF_MARGIN + 36)
    .strokeColor("#CBD5E1").lineWidth(1).stroke();

  let y = PDF_MARGIN + 46;
  y = drawHeader(doc, cols, fonts, x, y);
  const headerBottomY = y;
  let pageNum = 1;
  const pageSeparators: number[] = [headerBottomY];

  const drawFooter = (): void => {
    doc.font(fonts.regular).fontSize(8).fillColor("#94A3B8").text(
      `Page ${pageNum}`,
      doc.page.width - PDF_MARGIN - 120,
      doc.page.height - PDF_MARGIN - 12,
      { width: 120, align: "right" }
    );
  };

  const flushSeparators = (): void => {
    for (const yy of pageSeparators) {
      doc.moveTo(x, yy).lineTo(x + tableW, yy)
        .strokeColor(SEP_COLOR).lineWidth(0.6).stroke();
    }
    pageSeparators.length = 0;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowH = rowHeight(doc, cols, row, fonts);

    if (y + rowH > doc.page.height - PDF_MARGIN) {
      drawFooter();
      flushSeparators();
      doc.addPage();
      pageNum += 1;
      y = PDF_MARGIN + 6;
      y = drawHeader(doc, cols, fonts, x, y);
      pageSeparators.push(y);
    }

    drawRowContent(doc, cols, fonts, x, row, y, rowH, i % 2 === 1);
    pageSeparators.push(y + rowH);
    y += rowH;
  }

  flushSeparators();
  drawFooter();
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
