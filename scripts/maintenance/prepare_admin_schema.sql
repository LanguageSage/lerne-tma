-- OPERATOR REVIEW ONLY. Never called by application startup or Admin.
-- Requires a separate production approval and a verified fresh backup.
-- PostgreSQL 17: no content backfills, defaults, grants, RLS or marker changes.
-- SET NOT NULL rejects and rolls back the entire transaction if NULLs appeared.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(76120901);
ALTER TABLE public.tma_user
  ALTER COLUMN has_selected_language SET NOT NULL,
  ALTER COLUMN default_decks_initialized SET NOT NULL;
ALTER TABLE public.tma_folder ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.tma_deck
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN is_inbox SET NOT NULL,
  ALTER COLUMN is_pinned SET NOT NULL,
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN metadata SET NOT NULL;
ALTER TABLE public.tma_card
  ALTER COLUMN is_deleted SET NOT NULL,
  ALTER COLUMN want_to_learn SET NOT NULL,
  ALTER COLUMN history SET NOT NULL,
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN flag SET NOT NULL;
ALTER TABLE public.tma_collaborator ALTER COLUMN can_edit_audio SET NOT NULL;
ALTER TABLE public.tma_offline_batch ALTER COLUMN payload_hash TYPE varchar(255);
ALTER TABLE public.tmasetting ALTER COLUMN value SET NOT NULL;
COMMIT;
