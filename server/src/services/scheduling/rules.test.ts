import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, mondayOnOrAfter, nthMondayOfMonth, todayISO } from "./dates";
import {
  allocatedMonday,
  buildAgenda,
  fortnightGroup,
  reviewCode,
  isDueOn,
  mondayPosition,
  nextDueDate,
  planCycleChange,
  planDiscussed,
  planReschedule,
  nextMonthMondays,
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
    allocatedDate: null,
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
    ...(patch.allocatedMonday !== undefined && { allocatedDate: patch.allocatedMonday }),
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

describe("F1 / F2 - fortnightly", () => {
  const f1 = () => task({ frequency: "FORTNIGHTLY", monthlyMondayOrdinal: 1 });
  const f2 = () => task({ frequency: "FORTNIGHTLY", monthlyMondayOrdinal: 2 });

  test("F1: 1st and 3rd Monday of every month, across month and year boundaries", () => {
    assert.deepEqual(dueMondays(f1(), "2026-11-01", "2027-02-28"), [
      "2026-11-02", "2026-11-16", "2026-12-07", "2026-12-21", "2027-01-04", "2027-01-18", "2027-02-01", "2027-02-15",
    ]);
  });

  test("F2: 2nd and 4th Monday of every month", () => {
    assert.deepEqual(dueMondays(f2(), "2026-11-01", "2027-02-28"), [
      "2026-11-09", "2026-11-23", "2026-12-14", "2026-12-28", "2027-01-11", "2027-01-25", "2027-02-08", "2027-02-22",
    ]);
  });

  test("a 5th Monday has neither F1 nor F2; every month has exactly two of each", () => {
    // November 2026 and March 2027 have five Mondays (30 Nov, 29 Mar).
    for (const fifth of ["2026-11-30", "2027-03-29"]) {
      assert.equal(isDueOn(f1(), fifth), false);
      assert.equal(isDueOn(f2(), fifth), false);
    }
    for (let m = 1; m <= 24; m++) {
      const y = 2026 + Math.floor((m - 1) / 12);
      const month = String(((m - 1) % 12) + 1).padStart(2, "0");
      const end = addDays(`${y}-${month}-28`, 3).slice(0, 7) === `${y}-${month}` ? addDays(`${y}-${month}-28`, 3) : `${y}-${month}-31`;
      const inMonth = (t: SchedulableTask) => dueMondays(t, `${y}-${month}-01`, end).filter((d) => d.startsWith(`${y}-${month}`));
      assert.equal(inMonth(f1()).length, 2, `F1 in ${y}-${month}`);
      assert.equal(inMonth(f2()).length, 2, `F2 in ${y}-${month}`);
      assert.equal(new Set([...inMonth(f1()), ...inMonth(f2())]).size, 4, "F1 and F2 never share a Monday");
    }
  });

  test("works across a leap day", () => {
    assert.deepEqual(dueMondays(f1(), "2028-02-01", "2028-03-31"), ["2028-02-07", "2028-02-21", "2028-03-06", "2028-03-20"]);
  });

  test("allocated Monday and review code", () => {
    assert.equal(allocatedMonday(f1(), "2026-10-30"), "1st & 3rd Monday");
    assert.equal(allocatedMonday(f2(), "2026-10-30"), "2nd & 4th Monday");
    assert.equal(reviewCode(f1()), "F1");
    assert.equal(reviewCode(f2()), "F2");
    assert.equal(nextDueDate(f2(), "2026-11-24"), "2026-12-14", "skips the 5th Monday");
  });

  test("older FT tasks take F1 / F2 from their start Monday", () => {
    assert.equal(fortnightGroup(task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-02" })), 1); // 1st Monday
    assert.equal(fortnightGroup(task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-09" })), 2); // 2nd Monday
    assert.equal(fortnightGroup(task({ frequency: "FORTNIGHTLY", fortnightAnchor: "2026-11-16" })), 1); // 3rd Monday
    assert.equal(fortnightGroup(task({ frequency: "FORTNIGHTLY" })), 1);
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
  test("an F1 task stays on its 1st and 3rd Mondays", () => {
    let t = task({ frequency: "FORTNIGHTLY", monthlyMondayOrdinal: 1 });
    t = apply(t, planDiscussed(t, "2026-11-02"));
    assert.equal(t.lastDiscussedAt, "2026-11-02");
    assert.deepEqual(dueMondays(t, "2026-11-03", "2026-12-31"), ["2026-11-16", "2026-12-07", "2026-12-21"]);
  });
});

describe("changing the review frequency", () => {
  const today = "2026-10-30"; // a Friday; next Monday is 2 Nov

  test("W -> F1 / F2: the Mondays are allocated automatically", () => {
    const w = task({ frequency: "WEEKLY" });
    const f1 = apply(w, planCycleChange(w, "FORTNIGHTLY", { fortnightGroup: 1 }, today));
    assert.equal(f1.monthlyMondayOrdinal, 1);
    assert.equal(f1.fortnightAnchor, null);
    assert.deepEqual(dueMondays(f1, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-16"]);
    const f2 = apply(f1, planCycleChange(f1, "FORTNIGHTLY", { fortnightGroup: 2 }, today));
    assert.deepEqual(dueMondays(f2, "2026-11-01", "2026-11-30"), ["2026-11-09", "2026-11-23"]);
    const kept = apply(f2, planCycleChange(f2, "FORTNIGHTLY", {}, today));
    assert.equal(reviewCode(kept), "F2", "FORTNIGHTLY without a group keeps F1 / F2");
    const m = apply(f2, planCycleChange(f2, "MONTHLY", { monthlyMondayOrdinal: 4 }, today));
    assert.equal(m.monthlyMondayOrdinal, 4);
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

  test("a change clears any reschedule; F1 / F2 only", () => {
    const t = task({ scheduleState: "DEFERRED", nextDiscussionDate: "2026-11-16", originalDiscussionDate: "2026-11-09" });
    const p = planCycleChange(t, "MONTHLY", {}, today);
    assert.equal(p.scheduleState, "SCHEDULED");
    assert.equal(p.nextDiscussionDate, null);
    assert.throws(() => planCycleChange(t, "FORTNIGHTLY", { fortnightGroup: 3 as 1 }, today), SchedulingError);
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

describe("one-time review frequencies", () => {
  const today = "2026-11-04"; // a Wednesday
  const upcoming = "2026-11-09";

  test("Next Monday: on the coming Monday only", () => {
    const t = apply(task({ frequency: null }), planCycleChange(task(), "NEXT_MONDAY", {}, today));
    assert.equal(t.frequency, "NEXT_MONDAY");
    assert.equal(t.allocatedDate, upcoming);
    assert.deepEqual(dueMondays(t, today, "2027-02-01"), [upcoming]);
    assert.equal(allocatedMonday(t, today), "9 Nov 2026");
  });

  test("Next Month: one of next month's Mondays, chosen by the DRM", () => {
    assert.deepEqual(nextMonthMondays(today), ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
    const t = apply(task(), planCycleChange(task(), "NEXT_MONTH", { allocatedMonday: "2026-12-21" }, today));
    assert.deepEqual(dueMondays(t, today, "2027-02-01"), ["2026-12-21"]);
    const first = apply(task(), planCycleChange(task(), "NEXT_MONTH", {}, today));
    assert.equal(first.allocatedDate, "2026-12-07", "defaults to the 1st Monday of next month");
    assert.throws(() => planCycleChange(task(), "NEXT_MONTH", { allocatedMonday: upcoming }, today), SchedulingError);
  });

  test("Flexible Date: any Monday from the coming one on", () => {
    const t = apply(task(), planCycleChange(task(), "FLEXIBLE", { allocatedMonday: "2027-01-18" }, today));
    assert.deepEqual(dueMondays(t, today, "2027-03-01"), ["2027-01-18"]);
    assert.throws(() => planCycleChange(task(), "FLEXIBLE", { allocatedMonday: "2026-11-02" }, today), SchedulingError);
    assert.throws(() => planCycleChange(task(), "FLEXIBLE", { allocatedMonday: "2026-11-10" }, today), SchedulingError);
  });

  test("rescheduling a one-time task changes its allocated Monday", () => {
    const t = apply(task(), planCycleChange(task(), "NEXT_MONDAY", {}, today));
    const moved = apply(t, planReschedule(t, "2026-11-23", "", today));
    assert.equal(moved.allocatedDate, "2026-11-23");
    assert.equal(moved.frequency, "NEXT_MONDAY");
    assert.deepEqual(dueMondays(moved, today, "2027-01-01"), ["2026-11-23"]);
    assert.throws(() => planReschedule(moved, "2026-11-23", "", today), SchedulingError);
  });

  test("switching back to W clears the one-time date; completed tasks are never due", () => {
    const t = apply(task(), planCycleChange(task(), "FLEXIBLE", { allocatedMonday: "2026-11-23" }, today));
    const w = apply(t, planCycleChange(t, "WEEKLY", {}, today));
    assert.equal(w.allocatedDate, null);
    assert.equal(dueMondays(w, today, "2026-11-30").length, 4);
    assert.equal(isDueOn({ ...t, status: "COMPLETED" }, "2026-11-23"), false);
    assert.equal(isDueOn({ ...t, status: "RUNNING" }, "2026-11-23"), true, "Running tasks stay on the agenda");
  });
});
