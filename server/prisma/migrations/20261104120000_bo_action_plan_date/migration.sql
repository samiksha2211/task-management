-- A BO's own Action Plan Date on their update. Existing rows get NULL.
ALTER TABLE "TaskOfficerUpdate" ADD COLUMN IF NOT EXISTS "actionPlanDate" DATE;
