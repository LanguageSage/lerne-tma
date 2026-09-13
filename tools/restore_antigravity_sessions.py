import sqlite3
import os
import shutil
import sys

def encode_varint(n):
    res = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        if n > 0:
            res.append(b | 0x80)
        else:
            res.append(b)
            break
    return bytes(res)

def restore():
    app_dir = os.path.expanduser(r"~\.gemini\antigravity")
    db_path = os.path.join(app_dir, "conversation_summaries.db")
    target_pb = os.path.join(app_dir, "agyhub_summaries_proto.pb")
    bak_pb = os.path.join(app_dir, "agyhub_summaries_proto.pb.bak")

    if not os.path.exists(db_path):
        print(f"Error: {db_path} not found!")
        return

    if os.path.exists(target_pb):
        try:
            shutil.copyfile(target_pb, bak_pb)
        except Exception:
            pass

    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT conversation_id, raw_summary FROM conversation_summaries "
        "WHERE raw_summary IS NOT NULL AND LENGTH(raw_summary) > 0"
    ).fetchall()

    full_pb = bytearray()
    for cid, raw in rows:
        cid_bytes = cid.encode("utf-8")
        entry = bytearray()
        entry += b"\x0a" + encode_varint(len(cid_bytes)) + cid_bytes
        entry += b"\x12" + encode_varint(len(raw)) + raw
        full_pb += b"\x0a" + encode_varint(len(entry)) + entry

    with open(target_pb, "wb") as f:
        f.write(full_pb)

    print(f"Success: Restored {len(rows)} sessions ({len(full_pb)} bytes) to {target_pb}")

if __name__ == "__main__":
    restore()
