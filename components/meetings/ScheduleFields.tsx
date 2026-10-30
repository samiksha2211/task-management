"use client";

import {
  CYCLES,
  CYCLE_HINT,
  FIFTH_MONDAY_NOTE,
  ORDINAL_OPTIONS,
  REVIEW_CODE,
  fmtDay,
  fortnightStartOptions,
  mondayOnOrAfterISO,
  type Cycle,
} from "@/lib/meetings";

export interface ScheduleValue {
  cycle: Cycle | "";
  /** M: allocated Monday of the month (1-5). */
  monthlyMondayOrdinal: number;
  /** FT: a Monday the alternate-week cycle runs from. */
  fortnightAnchor: string;
}

export const EMPTY_SCHEDULE: ScheduleValue = { cycle: "", monthlyMondayOrdinal: 1, fortnightAnchor: "" };

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Request-body fields for a schedule value, as the task API expects them. */
export function scheduleBody(value: ScheduleValue) {
  return {
    discussionFrequency: value.cycle || null,
    monthlyMondayOrdinal: value.cycle === "MONTHLY" ? value.monthlyMondayOrdinal : null,
    fortnightAnchor:
      value.cycle === "FORTNIGHTLY" ? value.fortnightAnchor || mondayOnOrAfterISO(localToday()) : null,
  };
}

/** Monday-meeting review frequency (W / FT / M) for the Add Task and Edit Task forms. */
export default function ScheduleFields({
  value,
  onChange,
  nextDiscussionDate,
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  nextDiscussionDate?: string | null;
}) {
  const upcoming = mondayOnOrAfterISO(localToday());
  const starts = fortnightStartOptions(upcoming);
  // Keep a saved start Monday selectable even if it is in the past.
  const anchorKnown = !value.fortnightAnchor || starts.some((o) => o.value === value.fortnightAnchor);

  return (
    <>
      <div className="form-group">
        <label>Review Frequency</label>
        <select
          value={value.cycle}
          onChange={(e) => {
            const cycle = e.target.value as Cycle | "";
            onChange({
              ...value,
              cycle,
              fortnightAnchor: cycle === "FORTNIGHTLY" ? value.fortnightAnchor || upcoming : value.fortnightAnchor,
            });
          }}
        >
          <option value="">Not assigned</option>
          {CYCLES.map((c) => (
            <option key={c} value={c}>
              {REVIEW_CODE[c]} – {CYCLE_HINT[c].split(" – ")[0]}
            </option>
          ))}
        </select>
        <span className="form-hint">
          {value.cycle ? CYCLE_HINT[value.cycle] : "How often this task is reviewed at the Monday meeting."}
          {nextDiscussionDate ? ` Next scheduled discussion: ${fmtDay(nextDiscussionDate)}.` : ""}
        </span>
      </div>

      {value.cycle === "MONTHLY" && (
        <div className="form-group">
          <label>Allocated Monday</label>
          <select
            value={value.monthlyMondayOrdinal}
            onChange={(e) => onChange({ ...value, monthlyMondayOrdinal: Number(e.target.value) })}
          >
            {ORDINAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} of every month
              </option>
            ))}
          </select>
          {value.monthlyMondayOrdinal === 5 && <span className="form-hint">{FIFTH_MONDAY_NOTE}</span>}
        </div>
      )}

      {value.cycle === "FORTNIGHTLY" && (
        <div className="form-group">
          <label>Alternate Mondays</label>
          <select
            value={value.fortnightAnchor || upcoming}
            onChange={(e) => onChange({ ...value, fortnightAnchor: e.target.value })}
          >
            {!anchorKnown && (
              <option value={value.fortnightAnchor}>Current: every other Monday from {fmtDay(value.fortnightAnchor)}</option>
            )}
            {starts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="form-hint">The two-week cycle continues across months.</span>
        </div>
      )}
    </>
  );
}
