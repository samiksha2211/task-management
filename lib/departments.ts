// The 13 departments and which one a designation belongs to. A task's
// department comes from its concerned officers, so nothing is stored per task.

import { DESIGNATIONS } from "./designations";

export const DEPARTMENTS = [
  "General Administration",
  "Electrical",
  "S&T",
  "Medical",
  "Engineering",
  "Safety",
  "Operating",
  "Mechanical",
  "Environment & Housing Management",
  "Security",
  "Finance",
  "Commercial",
  "Stores",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

/** Designations meaning every department rather than one officer. */
const ALL_BO_DESIGNATIONS = /^all (concerned )?bos$/i;

// Matches variants such as Sr.DEE/Coaching as well as Sr.DEE/Chg.
const RULES: [RegExp, Department][] = [
  [/^(sr\.?\s*)?denhm\b/i, "Environment & Housing Management"],
  [/^((sr\.?\s*)?den\b|all sr\.?\s*dens\b|cpm\/gsu)/i, "Engineering"],
  [/^((sr\.?\s*)?dee\b|principal\/etc)/i, "Electrical"],
  [/^((sr\.?\s*)?dste\b|all sr\.?\s*dstes\b|je\/tele)/i, "S&T"],
  [/^((sr\.?\s*)?dme\b|(sr\.?\s*)?dauo\b)/i, "Mechanical"],
  [/^((sr\.?\s*)?dom\b|dy\.?\s*ctm\b)/i, "Operating"],
  [/^(sr\.?\s*)?dcm\b/i, "Commercial"],
  [/^(sr\.?\s*)?dfm\b/i, "Finance"],
  [/^cms\b/i, "Medical"],
  [/^(sr\.?\s*)?dmm\b/i, "Stores"],
  [/^(sr\.?\s*)?dso\b/i, "Safety"],
  [/^(sr\.?\s*)?dsc\b/i, "Security"],
  [/^(drm\b|adrm\b|sd\/|rajbhasha\b|pro\/|(sr\.?\s*)?dpo\b|ps-\d|senior clerk\b)/i, "General Administration"],
];

export function isDepartment(value: string | null | undefined): value is Department {
  return (DEPARTMENTS as readonly string[]).includes(value ?? "");
}

export function isAllBoDesignation(designation: string): boolean {
  return ALL_BO_DESIGNATIONS.test(designation.trim());
}

export function departmentOf(designation: string | null | undefined): Department | null {
  const value = (designation ?? "").trim();
  return RULES.find(([rule]) => rule.test(value))?.[1] ?? null;
}

interface ConcernedOfficers {
  officer?: { designation?: string | null } | null;
  additionalAssignees?: { designation?: string | null }[] | null;
}

function concernedDesignations(task: ConcernedOfficers): string[] {
  return [task.officer?.designation, ...(task.additionalAssignees ?? []).map((a) => a.designation)].filter(
    (d): d is string => !!d
  );
}

/** Departments concerned with a task, the co-ordinator's first. */
export function taskDepartments(task: ConcernedOfficers): string[] {
  const designations = concernedDesignations(task);
  if (designations.some(isAllBoDesignation)) return ["All Departments"];
  return [...new Set(designations.map(departmentOf).filter((d): d is Department => !!d))];
}

export function taskInDepartment(task: ConcernedOfficers, department: Department): boolean {
  return concernedDesignations(task).some((d) => isAllBoDesignation(d) || departmentOf(d) === department);
}

/** Each department with its designations; `extra` adds designations in use. */
export function designationsByDepartment(extra: string[] = []) {
  const all = [...new Set([...DESIGNATIONS, ...extra])].filter((d) => !isAllBoDesignation(d));
  const byName = (a: string, b: string) => a.localeCompare(b);
  return {
    departments: DEPARTMENTS.map((department) => ({
      department,
      designations: all.filter((d) => departmentOf(d) === department).sort(byName),
    })),
    other: all.filter((d) => !departmentOf(d)).sort(byName),
  };
}
