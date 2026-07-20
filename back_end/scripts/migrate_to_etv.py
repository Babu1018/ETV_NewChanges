"""
One-time migration: copy users + history from legacy ASR / tts databases into ETV.

Usage (from back_end/):
    python scripts/migrate_to_etv.py
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

BASE_URL = os.getenv("DATABASE_URL", "").rsplit("/", 1)[0]
if not BASE_URL:
    raise SystemExit("Set DATABASE_URL in back_end/.env first.")


def migrate_table(src_name: str, dst_engine, table: str) -> int:
    src_engine = create_engine(f"{BASE_URL}/{src_name}", connect_args={"connect_timeout": 10})
    src_tables = inspect(src_engine).get_table_names()
    if table not in src_tables:
        print(f"  skip {src_name}.{table} (table missing)")
        return 0

    with src_engine.connect() as src:
        rows = src.execute(text(f"SELECT * FROM {table}")).mappings().all()
    if not rows:
        print(f"  skip {src_name}.{table} (empty)")
        return 0

    columns = list(rows[0].keys())
    col_sql = ", ".join(columns)
    val_sql = ", ".join(f":{c}" for c in columns)
    insert_sql = text(f"INSERT INTO {table} ({col_sql}) VALUES ({val_sql}) ON CONFLICT DO NOTHING")

    copied = 0
    with dst_engine.begin() as dst:
        for row in rows:
            result = dst.execute(insert_sql, dict(row))
            copied += result.rowcount or 0

    print(f"  {src_name}.{table}: copied {copied}/{len(rows)} row(s)")
    return copied


def migrate_tts_history(src_name: str, dst_engine) -> int:
    src_engine = create_engine(f"{BASE_URL}/{src_name}", connect_args={"connect_timeout": 10})
    with src_engine.connect() as src:
        rows = src.execute(
            text(
                """
                SELECT h.*, u.email AS owner_email
                FROM tts_history h
                LEFT JOIN users u ON u.id = h.user_id
                """
            )
        ).mappings().all()
    if not rows:
        print(f"  skip {src_name}.tts_history (empty)")
        return 0

    copied = 0
    with dst_engine.begin() as dst:
        for row in rows:
            payload = dict(row)
            email = payload.pop("owner_email", None)
            if email:
                etv_user = dst.execute(
                    text("SELECT id FROM users WHERE email = :email"),
                    {"email": email},
                ).first()
                if etv_user:
                    payload["user_id"] = etv_user[0]
            payload.pop("owner_email", None)
            columns = [k for k in payload.keys()]
            col_sql = ", ".join(columns)
            val_sql = ", ".join(f":{c}" for c in columns)
            result = dst.execute(
                text(
                    f"INSERT INTO tts_history ({col_sql}) VALUES ({val_sql}) ON CONFLICT DO NOTHING"
                ),
                payload,
            )
            copied += result.rowcount or 0

    print(f"  {src_name}.tts_history: copied {copied}/{len(rows)} row(s)")
    return copied


def main() -> None:
    dst_engine = create_engine(f"{BASE_URL}/ETV", connect_args={"connect_timeout": 10})
    dst_tables = set(inspect(dst_engine).get_table_names())
    required = {"users", "asr_history", "tts_history", "password_reset_otps"}
    missing = required - dst_tables
    if missing:
        raise SystemExit(f"ETV missing tables: {sorted(missing)}. Start the API once to run init_db().")

    print("Migrating into ETV...")
    migrate_table("ASR", dst_engine, "users")
    migrate_table("ASR", dst_engine, "password_reset_otps")
    migrate_table("ASR", dst_engine, "asr_history")
    migrate_tts_history("tts", dst_engine)
    print("Done.")

    with dst_engine.connect() as c:
        for table in ("users", "asr_history", "tts_history"):
            n = c.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            print(f"ETV.{table}: {n}")


if __name__ == "__main__":
    main()
