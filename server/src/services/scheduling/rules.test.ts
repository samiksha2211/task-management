import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultSchedulingConfig, type SchedulingConfig } from "./config";
import {
  addDays,
  isMonday,
  mondayOnOrAfter,
  nthMondayOfMonth,
  todayISO,
} from "./dates";
import {
  buildAgenda,
  initialDiscussionDate,
  nextDateAfterDiscussion,
  planBringForward,
  planDefer,
  planDiscussed,
  planFrequencyChange,
  planInitialization,
  planPinnedDate,
  proposeReview,
  recommendDeferrals,
  SchedulingError,
  summarizeLoad,
  type ExistingAgendaItem,
  type SchedulableTask,
  type SchedulePatch,
} from "./rules";

const config: SchedulingConfig = { ...defaultSchedulingConfig, defaultDiscussionMinutes: 3 };

let seq = 0;
function task(overrides: Partial<SchedulableTask> = {}): SchedulableTask {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    status: "PENDING",
    deleted: false,
    createdOn: "2026-09-01",
    dueDate: "2027-06-30",
    frequency: "M",
    monthlyMondayOrdinal: null,
    lastDiscussedAt: null,
    nextDiscussionDate: null,
    originalDiscussionDate: null,
    scheduleState: "SCHEDULED",
    scheduleReason: null,
    priority: null,
    isBlocked: false,
    flaggedForReview: false,
    estimatedMinutes: null,
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

function agendaIds(meetingDate: string, tasks: SchedulableTask[], existingItems: ExistingAgendaItem[] = []) {
  return buildAgenda({ meetingDate, tasks, existingItems, config }).entries.map((e) => e.taskId);
}

describe("date utilities", () => {
  test("Monday helpers", () => {
    assert.equal(mondayOnOrAfter("2026-10-21"), "2026-10-26");
    assert.equal(mondayOnOrAfter("2026-10-26"), "2026-10-26");
    assert.equal(nthMondayOfMonth(2026, 11, 1), "2026-11-02");
    assert.equal(nthMondayOfMonth(2026, 11, 3), "2026-11-16");
    assert.equal(nthMondayOfMonth(2026, 11, -1), "2026-11-30");
    // November 2026 has five Mondays; February 2027 has four, so a 5th falls back to the last.
    assert.equal(nthMondayOfMonth(2027, 2, 5), "2027-02-22");
  });

  test("today is read in the meeting time zone, not UTC", () => {
    // 20:00 UTC on Sunday 25 Oct is 01:30 on Monday 26 Oct in India.
    const instant = new Date("2026-10-25T20:00:00Z");
    assert.equal(todayISO("Asia/Kolkata", instant), "2026-10-26");
    assert.equal(todayISO("UTC", instant), "2026-10-25");
  });
});

describe("frequency rules", () => {
  test("weekly task is scheduled for consecutive Mondays", () => {
    let t = task({ frequency: "M", nextDiscussionDate: "2026-10-19" });
    const dates: string[] = [];
    for (let meeting = "2026-10-19"; meeting <= "2026-11-09"; meeting = addDays(meeting, 7)) {
      assert.deepEqual(agendaIds(meeting, [t]), [t.id]);
      t = apply(t, planDiscussed(t, meeting));
      dates.push(t.nextDiscussionDate!);
    }
    assert.deepEqual(dates, ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  test("fortnightly task discussed Mon 19 Oct 2026 is next due Mon 2 Nov 2026", () => {
    assert.equal(nextDateAfterDiscussion("F", "2026-10-19"), "2026-11-02");
    const t = apply(task({ frequency: "F" }), planDiscussed(task({ frequency: "F" }), "2026-10-19"));
    assert.equal(t.nextDiscussionDate, "2026-11-02");
    assert.deepEqual(agendaIds("2026-10-26", [t]), [], "not on the intervening Monday");
    assert.deepEqual(agendaIds("2026-11-02", [t]), [t.id]);
  });

  test("fortnightly result is always a Monday, even after a non-Monday meeting", () => {
    assert.equal(nextDateAfterDiscussion("F", "2026-10-20"), "2026-11-09");
    assert.ok(isMonday(nextDateAfterDiscussion("F", "2026-10-20")));
  });

  test("monthly task goes to the designated Monday of the following month", () => {
    assert.equal(nextDateAfterDiscussion("NM", "2026-10-19"), "2026-11-02");
    assert.equal(nextDateAfterDiscussion("NM", "2026-10-19", 3), "2026-11-16");
    assert.equal(nextDateAfterDiscussion("NM", "2026-10-19", -1), "2026-11-30");
  });

  test("month and year boundaries", () => {
    assert.equal(nextDateAfterDiscussion("M", "2026-12-28"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("F", "2026-12-21"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("NM", "2026-12-07"), "2027-01-04");
    assert.equal(nextDateAfterDiscussion("NM", "2026-11-30"), "2026-12-07");
  });

  test("leap years", () => {
    assert.equal(nextDateAfterDiscussion("F", "2028-02-21"), "2028-03-06");
    assert.equal(nextDateAfterDiscussion("M", "2028-02-28"), "2028-03-06");
    assert.equal(nextDateAfterDiscussion("NM", "2028-01-31"), "2028-02-07");
  });
});

describe("new tasks", () => {
  const wednesday = "2026-10-21";

  test("a new weekly task created on Wednesday goes to the upcoming Monday", () => {
    assert.equal(initialDiscussionDate({ frequency: "M", today: wednesday }).date, "2026-10-26");
  });

  test("a new task that can wait is not put on the next meeting", () => {
    assert.equal(initialDiscussionDate({ frequency: "F", today: wednesday }).date, "2026-11-02");
    assert.equal(initialDiscussionDate({ frequency: "NM", today: wednesday }).date, "2026-11-02");
    assert.equal(
      initialDiscussionDate({ frequency: "NM", today: wednesday, monthlyMondayOrdinal: 3 }).date,
      "2026-11-16"
    );
  });

  test("priority, blocking and a near deadline bring a new task to the next meeting", () => {
    assert.equal(initialDiscussionDate({ frequency: "NM", today: wednesday, priority: "High" }).date, "2026-10-26");
    assert.equal(initialDiscussionDate({ frequency: "F", today: wednesday, isBlocked: true }).date, "2026-10-26");
    assert.equal(
      initialDiscussionDate({ frequency: "F", today: wednesday, dueDate: "2026-10-30" }).date,
      "2026-10-26"
    );
  });

  test("a deadline before the regular slot moves the discussion to the Monday before it", () => {
    const r = initialDiscussionDate({
      frequency: "NM",
      today: wednesday,
      monthlyMondayOrdinal: 3,
      dueDate: "2026-11-11",
    });
    assert.equal(r.date, "2026-11-09");
  });

  test("a new task appears once, in the 'new' section", () => {
    const { date } = initialDiscussionDate({ frequency: "M", today: wednesday });
    const t = task({ createdOn: wednesday, nextDiscussionDate: date });
    const result = buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [], config });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].section, "NEW");
  });
});

describe("legacy tasks with no last-discussed date", () => {
  test("initialization never leaves a task unscheduled and spreads fortnightly ones", () => {
    const tasks = [1, 2, 3, 4].map(() => task({ frequency: null }));
    const plans = planInitialization(tasks, "F", "2026-10-24");
    const dates = tasks.map((t) => plans.get(t.id)!.nextDiscussionDate);
    assert.deepEqual(dates.sort(), ["2026-10-26", "2026-10-26", "2026-11-02", "2026-11-02"]);
  });

  test("initialization skips tasks that already have a frequency or are completed", () => {
    const scheduled = task({ frequency: "M", nextDiscussionDate: "2026-10-26" });
    const completed = task({ frequency: null, status: "COMPLETED" });
    assert.equal(planInitialization([scheduled, completed], "M", "2026-10-24").size, 0);
  });

  test("a task with no frequency is not scheduled again after discussion", () => {
    const patch = planDiscussed(task({ frequency: null }), "2026-10-26");
    assert.equal(patch.lastDiscussedAt, "2026-10-26");
    assert.equal(patch.nextDiscussionDate, null);
  });

  test("a task with no frequency never appears on its own", () => {
    assert.deepEqual(agendaIds("2026-10-26", [task({ frequency: null })]), []);
  });
});

describe("urgent changes", () => {
  test("an urgent monthly task is brought forward without changing its frequency", () => {
    let t = task({ frequency: "NM", lastDiscussedAt: "2026-11-02", nextDiscussionDate: "2026-12-07" });
    const patch = planBringForward(t, { toDate: "2026-11-09", reason: "Signal failure in PDF", today: "2026-11-05" });
    assert.equal(patch.discussionFrequency, undefined, "frequency is not part of the patch");
    t = apply(t, patch);
    assert.equal(t.frequency, "NM");
    assert.equal(t.originalDiscussionDate, "2026-12-07");
    assert.match(t.scheduleReason!, /Signal failure/);

    const agenda = buildAgenda({ meetingDate: "2026-11-09", tasks: [t], existingItems: [], config });
    assert.equal(agenda.entries[0].section, "URGENT");
    assert.equal(agenda.entries[0].inclusion, "BROUGHT_FORWARD");

    t = apply(t, planDiscussed(t, "2026-11-09"));
    assert.equal(t.frequency, "NM");
    assert.equal(t.nextDiscussionDate, "2026-12-07");
    assert.equal(t.scheduleState, "SCHEDULED");
  });

  test("bringing forward to a date that is not earlier is rejected", () => {
    const t = task({ nextDiscussionDate: "2026-10-26" });
    assert.throws(
      () => planBringForward(t, { toDate: "2026-11-02", reason: "x", today: "2026-10-24" }),
      SchedulingError
    );
  });

  test("a PDF review proposes, but does not apply, a bring-forward", () => {
    const t = task({ frequency: "NM", nextDiscussionDate: "2026-12-07" });
    const p = proposeReview(t, { priority: "Urgent" }, "2026-11-09");
    assert.equal(p.action, "BRING_FORWARD");
    assert.equal(p.toDate, "2026-11-09");
    assert.equal(t.nextDiscussionDate, "2026-12-07");
    assert.equal(proposeReview(t, { flaggedForReview: true }, "2026-11-09").action, "KEEP");
  });
});

describe("discussion tracking", () => {
  test("appearing on an agenda does not mark a task as discussed", () => {
    const t = task({ frequency: "F", nextDiscussionDate: "2026-10-26", lastDiscussedAt: "2026-10-12" });
    const before = structuredClone(t);
    buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [], config });
    assert.deepEqual(t, before);
  });

  test("a task that was not discussed carries over to the next meeting", () => {
    const t = task({ frequency: "F", nextDiscussionDate: "2026-10-26", lastDiscussedAt: "2026-10-12" });
    const result = buildAgenda({ meetingDate: "2026-11-02", tasks: [t], existingItems: [], config });
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0].reason, /Carried over/);
  });

  test("an agreed (pinned) date is preserved after an earlier discussion", () => {
    let t = task({ frequency: "NM" });
    t = apply(t, planPinnedDate(t, "2026-11-16", "agreed with Sr.DEN"));
    t = apply(t, planDiscussed(t, "2026-11-02"));
    assert.equal(t.nextDiscussionDate, "2026-11-16");
    assert.equal(t.scheduleState, "PINNED");
  });
});

