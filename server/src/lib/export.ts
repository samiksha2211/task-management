import fs from "node:fs";

import PDFDocument from "pdfkit";

import type {

  Task,

  User,

  TaskAdditionalAssignee,

  TaskOfficerUpdate,

  TaskAttachment,
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

  attachments?: TaskAttachment[];

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

  /** Optional section heading (e.g. discussion cycle) drawn before the row's group. */
  group?: string;

  // Monday meeting columns (only in PDFs that ask for them).
  review?: string;
  allocatedMonday?: string;
  scheduledDate?: string;
  latestRemark?: string;
  latestBoRemark?: string;

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



    const boAttachments = (t.attachments ?? [])
      .filter((a) => a.officerUpdateId)
      .map((a) => a.url)
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



      drmAttachment: (t.attachments ?? [])
        .filter((a) => !a.officerUpdateId)
        .map((a) => a.url)
        .join("\n"),



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
       "drmRemark" | "boRemark" |
       "review" | "allocatedMonday" | "scheduledDate" | "latestRemark" | "latestBoRemark";
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
  { key: "coordinatorOfficer", label: "Co-ordinator Officer", pct: 9, align: "left" },
  { key: "otherOfficers", label: "Other Officers", pct: 10, align: "left" },
  { key: "actionPlan", label: "Action Plan", pct: 13, align: "left" },
  { key: "actionPlanTdc", label: "Action Plan TDC", pct: 8, align: "center" },
  { key: "executionTdc", label: "Execution TDC", pct: 8, align: "center" },
  { key: "status", label: "Status", pct: 7, align: "center" },
  { key: "drmRemark", label: "DRM Remark / File", pct: 8, align: "left" },
  { key: "boRemark", label: "BO Remark / File", pct: 7, align: "left" },
  // Monday meeting columns
  { key: "review", label: "Review Freq.", pct: 7, align: "center" },
  { key: "allocatedMonday", label: "Allocated Monday", pct: 9, align: "center" },
  { key: "scheduledDate", label: "Scheduled Discussion", pct: 9, align: "center" },
  { key: "latestRemark", label: "Latest Remark / Update", pct: 30, align: "left" },
  { key: "latestBoRemark", label: "Latest BO Remarks", pct: 23, align: "left" },
];

