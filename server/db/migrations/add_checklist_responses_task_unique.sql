-- Migration: Enforce one checklist response per task
--
-- Background: A technician working offline queues a checklist submission; on
-- reconnect the client replays it. If the network blipped after the server saved
-- the response but before the client received the ack, the replay would insert a
-- SECOND response row for the same task (and re-run inventory deduction). The
-- application now guards against this in routes/checklistResponses.js, but this
-- constraint is the database-level backstop so a duplicate can never be persisted
-- even if the application guard is bypassed or races.
--
-- Safe to run multiple times (idempotent).

-- Step 1: Remove any pre-existing duplicate responses, keeping the earliest one
-- per task (by submitted_at, then id as a deterministic tiebreaker). Without this,
-- adding the unique constraint below would fail on tables that already contain
-- duplicates from before the application guard existed.
DELETE FROM checklist_responses cr
USING (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY task_id
             ORDER BY submitted_at ASC, id ASC
           ) AS rn
    FROM checklist_responses
    WHERE task_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
) dupes
WHERE cr.id = dupes.id;

-- Step 2: Add a unique index on task_id (partial — NULL task_id is not expected
-- but excluded for safety so it never blocks the constraint). A unique index is
-- used rather than a table constraint so it can be created IF NOT EXISTS and so the
-- ON CONFLICT (task_id) clause in the route can reference it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklist_responses_task_id
  ON checklist_responses(task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON INDEX uniq_checklist_responses_task_id IS
  'Enforces a single checklist response per task; backstop against duplicate offline-replay submissions.';