describe("completion and cancellation", () => {
  test("a completed task never appears, even with a manual agenda item", () => {
    const t = task({ status: "COMPLETED", nextDiscussionDate: "2026-10-26" });
    const manual: ExistingAgendaItem = {
      taskId: t.id,
      section: "WEEKLY",
      inclusion: "MANUAL",
      reason: "added",
      estimatedMinutes: 3,
      outcome: "PENDING",
    };
    const result = buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [manual], config });
    assert.deepEqual(result.entries, []);
    assert.equal(result.dropped.length, 1);
    for (let m = "2026-11-02"; m <= "2027-01-25"; m = addDays(m, 7)) assert.deepEqual(agendaIds(m, [t]), []);
  });

  test("a cancelled or deleted task is excluded", () => {
    assert.deepEqual(agendaIds("2026-10-26", [task({ scheduleState: "CANCELLED", nextDiscussionDate: "2026-10-26" })]), []);
    assert.deepEqual(agendaIds("2026-10-26", [task({ deleted: true, nextDiscussionDate: "2026-10-26" })]), []);
  });
});

describe("deferrals", () => {
  test("a deferred task appears on its revised date and not on intervening Mondays", () => {
    let t = task({ frequency: "F", nextDiscussionDate: "2026-10-26", lastDiscussedAt: "2026-10-12" });
    t = apply(t, planDefer(t, { toDate: "2026-11-09", reason: "Meeting overloaded", fromDate: "2026-10-26" }));
    assert.equal(t.frequency, "F");
    assert.equal(t.originalDiscussionDate, "2026-10-26");
    assert.deepEqual(agendaIds("2026-10-26", [t]), []);
    assert.deepEqual(agendaIds("2026-11-02", [t]), []);
    const result = buildAgenda({ meetingDate: "2026-11-09", tasks: [t], existingItems: [], config });
    assert.deepEqual(result.entries.map((e) => e.taskId), [t.id]);
    assert.match(result.entries[0].reason, /Deferred from 26 Oct 2026/);
  });

  test("repeated deferrals keep the first original date", () => {
    let t = task({ nextDiscussionDate: "2026-10-26" });
    t = apply(t, planDefer(t, { toDate: "2026-11-02", reason: "a", fromDate: "2026-10-26" }));
    t = apply(t, planDefer(t, { toDate: "2026-11-09", reason: "b", fromDate: "2026-11-02" }));
    assert.equal(t.originalDiscussionDate, "2026-10-26");
  });

  test("urgent or overdue tasks need explicit confirmation to defer", () => {
    const urgent = task({ priority: "URGENT", nextDiscussionDate: "2026-10-26" });
    const overdue = task({ dueDate: "2026-10-01", nextDiscussionDate: "2026-10-26" });
    for (const t of [urgent, overdue]) {
      assert.throws(
        () => planDefer(t, { toDate: "2026-11-02", reason: "x", fromDate: "2026-10-26" }),
        (e: unknown) => e instanceof SchedulingError && e.code === "CONFIRMATION_REQUIRED"
      );
      const ok = planDefer(t, { toDate: "2026-11-02", reason: "x", fromDate: "2026-10-26", confirmed: true });
      assert.equal(ok.nextDiscussionDate, "2026-11-02");
    }
  });

  test("deferral must be to a later Monday", () => {
    const t = task({ nextDiscussionDate: "2026-10-26" });
    assert.throws(() => planDefer(t, { toDate: "2026-11-03", reason: "x", fromDate: "2026-10-26" }), SchedulingError);
    assert.throws(() => planDefer(t, { toDate: "2026-10-19", reason: "x", fromDate: "2026-10-26" }), SchedulingError);
  });
});

