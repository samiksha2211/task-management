import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, isMonday, mondayOnOrAfter, nthMondayOfMonth, todayISO } from "./dates";
import {
  buildAgenda,
  initialDiscussionDate,
  nextDateAfterDiscussion,
  planCycleChange,
  planDiscussed,
  planReschedule,
  SchedulingError,
  type ExistingAgendaItem,
  type SchedulableTask,
  type SchedulePatch,
} from "./rules";

let seq = 0;
function task(overrides: Partial<SchedulableTask> = {}): SchedulableTask {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    status: "PENDING",
    deleted: false,
    frequency: "WEEKLY",
    monthlyMondayOrdinal: null,
    lastDiscussedAt: null,
    nextDiscussionDate: null,
    originalDiscussionDate: null,
    scheduleState: "SCHEDULED",
    scheduleReason: null,
    ...overrides,
  };
}

function apply(t: SchedulableTask, patch: SchedulePatch): SchedulableTask {
  return {
    ...t,
    nextDiscussionDate: patch.nextDiscussionDate,
    scheduleState: patch.scheduleState,
    originalDiscussionDate: patch.originalDiscussionDate,
    scheduleReason: patch.scheduleReason,
    ...(patch.lastDiscussedAt !== undefined && { lastDiscussedAt: patch.lastDiscussedAt }),
    ...(patch.discussionFrequency !== undefined && { frequency: patch.discussionFrequency }),
    ...(patch.monthlyMondayOrdinal !== undefined && { monthlyMondayOrdinal: patch.monthlyMondayOrdinal }),
  };
}

const agendaIds = (date: string, tasks: SchedulableTask[], existingItems: ExistingAgendaItem[] = []) =>
  buildAgenda({ meetingDate: date, tasks, existingItems }).entries.map((e) => e.taskId);

describe("dates", () => {
  test("Monday helpers", () => {
    assert.equal(mondayOnOrAfter("2026-10-21"), "2026-10-26");
    assert.equal(mondayOnOrAfter("2026-10-26"), "2026-10-26");
    assert.equal(nthMondayOfMonth(2026, 11, 1), "2026-11-02");
    assert.equal(nthMondayOfMonth(2026, 11, -1), "2026-11-30");
    assert.equal(nthMondayOfMonth(2027, 2, 5), "2027-02-22", "a missing 5th Monday falls back to the last");
  });

  test("'today' is read in the meeting time zone", () => {
    const instant = new Date("2026-10-25T20:00:00Z"); // 01:30 Monday in India
    assert.equal(todayISO("Asia/Kolkata", instant), "2026-10-26");
    assert.equal(todayISO("UTC", instant), "2026-10-25");
  });
});

