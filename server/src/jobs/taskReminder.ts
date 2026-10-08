import cron from "node-cron";
import { prisma } from "../prisma";
import { sendSMS } from "../services/sms";
import {
  pendingSms,
  dueSms,
  overdueSms,
} from "../services/smsTemplates";

function getDateOnly(date: Date): Date {
  const formatted = date.toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });

  return new Date(`${formatted}T00:00:00Z`);
}

function daysBetween(from: Date, to: Date): number {
  const fromDate = getDateOnly(from);
  const toDate = getDateOnly(to);

  return Math.round(
    (toDate.getTime() - fromDate.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

export async function runTaskReminders() {
  console.log("Running RailWork SMS reminder job...");

  try {
    const tasks = await prisma.task.findMany({
      where: {
        status: "PENDING",
        deletedAt: null,
      },
      include: {
        officer: true,
      },
    });

    const today = new Date();

    for (const task of tasks) {
      if (!task.officer.mobileNumber) {
        console.log(
          `Skipping ${task.title}: officer mobile number not available`
        );
        continue;
      }

      const daysLeft = daysBetween(today, task.dueDate);
      const daysSinceAssignment = daysBetween(task.date, today);

      const dueDate = task.dueDate.toLocaleDateString("en-GB", {
        timeZone: "Asia/Kolkata",
      });

      let message: string | null = null;

      // 1. Overdue -> daily SMS
      if (daysLeft < 0) {
        message = overdueSms(task.title, dueDate);
      }

      // 2. Due today / within next 3 days -> daily SMS
      else if (daysLeft <= 3) {
        message = dueSms(
          task.title,
          dueDate,
          daysLeft
        );
      }

      // 3. Normal pending -> every 7 days
      else if (
        daysSinceAssignment > 0 &&
        daysSinceAssignment % 7 === 0
      ) {
        message = pendingSms(
          task.title,
          dueDate
        );
      }

      if (!message) {
        continue;
      }

      try {
        console.log(
          `Sending reminder to ${task.officer.designation}`
        );

        console.log("Mobile:", task.officer.mobileNumber);
        console.log("Message:", message);

        const result = await sendSMS(
          task.officer.mobileNumber,
          message
        );

        console.log(
          "Reminder SMS submitted successfully:",
          result
        );
      } catch (error) {
        console.error(
          `Reminder SMS failed for task ${task.title}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "RailWork reminder scheduler failed:",
      error
    );
  }
}

// Local/long-running server only. On Vercel, the cron in vercel.json
// calls /api/cron/task-reminders instead.
export function startTaskReminderScheduler() {
  cron.schedule("0 9 * * *", runTaskReminders, {
    timezone: "Asia/Kolkata",
  });

  console.log(
    "RailWork SMS reminder scheduler started - runs daily at 9:00 AM IST"
  );
}