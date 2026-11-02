-- One-time review frequencies (existing W / FT / M values are unchanged).
ALTER TYPE "DiscussionFrequency" ADD VALUE IF NOT EXISTS 'NEXT_MONDAY';
ALTER TYPE "DiscussionFrequency" ADD VALUE IF NOT EXISTS 'NEXT_MONTH';
ALTER TYPE "DiscussionFrequency" ADD VALUE IF NOT EXISTS 'FLEXIBLE';

-- New task status.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'RUNNING';

-- The Monday a one-time task is allocated to. Existing rows get NULL.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "allocatedMonday" DATE;
