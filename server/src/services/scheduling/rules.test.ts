import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, mondayOnOrAfter, nthMondayOfMonth, todayISO } from "./dates";
import {
  allocatedMonday,
  buildAgenda,
  isDueOn,
  mondayPosition,
  nextDueDate,
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
    fortnightAnchor: null,
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
    ...(patch.fortnightAnchor !== undefined && { fortnightAnchor: patch.fortnightAnchor }),
  };
}

/** Mondays from `from` to `to` (inclusive) on which the task is due. */
function dueMondays(t: SchedulableTask, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = mondayOnOrAfter(from); d <= to; d = addDays(d, 7)) if (isDueOn(t, d)) out.push(d);
  return out;
}

const agendaIds = (date: string, tasks: SchedulableTask[], existingItems: ExistingAgendaItem[] = []) =>
  buildAgenda({ meetingDate: date, tasks, existingItems }).entries.map((e) => e.taskId);

describe("dates", () => {
  test("Monday helpers and positions", () => {
    assert.equal(mondayOnOrAfter("2026-10-30"), "2026-11-02");
    assert.equal(nthMondayOfMonth(2026, 11, 5), "2026-11-30", "November 2026 has five Mondays");
    assert.equal(nthMondayOfMonth(2026, 12, 5), "2026-12-28", "December 2026 has four: 5th -> last");
    assert.equal(mondayPosition("2026-11-09"), 2);
    assert.equal(mondayPosition("2026-11-30"), 5);
  });

  test("'today' is read in the meeting time zone", () => {
    const instant = new Date("2026-10-25T20:00:00Z"); // 01:30 Monday in India
    assert.equal(todayISO("Asia/Kolkata", instant), "2026-10-26");
  });
});

describe("W - weekly", () => {
  test("every Monday, never another day", () => {
    const t = task({ frequency: "WEEKLY" });
    assert.deepEqual(dueMondays(t, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    assert.equal(isDueOn(t, "2026-11-03"), false);
    assert.equal(allocatedMonday(t, "2026-11-01"), "Every Monday");
  });
});

describe("FT - fortnightly", () => {
  const ft = () => task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-10-26" });

  test("alternate Mondays only, across month and year boundaries", () => {
    assert.deepEqual(dueMondays(ft(), "2026-10-26", "2027-01-31"), [
      "2026-10-26", "2026-11-09", "2026-11-23", "2026-12-07", "2026-12-21", "2027-01-04", "2027-01-18",
    ]);
  });

  test("the other alternate week is a separate set of Mondays", () => {
    const b = task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-02" });
    assert.deepEqual(dueMondays(b, "2026-10-26", "2026-11-30"), ["2026-11-02", "2026-11-16", "2026-11-30"]);
  });

  test("allocated Monday shows where the next review falls", () => {
    assert.equal(allocatedMonday(ft(), "2026-10-30"), "2nd Monday · alternate weeks");
    assert.equal(nextDueDate(ft(), "2026-10-30"), "2026-11-09");
  });

  test("works across a leap day", () => {
    const t = task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2028-02-21" });
    assert.deepEqual(dueMondays(t, "2028-02-01", "2028-03-31"), ["2028-02-07", "2028-02-21", "2028-03-06", "2028-03-20"]);
  });
});

describe("M - monthly", () => {
  test("its allocated Monday of every month", () => {
    const t = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 3 });
    assert.deepEqual(dueMondays(t, "2026-11-01", "2027-01-31"), ["2026-11-16", "2026-12-21", "2027-01-18"]);
    assert.equal(allocatedMonday(t, "2026-11-01"), "3rd Monday");
  });

  test("5th Monday: used in five-Monday months, last Monday otherwise", () => {
    const t = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 5 });
    assert.deepEqual(dueMondays(t, "2026-11-01", "2027-01-31"), ["2026-11-30", "2026-12-28", "2027-01-25"]);
  });

  test("leap-year February with five Mondays", () => {
    const t = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 5 });
    assert.deepEqual(dueMondays(t, "2016-02-01", "2016-02-29"), ["2016-02-29"]);
    assert.deepEqual(dueMondays(t, "2017-02-01", "2017-02-28"), ["2017-02-27"]);
  });

  test("no allocated Monday means the 1st", () => {
    const t = task({ frequency: "MONTHLY", monthlyMondayOrdinal: null });
    assert.deepEqual(dueMondays(t, "2026-11-01", "2026-11-30"), ["2026-11-02"]);
  });
});