/** The Task Report columns, in order. */
const TASK_REPORT_COLUMNS: PdfColumn["key"][] = [
  "serial", "date", "task", "coordinatorOfficer", "otherOfficers", "actionPlan",
  "actionPlanTdc", "executionTdc", "status", "drmRemark", "boRemark",
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

export type PdfColumnKey = PdfColumn["key"];

/**
 * Columns in the given order, sized by their share of the page width. The
 * Task Report (all default columns) keeps exactly its original widths.
 */
function buildColumns(keys: PdfColumnKey[], widths: Partial<Record<PdfColumnKey, number>> = {}): PdfLayoutColumn[] {
  const layout = keys.map((k) => {
    const col = PDF_LAYOUT.find((c) => c.key === k);
    if (!col) throw new Error(`Unknown PDF column: ${k}`);
    return { ...col, pct: widths[k] ?? col.pct };
  });
  const totalPct = layout.reduce((sum, c) => sum + c.pct, 0);
  const cols = layout.map((c): PdfLayoutColumn => ({ ...c, width: Math.round((c.pct / totalPct) * PAGE_WIDTH) }));
  const widest = cols.find((c) => c.key === "task") ?? cols[0];
  widest.width += Math.round(PAGE_WIDTH - tableWidth(cols));
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

// ---------------------------------------------------------------------------
// Table rendering. Every cell is turned into a list of text lines first, so a
// row's height is exact, text is never clipped, and a row taller than a page
// continues on the next page.

interface CellLine {
  text: string;
  font: string;
  size: number;
  color: string;
  link?: string;
}

interface Cell {
  lines: CellLine[];
  align: CellAlign;
  /** Status badge drawn instead of text. */
  badge?: string;
}

/** Lines a status badge takes up. */
const BADGE_LINES = 2;
const MIN_ROW_H = 26;

function cellOf(doc: PDFKit.PDFDocument, row: TaskExportRow, col: PdfLayoutColumn, fonts: Fonts): Cell {
  const width = col.width - CELL_PAD_X * 2;
  const plain = (text: string, font = fonts.regular, size = CELL_SIZE, color = CELL_TEXT_COLOR): CellLine[] =>
    measureLines(doc, font, text, width, size).map((t) => ({ text: t, font, size, color }));

  switch (col.key) {
    case "status":
      return { lines: [], align: "center", badge: row.status };
    case "task":
      return {
        align: "left",
        lines: [
          ...plain(row.task, fonts.bold, TITLE_SIZE, TASK_TITLE_COLOR),
          ...(row.description ? plain(row.description, fonts.regular, DESC_SIZE, TASK_DESC_COLOR) : []),
        ],
      };
    case "review": {
      const [code, ...rest] = cellValue(row, col).split("\n");
      return {
        align: "center",
        lines: [
          ...plain(code, fonts.bold, TITLE_SIZE, TITLE_COLOR),
          ...(rest.length ? plain(rest.join(" ")) : []),
        ],
      };
    }
    case "drmRemark":
    case "boRemark": {
      const isDrm = col.key === "drmRemark";
      const links = attachmentLinks(isDrm ? row.drmAttachment : row.boAttachment);
      return {
        align: "left",
        lines: [
          ...plain(isDrm ? row.drmRemark : row.boRemark),
          ...links.map((link, i) => ({
            text: links.length === 1 ? "View Attachment" : `View Attachment ${i + 1}`,
            font: fonts.regular,
            size: LINK_SIZE,
            color: LINK_COLOR,
            link,
          })),
        ],
      };
    }
    default:
      return { align: col.align, lines: plain(cellValue(row, col) || "-") };
  }
}

function cellLineCount(cell: Cell): number {
  return cell.badge ? BADGE_LINES : Math.max(1, cell.lines.length);
}

function rowHeightFor(lineCount: number): number {
  return Math.max(MIN_ROW_H, lineCount * LINE_HEIGHT + CELL_PAD_Y * 2);
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
  for (const col of cols) {
    const contentW = col.width - CELL_PAD_X * 2;
    const lines = measureLines(doc, fonts.bold, col.label, contentW, HEADER_SIZE);
    let ty = y + (HEADER_H - lines.length * 9) / 2;
    doc.font(fonts.bold).fontSize(HEADER_SIZE).fillColor(HEAD_FG);
    for (const line of lines) {
      doc.text(line, cx + CELL_PAD_X, ty, { width: contentW, align: col.align, lineGap: 0, lineBreak: false });
      ty += 9;
    }
    cx += col.width;
  }
  return y + HEADER_H;
}

function drawStatusBadge(doc: PDFKit.PDFDocument, col: PdfLayoutColumn, cx: number, y: number, fonts: Fonts, status: string): void {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.Pending;
  doc.font(fonts.bold).fontSize(7.5);
  const bw = Math.min(doc.widthOfString(status) + 12, Math.max(20, col.width - 8));
  const bh = 16;
  const bx = cx + (col.width - bw) / 2;
  doc.roundedRect(bx, y, bw, bh, bh / 2).fill(style.bg);
  doc.fillColor(style.fg).text(status, bx, y + 4, { width: bw, align: "center", lineGap: 0, lineBreak: false });
}

/**
 * Draw lines [from, from + count) of every cell of a row, top-aligned.
 * `continued` marks the later parts of a row split across pages.
 */
function drawRowPart(
  doc: PDFKit.PDFDocument,
  cols: PdfLayoutColumn[],
  cells: Cell[],
  fonts: Fonts,
  x: number,
  y: number,
  rowH: number,
  from: number,
  count: number,
  isAlt: boolean,
  continued: boolean
): void {
  doc.rect(x, y, tableWidth(cols), rowH).fill(isAlt ? ALT_ROW_BG : "#FFFFFF");
  let vx = x;
  for (let i = 0; i < cols.length - 1; i++) {
    vx += cols[i].width;
    doc.moveTo(vx, y).lineTo(vx, y + rowH).strokeColor(VSEP_COLOR).lineWidth(0.5).stroke();
  }

  let cx = x;
  cols.forEach((col, i) => {
    const cell = cells[i];
    const contentW = col.width - CELL_PAD_X * 2;
    if (cell.badge) {
      if (!continued) drawStatusBadge(doc, col, cx, y + CELL_PAD_Y - 2, fonts, cell.badge);
    } else if (continued && col.key === "serial") {
      doc.font(fonts.regular).fontSize(7).fillColor(TASK_DESC_COLOR)
        .text("contd.", cx + CELL_PAD_X, y + CELL_PAD_Y, { width: contentW, align: "center", lineGap: 0, lineBreak: false });
    } else {
      let ty = y + CELL_PAD_Y;
      for (const line of cell.lines.slice(from, from + count)) {
        doc.font(line.font).fontSize(line.size).fillColor(line.color).text(line.text, cx + CELL_PAD_X, ty, {
          width: contentW,
          align: cell.align,
          lineGap: 0,
          lineBreak: false,
          ...(line.link && { link: line.link, underline: true }),
        });
        ty += LINE_HEIGHT;
      }
    }
    cx += col.width;
  });
}

export async function exportToPdf(
  rows: TaskExportRow[],
  meta: {
    title: string;
    subtitle: string;
    /** Columns to show, in order (default: the Task Report columns). */
    columns?: PdfColumnKey[];
    /** Task Report columns to leave out. */
    exclude?: PdfColumnKey[];
    /** Header text overrides, e.g. { task: "Task Name" }. */
    labels?: Partial<Record<PdfColumnKey, string>>;
    /** Relative column widths overriding the defaults. */
    widths?: Partial<Record<PdfColumnKey, number>>;
    /** Footer text on every page (left side). */
    footer?: string;
  }
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PDF_MARGIN,
    bufferPages: true,
    info: { Title: meta.title },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const fonts = registerFonts(doc);
  const cols = buildColumns(
    meta.columns ?? TASK_REPORT_COLUMNS.filter((k) => !(meta.exclude ?? []).includes(k)),
    meta.widths
  ).map((c) => ({ ...c, label: meta.labels?.[c.key] ?? c.label }));
  const tableW = tableWidth(cols);
  const pageWidth = doc.page.width - PDF_MARGIN * 2;
  const x = PDF_MARGIN + (pageWidth - tableW) / 2;
  // Room above the footer.
  const bottom = doc.page.height - PDF_MARGIN - 16;

  // Title block (first page).
  doc.font(fonts.bold).fontSize(17).fillColor(TITLE_COLOR)
    .text(meta.title, PDF_MARGIN, PDF_MARGIN - 2, { lineBreak: false });
  doc.font(fonts.regular).fontSize(9).fillColor("#4B5563")
    .text(meta.subtitle, PDF_MARGIN, PDF_MARGIN + 20, { width: pageWidth });
  const ruleY = Math.max(PDF_MARGIN + 36, doc.y + 4);
  doc.moveTo(x, ruleY).lineTo(x + tableW, ruleY).strokeColor("#CBD5E1").lineWidth(1).stroke();

  let y = drawHeader(doc, cols, fonts, x, ruleY + 10);
  const separators: number[] = [y];

  const flushSeparators = (): void => {
    for (const yy of separators) {
      doc.moveTo(x, yy).lineTo(x + tableW, yy).strokeColor(SEP_COLOR).lineWidth(0.6).stroke();
    }
    separators.length = 0;
  };

  // Later pages: a short running title, then the column headings again.
  const newPage = (): void => {
    flushSeparators();
    doc.addPage();
    doc.font(fonts.bold).fontSize(9).fillColor(TITLE_COLOR)
      .text(meta.title, x, PDF_MARGIN - 6, { width: tableW, lineBreak: false });
    y = drawHeader(doc, cols, fonts, x, PDF_MARGIN + 10);
    separators.push(y);
  };
  const freshPageLines = Math.floor((bottom - (PDF_MARGIN + 10 + HEADER_H) - CELL_PAD_Y * 2) / LINE_HEIGHT);

  const GROUP_H = 24;
  let lastGroup: string | undefined;
  let groupIndex = 0;

  rows.forEach((row, i) => {
    const cells = cols.map((col) => cellOf(doc, row, col, fonts));
    const lineCount = Math.max(...cells.map(cellLineCount));
    const fullH = rowHeightFor(lineCount);
    const startsGroup = row.group !== undefined && row.group !== lastGroup;
    const isAlt = (row.group !== undefined ? groupIndex : i) % 2 === 1;

    // Keep a group heading with the first lines of its first row.
    const firstPartH = Math.min(fullH, rowHeightFor(Math.min(lineCount, 4)));
    if (y + (startsGroup ? GROUP_H : 0) + firstPartH > bottom) newPage();

    if (startsGroup) {
      doc.rect(x, y, tableW, GROUP_H).fill("#E8F1FB");
      doc.font(fonts.bold).fontSize(10).fillColor(TITLE_COLOR)
        .text(row.group!, x + CELL_PAD_X, y + 7, { width: tableW - CELL_PAD_X * 2, lineGap: 0, lineBreak: false });
      y += GROUP_H;
      separators.push(y);
      lastGroup = row.group;
      groupIndex = 0;
    }
    if (row.group !== undefined) groupIndex += 1;

    if (y + fullH <= bottom) {
      drawRowPart(doc, cols, cells, fonts, x, y, fullH, 0, lineCount, isAlt, false);
      y += fullH;
      separators.push(y);
      return;
    }
    // A row that fits on a fresh page is moved there whole.
    if (lineCount <= freshPageLines && fullH <= bottom - (PDF_MARGIN + 10 + HEADER_H)) {
      newPage();
      drawRowPart(doc, cols, cells, fonts, x, y, fullH, 0, lineCount, isAlt, false);
      y += fullH;
      separators.push(y);
      return;
    }
    // Taller than a page: continue it across pages, nothing cut off.
    let from = 0;
    while (from < lineCount) {
      let room = Math.floor((bottom - y - CELL_PAD_Y * 2) / LINE_HEIGHT);
      if (room < 3) {
        newPage();
        room = freshPageLines;
      }
      const count = Math.min(room, lineCount - from);
      const h = rowHeightFor(count);
      drawRowPart(doc, cols, cells, fonts, x, y, h, from, count, isAlt, from > 0);
      y += h;
      separators.push(y);
      from += count;
      if (from < lineCount) newPage();
    }
  });

  if (rows.length === 0) {
    doc.font(fonts.regular).fontSize(10).fillColor(TASK_DESC_COLOR)
      .text("No tasks.", x + CELL_PAD_X, y + 12, { lineBreak: false });
  }
  flushSeparators();

  // Footer on every page: optional text on the left, "Page X of Y" on the right.
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0; // writing inside the margin must not add a page
    const fy = doc.page.height - PDF_MARGIN - 6;
    doc.moveTo(x, fy - 6).lineTo(x + tableW, fy - 6).strokeColor("#E2E8F0").lineWidth(0.5).stroke();
    doc.font(fonts.regular).fontSize(8).fillColor("#94A3B8");
    if (meta.footer) doc.text(meta.footer, x, fy, { width: tableW / 2, lineBreak: false });
    doc.text(`Page ${p - range.start + 1} of ${range.count}`, x + tableW / 2, fy, {
      width: tableW / 2,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