describe("cycles", () => {
  test("weekly: consecutive Mondays", () => {
    let t = task({ frequency: "WEEKLY", nextDiscussionDate: "2026-10-19" });
    const dates: string[] = [];
    for (let m = "2026-10-19"; m <= "2026-11-09"; m = addDays(m, 7)) {
      assert.deepEqual(agendaIds(m, [t]), [t.id]);
      t = apply(t, planDiscussed(t, m));
      dates.push(t.nextDiscussionDate!);
    }
    assert.deepEqual(dates, ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  test("fortnightly: discussed 19 Oct 2026 -> next 2 Nov 2026, not on 26 Oct", () => {
    const t = apply(task({ frequency: "FORTNIGHTLY" }), planDiscussed(task({ frequency: "FORTNIGHTLY" }), "2026-10-19"));
    assert.equal(t.nextDiscussionDate, "2026-11-02");
    assert.deepEqual(agendaIds("2026-10-26", [t]), []);
    assert.deepEqual(agendaIds("2026-11-02", [t]), [t.id]);
  });

  test("fortnightly result is always a Monday", () => {
    assert.equal(nextDateAfterDiscussion("FORTNIGHTLY", "2026-10-20"), "2026-11-09");
    assert.ok(isMonday(nextDateAfterDiscussion("FORTNIGHTLY", "2026-10-20")));
  });

  test("monthly: designated Monday of next month, first by default", () => {
    assert.equal(nextDateAfterDiscussion("MONTHLY", "2026-10-19"), "2026-11-02");
    assert.equal(nextDateAfterDiscussion("MONTHLY", "2026-10-19", 3), "2026-11-16");
    assert.equal(nextDateAfterDiscussion("MONTHLY", "2026-10-19", -1), "2026-11-30");
  });

  test("month, year and leap-year boundaries", () => {
    assert.equal(nextDateAfterDiscussion("WEEKLY", "2026-12-28"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("FORTNIGHTLY", "2026-12-21"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("MONTHLY", "2026-12-07"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("FORTNIGHTLY", "2028-02-21"), "2028-03-06");
    assert.equal(nextDateAfterDiscussion("MONTHLY", "2028-01-31"), "2028-02-07");
  });
});

describe("assigning a cycle", () => {
  const wednesday = "2026-10-21";

  test("never-discussed tasks: weekly and fortnightly start next Monday, monthly next month", () => {
    assert.equal(initialDiscussionDate({ cycle: "WEEKLY", today: wednesday }).date, "2026-10-26");
    assert.equal(initialDiscussionDate({ cycle: "FORTNIGHTLY", today: wednesday }).date, "2026-10-26");
    assert.equal(initialDiscussionDate({ cycle: "MONTHLY", today: wednesday }).date, "2026-11-02");
    assert.equal(
      initialDiscussionDate({ cycle: "MONTHLY", today: wednesday, monthlyMondayOrdinal: 3 }).date,
      "2026-11-16"
    );
  });

  test("a monthly task never lands on this week's meeting, whatever its status or deadline", () => {
    const t = apply(task({ frequency: null, status: "PENDING" }), planCycleChange(task(), "MONTHLY", null, "2026-10-26"));
    assert.equal(t.nextDiscussionDate, "2026-11-02");
    assert.deepEqual(agendaIds("2026-10-26", [t]), []);
  });

  test("changing cycle counts from the last discussion", () => {
    const t = task({ frequency: "WEEKLY", lastDiscussedAt: "2026-10-19", nextDiscussionDate: "2026-10-26" });
    assert.equal(planCycleChange(t, "FORTNIGHTLY", null, wednesday).nextDiscussionDate, "2026-11-02");
    assert.equal(planCycleChange(t, "MONTHLY", 3, wednesday).nextDiscussionDate, "2026-11-16");
  });

  test("a cycle that already fell due goes to the upcoming Monday, never the past", () => {
    const t = task({ frequency: "MONTHLY", lastDiscussedAt: "2026-08-03" });
    assert.equal(planCycleChange(t, "FORTNIGHTLY", null, wednesday).nextDiscussionDate, "2026-10-26");
  });

  test("changing cycle replaces a rescheduled date and keeps nothing stale", () => {
    const t = task({ nextDiscussionDate: "2026-12-07", scheduleState: "DEFERRED", originalDiscussionDate: "2026-10-26" });
    const p = planCycleChange(t, "WEEKLY", null, wednesday);
    assert.equal(p.nextDiscussionDate, "2026-10-26");
    assert.equal(p.scheduleState, "SCHEDULED");
    assert.equal(p.originalDiscussionDate, null);
  });

  test("clearing the cycle takes the task off the schedule", () => {
    const p = planCycleChange(task({ nextDiscussionDate: "2026-10-26" }), null, null, wednesday);
    assert.equal(p.nextDiscussionDate, null);
    assert.equal(p.discussionFrequency, null);
  });
});

describe("rescheduling", () => {
  test("bring a monthly task forward without changing its cycle", () => {
    let t = task({ frequency: "MONTHLY", lastDiscussedAt: "2026-11-02", nextDiscussionDate: "2026-12-07" });
    t = apply(t, planReschedule(t, "2026-11-09", "Urgent issue", "2026-11-05"));
    assert.equal(t.frequency, "MONTHLY");
    assert.equal(t.scheduleState, "BROUGHT_FORWARD");
    assert.equal(t.originalDiscussionDate, "2026-12-07");
    assert.deepEqual(agendaIds("2026-11-09", [t]), [t.id]);
    t = apply(t, planDiscussed(t, "2026-11-09"));
    assert.equal(t.nextDiscussionDate, "2026-12-07", "normal monthly cycle resumes");
  });

  test("a task moved later appears only on its new date", () => {
    let t = task({ frequency: "FORTNIGHTLY", nextDiscussionDate: "2026-10-26" });
    t = apply(t, planReschedule(t, "2026-11-09", "", "2026-10-24"));
    assert.equal(t.scheduleState, "DEFERRED");
    assert.deepEqual(agendaIds("2026-10-26", [t]), []);
    assert.deepEqual(agendaIds("2026-11-02", [t]), []);
    assert.deepEqual(agendaIds("2026-11-09", [t]), [t.id]);
  });

  test("only future Mondays, and not the same date", () => {
    const t = task({ nextDiscussionDate: "2026-11-02" });
    assert.throws(() => planReschedule(t, "2026-11-03", "", "2026-10-24"), SchedulingError);
    assert.throws(() => planReschedule(t, "2026-10-19", "", "2026-10-24"), SchedulingError);
    assert.throws(() => planReschedule(t, "2026-11-02", "", "2026-10-24"), SchedulingError);
    assert.throws(() => planReschedule(task({ status: "COMPLETED" }), "2026-11-02", "", "2026-10-24"), SchedulingError);
  });
});

describe("agenda", () => {
  test("only actual discussion moves the schedule; undiscussed tasks carry over", () => {
    const t = task({ frequency: "FORTNIGHTLY", nextDiscussionDate: "2026-10-26" });
    const before = structuredClone(t);
    buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [] });
    assert.deepEqual(t, before);
    const next = buildAgenda({ meetingDate: "2026-11-02", tasks: [t], existingItems: [] });
    assert.match(next.entries[0].reason, /Carried over/);
  });

  test("completed, deleted and unassigned tasks are not on the agenda", () => {
    const tasks = [
      task({ status: "COMPLETED", nextDiscussionDate: "2026-10-26" }),
      task({ deleted: true, nextDiscussionDate: "2026-10-26" }),
      task({ frequency: null }),
    ];
    assert.deepEqual(agendaIds("2026-10-26", tasks), []);
  });

  test("status never changes the cycle grouping: an overdue weekly task stays weekly", () => {
    const t = task({ frequency: "WEEKLY", nextDiscussionDate: "2026-10-26", status: "OVERDUE" });
    assert.equal(buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [] }).entries[0].section, "WEEKLY");
  });

  test("a task appears once, even if it is also stored on the meeting", () => {
    const t = task({ nextDiscussionDate: "2026-10-26" });
    const stored: ExistingAgendaItem = { taskId: t.id, section: "WEEKLY", inclusion: "MANUAL", reason: "x", outcome: "PENDING" };
    assert.deepEqual(agendaIds("2026-10-26", [t], [stored, { ...stored }]), [t.id]);
  });

  test("two different tasks due the same Monday both appear", () => {
    const a = task({ nextDiscussionDate: "2026-10-26" });
    const b = task({ frequency: "MONTHLY", nextDiscussionDate: "2026-10-26" });
    assert.deepEqual(agendaIds("2026-10-26", [a, b]).sort(), [a.id, b.id].sort());
  });

  test("regenerating gives the same result; recorded outcomes are kept", () => {
    const tasks = [task({ nextDiscussionDate: "2026-10-26" }), task({ frequency: "FORTNIGHTLY", nextDiscussionDate: "2026-10-19" })];
    const first = buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: [] });
    const stored = first.entries.map(({ locked: _l, ...e }) => e);
    assert.deepEqual(buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: stored }).entries, first.entries);

    const discussed = apply(tasks[0], planDiscussed(tasks[0], "2026-10-26"));
    const history: ExistingAgendaItem = { ...stored[0], outcome: "DISCUSSED" };
    const again = buildAgenda({ meetingDate: "2026-10-26", tasks: [discussed], existingItems: [history] });
    assert.equal(again.entries.length, 1);
    assert.equal(again.entries[0].locked, true);
  });
});
