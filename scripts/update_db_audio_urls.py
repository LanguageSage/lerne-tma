import os
import sys
from dotenv import load_dotenv

load_dotenv()

from api import models

def main():
    db = models.tma_db

    print("Checking current status before update...")
    with db.atomic() as txn:
        # Check counts
        for tbl in ['tma_card', 'card']:
            cursor = db.execute_sql(f"""
                SELECT 
                    COUNT(*) FILTER (WHERE audio_path LIKE '%%/tma-audio/%%') as tma_audio_count,
                    COUNT(*) FILTER (WHERE audio_path IS NOT NULL AND audio_path != '' AND audio_path NOT LIKE 'http%%') as rel_audio_count,
                    COUNT(*) FILTER (WHERE audio_back_path LIKE '%%/tma-audio/%%') as tma_back_count,
                    COUNT(*) FILTER (WHERE audio_back_path IS NOT NULL AND audio_back_path != '' AND audio_back_path NOT LIKE 'http%%') as rel_back_count
                FROM {tbl}
            """)
            row = cursor.fetchone()
            print(f"Table {tbl}: tma_audio={row[0]}, rel_audio={row[1]}, tma_back={row[2]}, rel_back={row[3]}")

        # Update tma-audio URLs -> audio URLs
        print("\nUpdating /tma-audio/ to /audio/ in tma_card and card...")
        for tbl in ['tma_card', 'card']:
            db.execute_sql(f"""
                UPDATE {tbl}
                SET audio_path = REPLACE(audio_path, '/storage/v1/object/public/tma-audio/', '/storage/v1/object/public/audio/')
                WHERE audio_path LIKE '%%/tma-audio/%%'
            """)
            db.execute_sql(f"""
                UPDATE {tbl}
                SET audio_back_path = REPLACE(audio_back_path, '/storage/v1/object/public/tma-audio/', '/storage/v1/object/public/audio/')
                WHERE audio_back_path LIKE '%%/tma-audio/%%'
            """)

        # Update relative filenames -> full audio bucket URLs
        print("\nUpdating relative filenames to full public audio URLs...")
        for tbl in ['tma_card', 'card']:
            db.execute_sql(f"""
                UPDATE {tbl}
                SET audio_path = CONCAT('https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio/', audio_path)
                WHERE audio_path IS NOT NULL AND audio_path != '' AND audio_path NOT LIKE 'http%%'
            """)
            db.execute_sql(f"""
                UPDATE {tbl}
                SET audio_back_path = CONCAT('https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio/', audio_back_path)
                WHERE audio_back_path IS NOT NULL AND audio_back_path != '' AND audio_back_path NOT LIKE 'http%%'
            """)

        print("\nDatabase update completed in transaction.")

    print("\nVerifying updated counts...")
    for tbl in ['tma_card', 'card']:
        cursor = db.execute_sql(f"""
            SELECT 
                COUNT(*) FILTER (WHERE audio_path LIKE '%%/audio/%%') as audio_bucket_count,
                COUNT(*) FILTER (WHERE audio_path LIKE '%%/tma-audio/%%') as remaining_tma_audio,
                COUNT(*) FILTER (WHERE audio_path IS NOT NULL AND audio_path != '' AND audio_path NOT LIKE 'http%%') as remaining_rel
            FROM {tbl}
        """)
        row = cursor.fetchone()
        print(f"Table {tbl}: audio_bucket={row[0]}, remaining_tma={row[1]}, remaining_rel={row[2]}")

if __name__ == "__main__":
    main()