describe("agenda for a Monday", () => {
  test("only due tasks; several tasks on the same Monday all appear, each once", () => {
    const w = task({ frequency: "WEEKLY" });
    const ftA = task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-02" });
    const ftB = task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-09" });
    const m1 = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    const m1b = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    const m3 = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 3 });
    const all = [w, ftA, ftB, m1, m1b, m3];
    assert.deepEqual(agendaIds("2026-11-02", all).sort(), [w.id, ftA.id, m1.id, m1b.id].sort());
    assert.deepEqual(agendaIds("2026-11-09", all).sort(), [w.id, ftB.id].sort());
    assert.deepEqual(agendaIds("2026-11-16", all).sort(), [w.id, ftA.id, m3.id].sort());
  });

  test("a task appears once even when several conditions match", () => {
    const t = task({ frequency: "WEEKLY", scheduleState: "BROUGHT_FORWARD", nextDiscussionDate: "2026-11-02", originalDiscussionDate: "2026-11-09" });
    const stored: ExistingAgendaItem = { taskId: t.id, section: "WEEKLY", inclusion: "DUE", reason: "x", outcome: "PENDING" };
    assert.deepEqual(agendaIds("2026-11-02", [t, t], [stored, { ...stored }]), [t.id]);
  });

  test("completed, deleted and unassigned tasks never appear", () => {
    const tasks = [
      task({ status: "COMPLETED" }),
      task({ deleted: true }),
      task({ frequency: null }),
      task({ scheduleState: "CANCELLED" }),
    ];
    assert.deepEqual(agendaIds("2026-11-02", tasks), []);
  });

  test("not discussed does not carry over to later Mondays", () => {
    const m = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    assert.deepEqual(agendaIds("2026-11-02", [m]), [m.id]);
    for (const d of ["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]) assert.deepEqual(agendaIds(d, [m]), [], d);
  });

  test("regenerating gives the same result and keeps recorded outcomes", () => {
    const tasks = [task(), task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 })];
    const first = buildAgenda({ meetingDate: "2026-11-02", tasks, existingItems: [] });
    const stored = first.entries.map(({ locked: _l, ...e }) => e);
    assert.deepEqual(buildAgenda({ meetingDate: "2026-11-02", tasks, existingItems: stored }).entries, first.entries);
    const discussed = buildAgenda({
      meetingDate: "2026-11-02",
      tasks,
      existingItems: [{ ...stored[0], outcome: "DISCUSSED" }],
    });
    assert.equal(discussed.entries.length, 2);
    assert.equal(discussed.entries.find((e) => e.taskId === stored[0].taskId)!.locked, true);
  });
});

describe("discussing does not change the calendar", () => {
  test("a fortnightly task stays on its alternate weeks", () => {
    let t = task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-02" });
    t = apply(t, planDiscussed(t, "2026-11-02"));
    assert.equal(t.lastDiscussedAt, "2026-11-02");
    assert.deepEqual(dueMondays(t, "2026-11-03", "2026-11-30"), ["2026-11-16", "2026-11-30"]);
  });
});