describe("duplicates and regeneration", () => {
  test("the same task cannot appear twice in one meeting", () => {
    const t = task({ priority: "URGENT", nextDiscussionDate: "2026-10-26", scheduleState: "BROUGHT_FORWARD" });
    const manual: ExistingAgendaItem = {
      taskId: t.id,
      section: "URGENT",
      inclusion: "MANUAL",
      reason: "added by hand",
      estimatedMinutes: 3,
      outcome: "PENDING",
    };
    assert.deepEqual(agendaIds("2026-10-26", [t], [manual, { ...manual }]), [t.id]);
  });

  test("regenerating an agenda gives the same entries", () => {
    const tasks = [
      task({ nextDiscussionDate: "2026-10-26" }),
      task({ frequency: "F", nextDiscussionDate: "2026-10-19" }),
      task({ frequency: "NM", nextDiscussionDate: "2026-11-02" }),
    ];
    const first = buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: [], config });
    const stored: ExistingAgendaItem[] = first.entries.map(({ locked: _l, ...e }) => e);
    const second = buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: stored, config });
    assert.deepEqual(second.entries, first.entries);
    assert.deepEqual(second.dropped, []);
  });

  test("recorded outcomes are kept as history when the agenda is regenerated", () => {
    const t = apply(task({ nextDiscussionDate: "2026-10-26" }), planDiscussed(task(), "2026-10-26"));
    const discussed: ExistingAgendaItem = {
      taskId: t.id,
      section: "WEEKLY",
      inclusion: "DUE",
      reason: "Weekly discussion due",
      estimatedMinutes: 3,
      outcome: "DISCUSSED",
    };
    const result = buildAgenda({ meetingDate: "2026-10-26", tasks: [t], existingItems: [discussed], config });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].locked, true);
  });
});

