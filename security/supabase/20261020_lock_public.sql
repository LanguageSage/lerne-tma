-- Explicit maintenance migration. NEVER run from application startup.
-- Execute as postgres, in its own transaction, after approving the target.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(76121020);

CREATE SCHEMA IF NOT EXISTS lerne_security;
REVOKE ALL ON SCHEMA lerne_security FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS lerne_security.migration_snapshot (
    version text PRIMARY KEY,
    captured_at timestamptz NOT NULL DEFAULT now(),
    rollback_sql text[] NOT NULL
);
ALTER TABLE lerne_security.migration_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA lerne_security FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
    obj record;
    permission record;
    commands text[] := ARRAY[]::text[];
    target text;
    scope text;
    grantee text;
BEGIN
    IF current_user <> 'postgres' OR NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolbypassrls
    ) THEN
        RAISE EXCEPTION 'Requires the reviewed postgres BYPASSRLS server role';
    END IF;
    IF EXISTS (SELECT 1 FROM lerne_security.migration_snapshot WHERE version = '20261020') THEN
        RAISE NOTICE '20261020 already applied; run audit.sql to detect drift';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
          AND c.relowner <> current_user::regrole
    ) OR EXISTS (
        SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    ) OR EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'Public ownership/policies/functions differ from reviewed architecture; re-audit';
    END IF;

    -- Deny the entire server-only schema as a second boundary, including future
    -- objects created by platform roles whose defaults postgres cannot change.
    commands := array_append(commands,
        'REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, anon, authenticated;');
    FOR permission IN
        SELECT a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
        WHERE n.nspname = 'public'
          AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
    LOOP
        grantee := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident(pg_get_userbyid(permission.grantee)) END;
        commands := array_append(commands, format('GRANT %s ON SCHEMA public TO %s%s;',
            permission.privilege_type, grantee,
            CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
    END LOOP;

    -- Snapshot ONLY ACL/RLS metadata. Owner and service_role grants stay intact.
    FOR obj IN
        SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
        ORDER BY c.relname
    LOOP
        target := format('public.%I', obj.relname);
        scope := CASE WHEN obj.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END;
        commands := array_append(commands, format(
            'REVOKE ALL PRIVILEGES ON %s %s FROM PUBLIC, anon, authenticated;', scope, target));
        IF obj.relkind IN ('r','p') THEN
            commands := array_append(commands, format('ALTER TABLE %s %s ROW LEVEL SECURITY;',
                target, CASE WHEN obj.relrowsecurity THEN 'ENABLE' ELSE 'DISABLE' END));
        END IF;
        FOR permission IN
            SELECT a.* FROM aclexplode(coalesce(obj.relacl,
                acldefault(CASE WHEN obj.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
                           obj.relowner))) a
            WHERE a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
        LOOP
            grantee := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
                            ELSE quote_ident(pg_get_userbyid(permission.grantee)) END;
            commands := array_append(commands, format('GRANT %s ON %s %s TO %s%s;',
                permission.privilege_type, scope, target, grantee,
                CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
        END LOOP;
        IF obj.relkind <> 'S' THEN
            FOR permission IN
                SELECT att.attname, a.* FROM pg_attribute att
                CROSS JOIN LATERAL aclexplode(att.attacl) a
                WHERE att.attrelid = obj.oid AND att.attnum > 0 AND NOT att.attisdropped
                  AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
            LOOP
                grantee := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
                                ELSE quote_ident(pg_get_userbyid(permission.grantee)) END;
                commands := array_append(commands, format('GRANT %s (%I) ON TABLE %s TO %s%s;',
                    permission.privilege_type, permission.attname, target, grantee,
                    CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
                EXECUTE format('REVOKE %s (%I) ON TABLE %s FROM %s;',
                    permission.privilege_type, permission.attname, target, grantee);
            END LOOP;
        END IF;
        IF obj.relkind IN ('r','p') THEN
            EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
        END IF;
        EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM PUBLIC, anon, authenticated', scope, target);
    END LOOP;

    -- Defaults belong to the object creator. All reviewed Lerne DDL uses postgres.
    -- supabase_admin defaults are platform-owned and must be audited separately.
    -- Global function PUBLIC EXECUTE cannot be removed with a schema-only revoke.
    FOR obj IN
        SELECT * FROM (VALUES ('r'::"char", 'TABLES', true),
            ('S'::"char", 'SEQUENCES', true), ('f'::"char", 'FUNCTIONS', true),
            ('r'::"char", 'TABLES', false), ('S'::"char", 'SEQUENCES', false),
            ('f'::"char", 'FUNCTIONS', false)) x(kind, label, per_schema)
    LOOP
        scope := CASE WHEN obj.per_schema THEN ' IN SCHEMA public' ELSE '' END;
        commands := array_append(commands, format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s REVOKE ALL ON %s FROM PUBLIC, anon, authenticated;',
            scope, obj.label));
        FOR permission IN
            SELECT a.* FROM aclexplode(coalesce(
                (SELECT d.defaclacl FROM pg_default_acl d
                 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = obj.kind
                   AND d.defaclnamespace = CASE WHEN obj.per_schema THEN 'public'::regnamespace::oid ELSE 0 END),
                CASE WHEN obj.per_schema THEN '{}'::aclitem[] ELSE acldefault(obj.kind, 'postgres'::regrole) END
            )) a WHERE a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
        LOOP
            grantee := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
                            ELSE quote_ident(pg_get_userbyid(permission.grantee)) END;
            commands := array_append(commands, format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s GRANT %s ON %s TO %s%s;',
                scope, permission.privilege_type, obj.label, grantee,
                CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
        END LOOP;
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE postgres%s REVOKE ALL ON %s FROM PUBLIC, anon, authenticated',
            scope, obj.label);
    END LOOP;
    REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, anon, authenticated;
    INSERT INTO lerne_security.migration_snapshot(version, rollback_sql)
        VALUES ('20261020', commands);
END;
$migration$;

-- Fail the whole transaction if inherited privileges or unexpected role
-- attributes would defeat the lockdown. Do not commit a partial protection.
DO $postflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
        AND (r.rolsuper OR r.rolbypassrls OR has_schema_privilege(r.oid, 'public', 'USAGE,CREATE'))
    ) OR EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN pg_roles r WHERE n.nspname='public' AND r.rolname IN ('anon','authenticated')
        AND ((c.relkind IN ('r','p','v','m','f') AND
              (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
               OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
             OR (c.relkind='S' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE'))
             OR (c.relkind IN ('r','p') AND NOT c.relrowsecurity))
    ) THEN
        RAISE EXCEPTION 'Effective privileges or RLS failed lockdown postflight';
    END IF;
END;
$postflight$;
COMMIT;
