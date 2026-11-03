"use client";

import {
  FIFTH_MONDAY_NOTE,
  ONE_TIME_CYCLES,
  ONE_TIME_HINT,
  ONE_TIME_LABEL,
  ORDINAL_OPTIONS,
  addDaysISO,
  fmtDay,
  fmtMonday,
  REPEATING_CHOICES,
  isOneTime,
  mondayOnOrAfterISO,
  nextMonthMondaysISO,
  type FrequencyChoice,
} from "@/lib/meetings";

export interface ScheduleValue {
  /** W, F1, F2, M or a one-time frequency. */
  cycle: FrequencyChoice | "";
  /** M: allocated Monday of the month (1-5). */
  monthlyMondayOrdinal: number;
  /** Next Month / Flexible Date: the chosen Monday (YYYY-MM-DD). */
  allocatedMonday?: string;
}

export const EMPTY_SCHEDULE: ScheduleValue = { cycle: "", monthlyMondayOrdinal: 1, allocatedMonday: "" };

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Request-body fields for a schedule value, as the task API expects them. */
export function scheduleBody(value: ScheduleValue) {
  return {
    discussionFrequency: value.cycle || null,
    monthlyMondayOrdinal: value.cycle === "MONTHLY" ? value.monthlyMondayOrdinal : null,
    // Next Monday is always the coming Monday; the server works it out.
    allocatedMonday:
      value.cycle === "NEXT_MONTH" || value.cycle === "FLEXIBLE" ? value.allocatedMonday || null : null,
  };
}

/** Monday-meeting review frequency (W / F1 / F2 / M, or one-time) for the Add Task and Edit Task forms. */
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
  const nextMonth = nextMonthMondaysISO(localToday());
  const flexible = Array.from({ length: 26 }, (_, i) => addDaysISO(upcoming, 7 * i));
  const mondayChoices = value.cycle === "NEXT_MONTH" ? nextMonth : flexible;
  const allocatedKnown = !value.allocatedMonday || mondayChoices.includes(value.allocatedMonday);

  return (
    <>
      <div className="form-group">
        <label>Review Frequency</label>
        <select
          value={value.cycle}
          onChange={(e) => {
            const cycle = e.target.value as FrequencyChoice | "";
            onChange({
              ...value,
              cycle,
              allocatedMonday:
                cycle === "NEXT_MONTH"
                  ? nextMonth.includes(value.allocatedMonday ?? "") ? value.allocatedMonday : nextMonth[0]
                  : cycle === "FLEXIBLE"
                    ? value.allocatedMonday && value.allocatedMonday >= upcoming ? value.allocatedMonday : upcoming
                    : value.allocatedMonday,
            });
          }}
        >
          <option value="">Not assigned</option>
          <optgroup label="Repeating">
            {REPEATING_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="One-time">
            {ONE_TIME_CYCLES.map((c) => (
              <option key={c} value={c}>
                {ONE_TIME_LABEL[c]}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="form-hint">
          {value.cycle
            ? isOneTime(value.cycle)
              ? ONE_TIME_HINT[value.cycle]
              : REPEATING_CHOICES.find((c) => c.value === value.cycle)?.hint
            : "How often this task is reviewed at the Monday meeting."}
          {nextDiscussionDate ? ` Next scheduled discussion: ${fmtDay(nextDiscussionDate)}.` : ""}
        </span>
      </div>

      {value.cycle === "NEXT_MONDAY" && (
        <div className="form-group">
          <label>Allocated Monday</label>
          <input value={fmtMonday(upcoming)} readOnly />
          <span className="form-hint">To pick another Monday, choose Flexible Date.</span>
        </div>
      )}

      {(value.cycle === "NEXT_MONTH" || value.cycle === "FLEXIBLE") && (
        <div className="form-group">
          <label>Allocated Monday</label>
          <select
            value={value.allocatedMonday || mondayChoices[0]}
            onChange={(e) => onChange({ ...value, allocatedMonday: e.target.value })}
          >
            {!allocatedKnown && <option value={value.allocatedMonday}>Current: {fmtDay(value.allocatedMonday)}</option>}
            {mondayChoices.map((d) => (
              <option key={d} value={d}>
                {fmtMonday(d)}
              </option>
            ))}
          </select>
          <span className="form-hint">
            The Monday this task is discussed. This is not the Execution Date (TDC).
          </span>
        </div>
      )}

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

      {(value.cycle === "F1" || value.cycle === "F2") && (
        <div className="form-group">
          <label>Allocated Mondays</label>
          <input value={value.cycle === "F1" ? "1st and 3rd Monday of every month" : "2nd and 4th Monday of every month"} readOnly />
          <span className="form-hint">Allocated automatically. A month&apos;s 5th Monday has no F1 / F2 tasks.</span>
        </div>
      )}
    </>
  );
}
