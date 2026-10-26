import fs from "node:fs";
import PDFDocument from "pdfkit";

// Task register PDF: every task in one discussion cycle, any status.

export interface RegisterRow {
  taskNumber: number;
  title: string;
  officer: string;
  status: string;
  nextDiscussion: string;
  lastDiscussed: string;
  remarks: string;
}

interface Column {
  header: string;
  key: keyof RegisterRow;
  width: number;
  align?: "left" | "center";
}

const MARGIN = 30;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 5;
const FONT_SIZE = 8.5;
const HEADER_SIZE = 8.5;
const MAX_CELL_CHARS = 1500;

// Landscape A4 is 842pt wide: 782pt of table between the margins.
const COLUMNS: Column[] = [
  { header: "Task ID", key: "taskNumber", width: 44, align: "center" },
  { header: "Task", key: "title", width: 220 },
  { header: "Co-ordinator", key: "officer", width: 82 },
  { header: "Status", key: "status", width: 62, align: "center" },
  { header: "Next discussion", key: "nextDiscussion", width: 70, align: "center" },
  { header: "Last discussed", key: "lastDiscussed", width: 70, align: "center" },
  { header: "Latest remarks / update", key: "remarks", width: 234 },
];
const TABLE_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);

const COLOR = {
  title: "#163D6B",
  muted: "#64748B",
  text: "#1F2937",
  headerBg: "#163D6B",
  headerText: "#FFFFFF",
  altRow: "#F5F7FB",
  line: "#D5DCE6",
};

const STATUS_COLOR: Record<string, string> = {
  Completed: "#1E7A3C",
  Pending: "#9A6B00",
  Overdue: "#C1241E",
};

function fonts(doc: PDFKit.PDFDocument): { regular: string; bold: string } {
  // Arial (Windows) renders more characters than the built-in Helvetica.
  const regular = "C:\\Windows\\Fonts\\arial.ttf";
  const bold = "C:\\Windows\\Fonts\\arialbd.ttf";
  try {
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      doc.registerFont("Arial", regular);
      doc.registerFont("Arial-Bold", bold);
      return { regular: "Arial", bold: "Arial-Bold" };
    }
  } catch {
    // fall back to the built-in font
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" };
}

function cellText(row: RegisterRow, col: Column): string {
  const value = String(row[col.key] ?? "");
  return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value || "—";
}

export async function registerToPdf(
  rows: RegisterRow[],
  meta: { title: string; subtitle: string }
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: MARGIN,
    bufferPages: true,
    info: { Title: meta.title },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const font = fonts(doc);
  const x0 = MARGIN;
  const bottom = doc.page.height - MARGIN - 18;

  const rowHeight = (row: RegisterRow): number => {
    doc.font(font.regular).fontSize(FONT_SIZE);
    const heights = COLUMNS.map((c) =>
      doc.heightOfString(cellText(row, c), { width: c.width - CELL_PAD_X * 2 })
    );
    return Math.max(...heights) + CELL_PAD_Y * 2;
  };

  const drawHeader = (y: number): number => {
    doc.font(font.bold).fontSize(HEADER_SIZE);
    const h =
      Math.max(...COLUMNS.map((c) => doc.heightOfString(c.header, { width: c.width - CELL_PAD_X * 2 }))) +
      CELL_PAD_Y * 2;
    doc.rect(x0, y, TABLE_WIDTH, h).fill(COLOR.headerBg);
    let x = x0;
    for (const c of COLUMNS) {
      doc.fillColor(COLOR.headerText).text(c.header, x + CELL_PAD_X, y + CELL_PAD_Y, {
        width: c.width - CELL_PAD_X * 2,
        align: c.align ?? "left",
      });
      x += c.width;
    }
    return y + h;
  };

  // Title block (first page only).
  doc.font(font.bold).fontSize(18).fillColor(COLOR.title).text(meta.title, x0, MARGIN);
  doc.font(font.regular).fontSize(9.5).fillColor(COLOR.muted).text(meta.subtitle, x0, MARGIN + 24);
  let y = drawHeader(MARGIN + 44);

  if (rows.length === 0) {
    doc.font(font.regular).fontSize(10).fillColor(COLOR.muted).text("No tasks in this register.", x0, y + 12);
  }

  rows.forEach((row, index) => {
    const h = Math.min(rowHeight(row), bottom - MARGIN - 40);
    if (y + h > bottom) {
      doc.addPage();
      y = drawHeader(MARGIN);
    }
    if (index % 2 === 1) doc.rect(x0, y, TABLE_WIDTH, h).fill(COLOR.altRow);

    let x = x0;
    for (const c of COLUMNS) {
      const isStatus = c.key === "status";
      doc
        .font(isStatus || c.key === "taskNumber" ? font.bold : font.regular)
        .fontSize(FONT_SIZE)
        .fillColor(isStatus ? (STATUS_COLOR[row.status] ?? COLOR.text) : COLOR.text)
        .text(cellText(row, c), x + CELL_PAD_X, y + CELL_PAD_Y, {
          width: c.width - CELL_PAD_X * 2,
          height: h - CELL_PAD_Y * 2,
          align: c.align ?? "left",
          ellipsis: true,
        });
      x += c.width;
    }
    doc.moveTo(x0, y + h).lineTo(x0 + TABLE_WIDTH, y + h).strokeColor(COLOR.line).lineWidth(0.5).stroke();
    y += h;
  });

  // Page numbers on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc
      .font(font.regular)
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, x0, doc.page.height - MARGIN - 10, {
        width: TABLE_WIDTH,
        align: "right",
        lineBreak: false,
      });
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
