"""
Database module for NoMAD - PostgreSQL persistence via Cloud SQL
Provides connection pooling and CRUD operations for scheduling state
"""
import os
import json
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

import asyncpg

# Database URL from environment (Cloud SQL socket or standard connection string)
# No fallback - DATABASE_URL must be explicitly set
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Connection pool
pool: Optional[asyncpg.Pool] = None


async def init_db():
    """
    Initialize database connection pool and run migrations.
    REQUIRED: Application will not start without database connection.
    """
    global pool
    
    if pool is not None:
        return
    
    print(f"[Database] Connecting to PostgreSQL...")
    print(f"[Database] DATABASE_URL configured: {'Yes' if DATABASE_URL else 'No'}")
    
    if not DATABASE_URL:
        raise RuntimeError(
            "[Database] FATAL: DATABASE_URL environment variable is not set. "
            "NoMAD requires a PostgreSQL database to function. "
            "Please configure DATABASE_URL and restart."
        )
    
    try:
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        print("[Database] Connection pool created")
        
        # Test the connection
        async with pool.acquire() as conn:
            version = await conn.fetchval("SELECT version()")
            print(f"[Database] Connected to: {version.split(',')[0]}")
        
        # Run migrations
        await run_migrations()
        print("[Database] Migrations complete")
        
    except Exception as e:
        print(f"[Database] FATAL: Failed to connect to database: {e}")
        raise RuntimeError(
            f"[Database] FATAL: Cannot connect to database. "
            f"NoMAD requires a working PostgreSQL database. "
            f"Error: {e}"
        )


async def close_db():
    """Close database connection pool"""
    global pool
    if pool:
        await pool.close()
        pool = None
        print("[Database] Connection pool closed")


async def run_migrations():
    """Run database migrations (idempotent)"""
    if not pool:
        return
    
    migrations_dir = os.path.join(os.path.dirname(__file__), "migrations")
    
    async with pool.acquire() as conn:
        # Create migrations tracking table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                name VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Get already applied migrations
        applied = set()
        rows = await conn.fetch("SELECT name FROM _migrations")
        for row in rows:
            applied.add(row["name"])
        
        # Apply pending migrations in order
        if os.path.exists(migrations_dir):
            migration_files = sorted([
                f for f in os.listdir(migrations_dir)
                if f.endswith(".sql")
            ])
            
            for filename in migration_files:
                if filename not in applied:
                    filepath = os.path.join(migrations_dir, filename)
                    with open(filepath, "r") as f:
                        sql = f.read()
                    
                    print(f"[Database] Applying migration: {filename}")
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO _migrations (name) VALUES ($1)",
                        filename
                    )


def is_connected() -> bool:
    """Check if database is connected"""
    return pool is not None


# =====================
# Ticket Schedule CRUD
# =====================

async def get_all_ticket_schedules() -> dict[str, dict]:
    """Get all ticket schedules as a dict keyed by ticket_key"""
    if not pool:
        return {}
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ticket_key, priority_order, in_queue, locked_week, locked_year, 
                   scheduled_lines, was_auto_returned, fst_key, updated_at
            FROM ticket_schedule
        """)
        
        result = {}
        for row in rows:
            result[row["ticket_key"]] = {
                "priority_order": row["priority_order"],
                "in_queue": row["in_queue"],
                "locked_week": row["locked_week"],
                "locked_year": row["locked_year"],
                "scheduled_lines": row.get("scheduled_lines"),
                "was_auto_returned": row.get("was_auto_returned", False),
                "fst_key": row.get("fst_key"),
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            }
        return result


async def get_ticket_schedule(ticket_key: str) -> Optional[dict]:
    """Get schedule for a specific ticket"""
    if not pool:
        return None
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT priority_order, in_queue, locked_week, locked_year, updated_at
            FROM ticket_schedule
            WHERE ticket_key = $1
        """, ticket_key)
        
        if row:
            return {
                "priority_order": row["priority_order"],
                "in_queue": row["in_queue"],
                "locked_week": row["locked_week"],
                "locked_year": row["locked_year"],
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            }
        return None


