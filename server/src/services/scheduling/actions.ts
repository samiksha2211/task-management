// Schedule-changing operations shared by the task and meeting controllers.

import type { Task } from "@prisma/client";
import type { Cycle } from "./config";
import { toISODateOrNull } from "./dates";
import { planCycleChange } from "./rules";
import { applyPatch, today, toSchedulable, type Tx } from "./repository";

/**
 * Set, change or clear a task's discussion cycle (and, for MONTHLY, which
 * Monday of the month). Does nothing if neither changed. Recorded in history.
 */
export async function setTaskCycle(
  tx: Tx,
  task: Task,
  cycle: Cycle | null,
  monthlyMondayOrdinal: number | null | undefined,
  userId: string | null
): Promise<Task> {
  const ordinal = cycle === "MONTHLY" ? (monthlyMondayOrdinal ?? task.monthlyMondayOrdinal ?? 1) : null;
  const unchanged =
    cycle === task.discussionFrequency &&
    (cycle !== "MONTHLY" || ordinal === (task.monthlyMondayOrdinal ?? 1)) &&
    (cycle === null || toISODateOrNull(task.nextDiscussionDate) !== null);
  if (unchanged) return task;

  const patch = planCycleChange(toSchedulable(task), cycle, ordinal, today());
  return applyPatch(tx, task, patch, {
    type: task.discussionFrequency ? "FREQUENCY_CHANGED" : "INITIALIZED",
    userId,
  });
}