describe("changing the review frequency", () => {
  const today = "2026-10-30"; // a Friday; next Monday is 2 Nov

  test("W -> FT starts on the coming Monday unless a start is chosen", () => {
    const w = task({ frequency: "WEEKLY" });
    const ft = apply(w, planCycleChange(w, "FORTNIGHTLY", {}, today));
    assert.equal(ft.fortnightAnchor, "2026-11-02");
    assert.deepEqual(dueMondays(ft, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-16", "2026-11-30"]);
    const ft2 = apply(w, planCycleChange(w, "FORTNIGHTLY", { fortnightAnchor: "2026-11-09" }, today));
    assert.deepEqual(dueMondays(ft2, "2026-11-01", "2026-11-30"), ["2026-11-09", "2026-11-23"]);
  });

  test("W -> M -> W", () => {
    const w = task({ frequency: "WEEKLY" });
    const m = apply(w, planCycleChange(w, "MONTHLY", { monthlyMondayOrdinal: 2 }, today));
    assert.deepEqual(dueMondays(m, "2026-11-01", "2026-11-30"), ["2026-11-09"]);
    const back = apply(m, planCycleChange(m, "WEEKLY", {}, today));
    assert.equal(back.monthlyMondayOrdinal, null);
    assert.equal(dueMondays(back, "2026-11-01", "2026-11-30").length, 5);
  });

  test("changing the allocated Monday moves future dates", () => {
    const m = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    const m4 = apply(m, planCycleChange(m, "MONTHLY", { monthlyMondayOrdinal: 4 }, today));
    assert.deepEqual(dueMondays(m4, "2026-11-01", "2026-11-30"), ["2026-11-23"]);
  });

  test("a change clears any reschedule; FT start must be a Monday", () => {
    const t = task({ scheduleState: "DEFERRED", nextDiscussionDate: "2026-11-16", originalDiscussionDate: "2026-11-09" });
    const p = planCycleChange(t, "MONTHLY", {}, today);
    assert.equal(p.scheduleState, "SCHEDULED");
    assert.equal(p.nextDiscussionDate, null);
    assert.throws(() => planCycleChange(t, "FORTNIGHTLY", { fortnightAnchor: "2026-11-03" }, today), SchedulingError);
  });

  test("clearing the frequency takes the task off every agenda", () => {
    const t = apply(task(), planCycleChange(task(), null, {}, today));
    assert.equal(t.frequency, null);
    assert.deepEqual(dueMondays(t, "2026-11-01", "2026-12-31"), []);
  });
});

describe("rescheduling one date", () => {
  const today = "2026-10-30";

  test("moved later: on the new Monday, not the original; the rest of the calendar unchanged", () => {
    let m = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    m = apply(m, planReschedule(m, "2026-11-09", "awaiting report", today));
    assert.equal(m.originalDiscussionDate, "2026-11-02");
    assert.deepEqual(dueMondays(m, "2026-11-01", "2027-01-31"), ["2026-11-09", "2026-12-07", "2027-01-04"]);
    assert.equal(m.frequency, "MONTHLY");
  });

  test("brought forward, then discussed: the next regular date still applies", () => {
    let m = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 3 });
    m = apply(m, planReschedule(m, "2026-11-02", "urgent", today));
    assert.equal(m.scheduleState, "BROUGHT_FORWARD");
    assert.deepEqual(dueMondays(m, "2026-11-01", "2026-11-30"), ["2026-11-02"]);
    m = apply(m, planDiscussed(m, "2026-11-02"));
    assert.equal(m.scheduleState, "SCHEDULED");
    assert.deepEqual(dueMondays(m, "2026-11-03", "2026-12-31"), ["2026-11-16", "2026-12-21"]);
  });

  test("moving back to the regular Monday cancels the reschedule", () => {
    let m = task({ frequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    m = apply(m, planReschedule(m, "2026-11-09", "", today));
    m = apply(m, planReschedule(m, "2026-11-02", "", today));
    assert.equal(m.scheduleState, "SCHEDULED");
    assert.deepEqual(dueMondays(m, "2026-11-01", "2026-11-30"), ["2026-11-02"]);
  });

  test("cannot double-book a Monday the task is already on, or pick a past or non-Monday date", () => {
    const w = task({ frequency: "WEEKLY" });
    assert.throws(() => planReschedule(w, "2026-11-16", "", today), (e: unknown) => e instanceof SchedulingError && e.code === "UNCHANGED");
    assert.throws(() => planReschedule(w, "2026-10-26", "", today), SchedulingError);
    assert.throws(() => planReschedule(w, "2026-11-10", "", today), SchedulingError);
    assert.throws(() => planReschedule(task({ status: "COMPLETED" }), "2026-11-02", "", today), SchedulingError);
  });
});

describe("new tasks", () => {
  test("are never on a Monday before they were created", () => {
    const created = task({ frequency: "WEEKLY", createdOn: "2026-11-04" }); // a Wednesday
    assert.equal(isDueOn(created, "2026-11-02"), false);
    assert.equal(isDueOn(created, "2026-11-09"), true);
    assert.equal(nextDueDate(created, "2026-11-01"), "2026-11-09");
  });

  test("created on a Monday: on that Monday's agenda", () => {
    const created = task({ frequency: "WEEKLY", createdOn: "2026-11-02" });
    assert.equal(isDueOn(created, "2026-11-02"), true);
  });
});