async def save_ticket_schedules(schedules: list[dict]):
    """
    Save multiple ticket schedules (upsert)
    Each schedule dict should have: ticket_key, priority_order, in_queue, locked_week, locked_year, scheduled_lines, was_auto_returned, fst_key
    """
    if not pool or not schedules:
        return
    
    async with pool.acquire() as conn:
        # Use a transaction for atomicity
        async with conn.transaction():
            for schedule in schedules:
                await conn.execute("""
                    INSERT INTO ticket_schedule (ticket_key, priority_order, in_queue, locked_week, locked_year, scheduled_lines, was_auto_returned, fst_key, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                    ON CONFLICT (ticket_key) 
                    DO UPDATE SET 
                        priority_order = EXCLUDED.priority_order,
                        in_queue = EXCLUDED.in_queue,
                        locked_week = EXCLUDED.locked_week,
                        locked_year = EXCLUDED.locked_year,
                        scheduled_lines = EXCLUDED.scheduled_lines,
                        was_auto_returned = EXCLUDED.was_auto_returned,
                        fst_key = COALESCE(EXCLUDED.fst_key, ticket_schedule.fst_key),
                        updated_at = CURRENT_TIMESTAMP
                """,
                    schedule.get("key") or schedule.get("ticket_key"),
                    schedule.get("priority_order"),
                    schedule.get("in_queue", False),
                    schedule.get("locked_week"),
                    schedule.get("locked_year"),
                    schedule.get("scheduled_lines"),
                    schedule.get("was_auto_returned", False),
                    schedule.get("fst_key"),
                )


async def delete_ticket_schedule(ticket_key: str):
    """Delete a ticket schedule"""
    if not pool:
        return
    
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM ticket_schedule WHERE ticket_key = $1",
            ticket_key
        )


# =====================
# Week Settings CRUD
# =====================

async def get_all_week_settings() -> dict[str, dict]:
    """Get all week settings as a dict keyed by 'year-week'"""
    if not pool:
        return {}
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT year, week, capacity, small_unlocked, medium_unlocked, updated_at
            FROM week_settings
        """)
        
        result = {}
        for row in rows:
            key = f"{row['year']}-{row['week']}"
            result[key] = {
                "year": row["year"],
                "week": row["week"],
                "capacity": row["capacity"],
                "small_unlocked": row["small_unlocked"],
                "medium_unlocked": row["medium_unlocked"],
            }
        return result


async def save_week_setting(year: int, week: int, capacity: int = None, 
                           small_unlocked: bool = None, medium_unlocked: bool = None):
    """Save or update a week setting"""
    if not pool:
        return
    
    async with pool.acquire() as conn:
        # Get existing values to merge
        existing = await conn.fetchrow(
            "SELECT capacity, small_unlocked, medium_unlocked FROM week_settings WHERE year = $1 AND week = $2",
            year, week
        )
        
        if existing:
            # Update only provided fields
            new_capacity = capacity if capacity is not None else existing["capacity"]
            new_small = small_unlocked if small_unlocked is not None else existing["small_unlocked"]
            new_medium = medium_unlocked if medium_unlocked is not None else existing["medium_unlocked"]
            
            await conn.execute("""
                UPDATE week_settings 
                SET capacity = $3, small_unlocked = $4, medium_unlocked = $5, updated_at = CURRENT_TIMESTAMP
                WHERE year = $1 AND week = $2
            """, year, week, new_capacity, new_small, new_medium)
        else:
            # Insert new
            await conn.execute("""
                INSERT INTO week_settings (year, week, capacity, small_unlocked, medium_unlocked, updated_at)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            """, year, week, capacity, small_unlocked or False, medium_unlocked or False)


async def delete_week_setting(year: int, week: int):
    """Delete a week setting (reset to defaults)"""
    if not pool:
        return
    
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM week_settings WHERE year = $1 AND week = $2",
            year, week
        )


# =====================
# Global Settings CRUD
# =====================

async def get_global_setting(key: str) -> Optional[dict]:
    """Get a global setting by key"""
    if not pool:
        return None
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT value FROM global_settings WHERE key = $1",
            key
        )
        if row:
            return json.loads(row["value"])
        return None


async def save_global_setting(key: str, value: dict):
    """Save a global setting"""
    if not pool:
        return
    
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO global_settings (key, value, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) 
            DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
        """, key, json.dumps(value))


async def get_all_global_settings() -> dict[str, dict]:
    """Get all global settings"""
    if not pool:
        return {}
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, value FROM global_settings")
        return {row["key"]: json.loads(row["value"]) for row in rows}

