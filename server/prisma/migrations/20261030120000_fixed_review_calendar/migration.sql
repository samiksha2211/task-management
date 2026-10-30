-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "fortnightAnchor" DATE;


-- Fortnightly tasks keep the alternate weeks they already had: the cycle runs
-- from their current next discussion date (always a Monday), or from the
-- Monday of the week they were created if they have none.
UPDATE "Task"
SET "fortnightAnchor" = COALESCE("nextDiscussionDate", date_trunc('week', "createdAt")::date)
WHERE "discussionFrequency" = 'FORTNIGHTLY' AND "fortnightAnchor" IS NULL;

-- "Last Monday" (-1) is the same as a 5th Monday that falls back to the last.
UPDATE "Task" SET "monthlyMondayOrdinal" = 5 WHERE "monthlyMondayOrdinal" = -1;

-- Monthly tasks without an allocated Monday are on the 1st Monday.
UPDATE "Task" SET "monthlyMondayOrdinal" = 1
WHERE "discussionFrequency" = 'MONTHLY' AND "monthlyMondayOrdinal" IS NULL;
