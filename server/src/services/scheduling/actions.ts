// Schedule-changing operations shared by the task and meeting controllers.

import type { Task } from "@prisma/client";
import type { Cycle } from "./config";
import { toISODateOrNull } from "./dates";
import { planCycleChange, type CycleOptions } from "./rules";
import { applyPatch, today, toSchedulable, type Tx } from "./repository";

/**
 * Set, change or clear a task's review frequency, allocated Monday (M) or
 * fortnightly start Monday (FT). Does nothing if nothing changed.
 */
export async function setTaskCycle(
  tx: Tx,
  task: Task,
  cycle: Cycle | null,
  options: CycleOptions,
  userId: string | null
): Promise<Task> {
  const patch = planCycleChange(toSchedulable(task), cycle, options, today());
  const unchanged =
    patch.discussionFrequency === task.discussionFrequency &&
    (patch.monthlyMondayOrdinal ?? null) === (task.monthlyMondayOrdinal ?? null) &&
    (patch.fortnightAnchor ?? null) === toISODateOrNull(task.fortnightAnchor) &&
    task.scheduleState === "SCHEDULED";
  if (unchanged) return task;

  return applyPatch(tx, task, patch, {
    type: task.discussionFrequency ? "FREQUENCY_CHANGED" : "INITIALIZED",
    userId,
  });
}
