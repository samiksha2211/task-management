"use client";

import { CYCLES, CYCLE_HINT, CYCLE_LABEL, ORDINAL_OPTIONS, fmtDay, type Cycle } from "@/lib/meetings";

export interface ScheduleValue {
  cycle: Cycle | "";
  monthlyMondayOrdinal: number;
}

export const EMPTY_SCHEDULE: ScheduleValue = { cycle: "", monthlyMondayOrdinal: 1 };

/** Request-body fields for a schedule value, as the task API expects them. */
export function scheduleBody(value: ScheduleValue) {
  return {
    discussionFrequency: value.cycle || null,
    monthlyMondayOrdinal: value.cycle === "MONTHLY" ? value.monthlyMondayOrdinal : null,
  };
}

/** Monday-meeting discussion cycle field for the Add Task and Edit Task forms. */
export default function ScheduleFields({
  value,
  onChange,
  nextDiscussionDate,
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  nextDiscussionDate?: string | null;
}) {
  return (
    <>
      <div className="form-group">
        <label>Monday Meeting Cycle</label>
        <select
          value={value.cycle}
          onChange={(e) => onChange({ ...value, cycle: e.target.value as Cycle | "" })}
        >
          <option value="">Not assigned</option>
          {CYCLES.map((c) => (
            <option key={c} value={c}>
              {CYCLE_LABEL[c]}
            </option>
          ))}
        </select>
        <span className="form-hint">
          {value.cycle ? CYCLE_HINT[value.cycle] : "How often this task is discussed at the Monday meeting."}
          {nextDiscussionDate ? ` Next discussion: ${fmtDay(nextDiscussionDate)}.` : ""}
        </span>
      </div>

      {value.cycle === "MONTHLY" && (
        <div className="form-group">
          <label>Monthly Discussion Day</label>
          <select
            value={value.monthlyMondayOrdinal}
            onChange={(e) => onChange({ ...value, monthlyMondayOrdinal: Number(e.target.value) })}
          >
            {ORDINAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} of the following month
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