describe("meeting load", () => {
  test("an overloaded meeting recommends deferrals without moving anything", () => {
    const urgent = task({ priority: "URGENT", nextDiscussionDate: "2026-10-26" });
    const low = task({ priority: "Low", frequency: "M", nextDiscussionDate: "2026-10-26", estimatedMinutes: 10 });
    const monthly = task({ frequency: "NM", nextDiscussionDate: "2026-10-26", estimatedMinutes: 10 });
    const weekly = Array.from({ length: 30 }, () => task({ frequency: "M", nextDiscussionDate: "2026-10-26" }));
    const tasks = [urgent, low, monthly, ...weekly];
    const { entries } = buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: [], config });

    const load = summarizeLoad(entries, 90);
    assert.equal(load.totalMinutes, 3 + 10 + 10 + 90);
    assert.equal(load.overloaded, true);

    const recs = recommendDeferrals({ entries, tasks, meetingDate: "2026-10-26", limitMinutes: 90, config });
    const ids = recs.map((r) => r.taskId);
    assert.equal(ids[0], low.id, "lowest priority first");
    assert.ok(!ids.includes(urgent.id), "urgent tasks are never suggested");
    assert.ok(!ids.includes(monthly.id), "monthly tasks are suggested after weekly ones");
    assert.ok(recs.reduce((s, r) => s + r.minutes, 0) >= load.overBy);
    assert.ok(recs.every((r) => r.suggestedDate === "2026-11-02"));
    assert.ok(entries.every((e) => e.outcome === "PENDING"), "nothing was moved");
  });

  test("no recommendations when the agenda fits", () => {
    const tasks = [task({ nextDiscussionDate: "2026-10-26" })];
    const { entries } = buildAgenda({ meetingDate: "2026-10-26", tasks, existingItems: [], config });
    assert.deepEqual(recommendDeferrals({ entries, tasks, meetingDate: "2026-10-26", limitMinutes: 90, config }), []);
  });
});

