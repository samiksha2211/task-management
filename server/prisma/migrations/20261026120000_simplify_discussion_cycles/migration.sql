-- Rename discussion cycle values in place (existing assignments are kept).
ALTER TYPE "DiscussionFrequency" RENAME VALUE 'M' TO 'WEEKLY';
ALTER TYPE "DiscussionFrequency" RENAME VALUE 'F' TO 'FORTNIGHTLY';
ALTER TYPE "DiscussionFrequency" RENAME VALUE 'NM' TO 'MONTHLY';

-- Readable task ID: existing tasks are numbered in creation order.
ALTER TABLE "Task" ADD COLUMN "taskNumber" INTEGER;
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n FROM "Task"
)
UPDATE "Task" t SET "taskNumber" = numbered.n FROM numbered WHERE t."id" = numbered."id";
CREATE SEQUENCE "Task_taskNumber_seq" OWNED BY "Task"."taskNumber";
SELECT setval('"Task_taskNumber_seq"', COALESCE((SELECT MAX("taskNumber") FROM "Task"), 0) + 1, false);
ALTER TABLE "Task" ALTER COLUMN "taskNumber" SET DEFAULT nextval('"Task_taskNumber_seq"');
ALTER TABLE "Task" ALTER COLUMN "taskNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Task_taskNumber_key" ON "Task"("taskNumber");

-- Discussion-time estimates are no longer used by the agenda.
ALTER TABLE "MeetingAgendaItem" ALTER COLUMN "estimatedMinutes" SET DEFAULT 0;
