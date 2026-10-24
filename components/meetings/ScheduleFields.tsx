"use client";

import {
  FREQUENCY_OPTIONS,
  ORDINAL_OPTIONS,
  PRIORITY_OPTIONS,
  fmtDay,
  type Frequency,
} from "@/lib/meetings";

export interface ScheduleValue {
  frequency: Frequency | "";
  monthlyMondayOrdinal: number;
  priority: string;
  estimatedMinutes: string;
}

export const EMPTY_SCHEDULE: ScheduleValue = {
  frequency: "",
  monthlyMondayOrdinal: 1,
  priority: "NORMAL",
  estimatedMinutes: "",
};

/** Request-body fields for a schedule value, as the task API expects them. */
export function scheduleBody(value: ScheduleValue) {
  const minutes = parseInt(value.estimatedMinutes, 10);
  return {
    priority: value.priority || null,
    discussionFrequency: value.frequency || null,
    monthlyMondayOrdinal: value.frequency === "NM" ? value.monthlyMondayOrdinal : null,
    estimatedDiscussionMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
  };
}

export default function ScheduleFields({
  value,
  onChange,
  nextDiscussionDate,
  lastDiscussedAt,
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  nextDiscussionDate?: string | null;
  lastDiscussedAt?: string | null;
}) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });
  const hint = FREQUENCY_OPTIONS.find((o) => o.value === value.frequency)?.hint;

  return (
    <>
      <div className="form-group">
        <label>Monday Meeting Frequency</label>
        <select
          value={value.frequency}
          onChange={(e) => set({ frequency: e.target.value as Frequency | "" })}
        >
          <option value="">Not on the Monday meeting</option>
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="form-hint">
          {hint ?? "Choose how often this task is discussed at the Monday meeting."}
          {nextDiscussionDate ? ` Next discussion: ${fmtDay(nextDiscussionDate)}.` : ""}
          {lastDiscussedAt ? ` Last discussed: ${fmtDay(lastDiscussedAt)}.` : ""}
        </span>
      </div>

      {value.frequency === "NM" && (
        <div className="form-group">
          <label>Monthly Discussion Day</label>
          <select
            value={value.monthlyMondayOrdinal}
            onChange={(e) => set({ monthlyMondayOrdinal: Number(e.target.value) })}
          >
            {ORDINAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} of the next month
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label>Priority</label>
        <select value={value.priority} onChange={(e) => set({ priority: e.target.value })}>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="form-hint">Urgent and high-priority tasks are discussed at the next meeting.</span>
      </div>

      <div className="form-group">
        <label>Estimated Discussion Time (Minutes)</label>
        <input
          type="number"
          min="1"
          max="240"
          placeholder="Default"
          value={value.estimatedMinutes}
          onChange={(e) => set({ estimatedMinutes: e.target.value })}
        />
        <span className="form-hint">Used to check whether the Monday agenda fits the meeting time.</span>
      </div>
    </>
  );
}
