import { writeFileSync } from "node:fs";
import { exportToPdf, rowsFromTasks } from "./src/lib/export";
import type { ExportTask } from "./src/lib/export";

const designations = [
  "Sr. DSTE (East)",
  "All BOs",
  "JE / Rail",
  "AEN / Works",
  "Sr. Section Engineer",
  "Station Master",
  "Chief Depot Manager",
];
const officers = ["R. Sharma", "A. Verma", "P. Singh", "M. Khan", "S. Reddy"];
const statuses: ("PENDING" | "COMPLETED")[] = ["PENDING", "PENDING", "COMPLETED", "PENDING", "COMPLETED"];
const titles = [
  "Annual inspection of overhead electrification equipment along the main line corridor between stations A and B.",
  "Track repair works",
  "All departments shall closely monitor safety-related issues and ensure compliance with the standing orders issued by the board.",
  "Installation of new signalling control panels",
  "Periodic renewal of ballast and sleepers covering the entire 120 km section during the April-September works programme.",
  "Station building renovation",
  "Drainage clearance and monsoon preparedness inspection",
  "Routine maintenance of level crossing gates",
];

function makeTask(i: number, past: boolean): ExportTask {
  const start = new Date(Date.UTC(2026, 7, (i % 28) + 1, 0, 0, 0));
  const due = new Date(start.getTime() + (i % 30) * 86400000 + 86400000 * 2);
  const created = new Date(start.getTime() - 3 * 86400000);
  const updated = new Date(start.getTime() + 2 * 86400000);
  const status = past ? "COMPLETED" : statuses[i % statuses.length];
  return {
    id: `probe-${i}`,
    title: titles[i % titles.length],
    description: i % 4 === 0
      ? "A detailed description that is intentionally long so that the text wraps across multiple lines inside the task column without overlapping the neighbouring columns. It should flow neatly and the row height must grow to accommodate it."
      : "Short description.",
    date: start,
    dueDate: due,
    remarks: "Follow-up required",
    status,
    deletedAt: null,
    createdAt: created,
    updatedAt: updated,
    officerId: `off-${i % 5}`,
    officer: {
      id: `off-${i % 5}`,
      name: officers[i % officers.length],
      email: `${officers[i % officers.length].toLowerCase().replace(/[^a-z]/g, ".")}@railwork.local`,
      designation: designations[i % designations.length],
      password: "",
      role: "OFFICER",
      avatar: null,
      resetToken: null,
      resetTokenExpires: null,
      createdAt: created,
      updatedAt: created,
    },
  } as ExportTask;
}

async function main() {
  const rows = rowsFromTasks(Array.from({ length: 72 }, (_v, i) => makeTask(i, i % 3 === 0)));
  const pdf = await exportToPdf(rows, {
    title: "RailWork — Task Report",
    subtitle: "Generated 12 Aug 2026, 14:30   •   72 task(s)",
  });
  writeFileSync("C:/Users/hp/AppData/Local/Temp/opencode/export_probe_multi.pdf", pdf);
  console.log("multi-page PDF written:", pdf.length, "bytes");

  // Single-page with a handful of rows (realistic small report)
  const small = rowsFromTasks(Array.from({ length: 6 }, (_v, i) => makeTask(i, false)));
  const pdf2 = await exportToPdf(small, {
    title: "RailWork — Task Report",
    subtitle: "Generated 12 Aug 2026, 14:30   •   6 task(s)",
  });
  writeFileSync("C:/Users/hp/AppData/Local/Temp/opencode/export_probe_single.pdf", pdf2);
  console.log("single-page PDF written:", pdf2.length, "bytes");
}
void main();