describe("frequency changes", () => {
  test("changing frequency recalculates from the last discussion", () => {
    const t = task({ frequency: "M", lastDiscussedAt: "2026-10-19", nextDiscussionDate: "2026-10-26" });
    assert.equal(planFrequencyChange(t, "F", null, "2026-10-21").nextDiscussionDate, "2026-11-02");
    assert.equal(planFrequencyChange(t, "NM", 3, "2026-10-21").nextDiscussionDate, "2026-11-16");
  });

  test("a cycle that already fell due moves to the upcoming Monday, never into the past", () => {
    const t = task({ frequency: "NM", lastDiscussedAt: "2026-08-03", nextDiscussionDate: "2026-09-07" });
    assert.equal(planFrequencyChange(t, "F", null, "2026-10-21").nextDiscussionDate, "2026-10-26");
  });

  test("a deferred date is kept unless recalculation is requested", () => {
    const t = task({
      frequency: "M",
      lastDiscussedAt: "2026-10-19",
      nextDiscussionDate: "2026-11-16",
      scheduleState: "DEFERRED",
    });
    assert.equal(planFrequencyChange(t, "F", null, "2026-10-21").nextDiscussionDate, "2026-11-16");
    assert.equal(planFrequencyChange(t, "F", null, "2026-10-21", true).nextDiscussionDate, "2026-11-02");
  });

  test("clearing the frequency takes the task off the schedule", () => {
    const patch = planFrequencyChange(task({ nextDiscussionDate: "2026-10-26" }), null, null, "2026-10-21");
    assert.equal(patch.nextDiscussionDate, null);
    assert.equal(patch.discussionFrequency, null);
  });
});
