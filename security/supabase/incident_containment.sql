-- OPTIONAL, SEPARATELY APPROVED incident response. Forces every device to log in.
-- Preserve evidence and offline queues. Never delete identities or proof history.
-- Insert SET LOCAL lerne.approve_session_containment='approved'; after BEGIN only
-- after approving this operation, closing DB access, and deploying strict auth.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $containment$
BEGIN
    IF current_setting('lerne.approve_session_containment', true) IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'Session revocation requires separate approval';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lerne_security.migration_snapshot WHERE version='20261020')
       OR has_schema_privilege('anon','public','USAGE')
       OR has_schema_privilege('authenticated','public','USAGE') THEN
        RAISE EXCEPTION 'Close public access before revoking sessions';
    END IF;
END;
$containment$;
UPDATE public.tma_auth_session SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
UPDATE public.tma_auth_code SET is_used = true WHERE NOT is_used;
UPDATE public.tma_auth_challenge SET completed_at = CURRENT_TIMESTAMP WHERE completed_at IS NULL;
COMMIT;
