-- DANGER: restores original public exposure. Prefer forward repair or reverting
-- the API deployment while KEEPING database protection. Separate approval needed.
-- Insert SET LOCAL lerne.allow_unsafe_security_rollback = 'approved'; after BEGIN
-- only after that approval. The unmodified file deliberately refuses execution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(76121020);
DO $rollback$
DECLARE statement text;
BEGIN
    IF current_user <> 'postgres' OR
       current_setting('lerne.allow_unsafe_security_rollback', true) IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'Unsafe rollback requires separate approval and explicit session opt-in';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lerne_security.migration_snapshot WHERE version = '20261020') THEN
        RAISE EXCEPTION 'Original ACL/RLS snapshot is missing';
    END IF;
    FOR statement IN SELECT unnest(rollback_sql) FROM lerne_security.migration_snapshot
                     WHERE version = '20261020'
    LOOP
        EXECUTE statement;
    END LOOP;
    DELETE FROM lerne_security.migration_snapshot WHERE version = '20261020';
END;
$rollback$;
COMMIT;
