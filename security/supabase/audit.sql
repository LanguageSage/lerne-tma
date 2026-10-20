-- Read-only gate. ZERO rows is success; covers every new public object.
-- No row contents, token hashes, identity subjects or secrets are returned.
WITH objects AS (
    SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
), api_roles AS (
    SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')
)
SELECT 'rls_disabled' AS issue, o.relname::text AS object, ''::text AS role
FROM objects o WHERE o.relkind IN ('r','p') AND NOT o.relrowsecurity
UNION ALL
SELECT 'object_privilege', o.relname, r.rolname FROM objects o CROSS JOIN api_roles r
WHERE CASE WHEN o.relkind = 'S' THEN has_sequence_privilege(r.oid, o.oid, 'USAGE,SELECT,UPDATE')
           ELSE has_table_privilege(r.oid, o.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') END
UNION ALL
SELECT 'column_privilege', o.relname || '.' || a.attname, r.rolname
FROM objects o JOIN pg_attribute a ON a.attrelid = o.oid CROSS JOIN api_roles r
WHERE o.relkind <> 'S' AND a.attnum > 0 AND NOT a.attisdropped
  AND has_column_privilege(r.oid, o.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')
UNION ALL
SELECT 'unexpected_policy', c.relname, '' FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
UNION ALL
SELECT 'function_execute', p.oid::regprocedure::text, r.rolname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN api_roles r
WHERE n.nspname = 'public' AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
UNION ALL
SELECT 'unsafe_creator_default', d.defaclobjtype::text, r.rolname
FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a CROSS JOIN api_roles r
WHERE d.defaclrole = 'postgres'::regrole
  AND d.defaclnamespace IN (0, 'public'::regnamespace::oid)
  AND (a.grantee = 0 OR a.grantee = r.oid OR
       (a.grantee <> 0 AND pg_has_role(r.oid, a.grantee, 'USAGE')))
UNION ALL
SELECT 'implicit_public_function_execute', 'postgres global functions', ''
WHERE NOT EXISTS (SELECT 1 FROM pg_default_acl
                  WHERE defaclrole = 'postgres'::regrole AND defaclnamespace = 0 AND defaclobjtype = 'f')
UNION ALL
SELECT 'public_schema_access', 'public', r.rolname FROM api_roles r
WHERE has_schema_privilege(r.oid, 'public', 'USAGE,CREATE')
UNION ALL
SELECT 'api_role_bypasses_rls', r.rolname, r.rolname FROM pg_roles r
WHERE r.rolname IN ('anon','authenticated') AND (r.rolsuper OR r.rolbypassrls)
UNION ALL
SELECT 'missing_api_role', required.name, required.name
FROM (VALUES ('anon'),('authenticated')) required(name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=required.name)
ORDER BY 1, 2, 3;
