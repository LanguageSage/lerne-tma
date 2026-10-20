"""Read-only catalog gate; explicitly supply SECURITY_AUDIT_DATABASE_URL.

Does not load .env, apply migrations or print credentials or user records.
"""
import os
from pathlib import Path
import psycopg2


def main():
    url = os.environ.get('SECURITY_AUDIT_DATABASE_URL')
    if not url:
        raise SystemExit('Set SECURITY_AUDIT_DATABASE_URL explicitly for the target')
    try:
        with psycopg2.connect(url, connect_timeout=10) as conn:
            conn.set_session(readonly=True)
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout='15s'")
                cur.execute((Path(__file__).resolve().parents[1] / 'security/supabase/audit.sql').read_text('utf-8'))
                findings = cur.fetchall()
        for issue, name, role in findings:
            print(f'{issue}: {name} [{role}]')
        print(f'Security catalog violations: {len(findings)}')
        return int(bool(findings))
    except psycopg2.Error:
        raise SystemExit('Security audit failed; inspect database connectivity/permissions privately') from None


if __name__ == '__main__':
    raise SystemExit(main())
