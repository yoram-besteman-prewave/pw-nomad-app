# NoMAD Database Integration

## Overview

NoMAD uses **PostgreSQL 15+** via **Google Cloud SQL** to persist all scheduling state. The application maintains an in-memory cache for fast reads while persisting all changes to the database synchronously.

**Database is REQUIRED.** NoMAD will not start without a working database connection. There is no fallback mode.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloud Run                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    FastAPI Backend                           ││
│  │                                                              ││
│  │   ┌──────────────┐     ┌──────────────┐                     ││
│  │   │   In-Memory  │ ◄── │  On Startup  │                     ││
│  │   │    Cache     │     │  Load from   │                     ││
│  │   │              │     │   Database   │                     ││
│  │   └──────┬───────┘     └──────────────┘                     ││
│  │          │                                                   ││
│  │          │ On Write                                          ││
│  │          ▼                                                   ││
│  │   ┌──────────────┐                                          ││
│  │   │  Write to    │                                          ││
│  │   │  Database    │                                          ││
│  │   └──────────────┘                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                    Cloud SQL Auth Proxy                          │
│                       (Unix Socket)                              │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Cloud SQL                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   PostgreSQL 15+                             ││
│  │                                                              ││
│  │   Instance: nomad-db                                         ││
│  │   Region:   europe-west6                                     ││
│  │   Database: nomad                                            ││
│  │   User:     nomad-user                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Connection Details

**Cloud SQL Instance:**
```
Project:   pw-it-common
Instance:  nomad-db
Region:    europe-west6
Database:  nomad
User:      nomad-user
Password:  <secure-password>
```

**Connection String (Cloud Run with Unix Socket):**
```
postgresql://nomad-user:<secure-password>@/nomad?host=/cloudsql/pw-it-common:europe-west6:nomad-db
```

The connection uses a Unix socket via Cloud SQL Auth Proxy (no public IP exposure).

---

## Database Schema

### Migration System

Migrations are stored in `backend/migrations/` and applied automatically on startup:

1. Check `_migrations` table for already-applied migrations
2. Apply new `.sql` files in alphabetical order
3. Record each migration in `_migrations` table

**Current Migrations:**
- `001_initial.sql` - Core schema (tickets, settings)
- `002_users.sql` - Auth schema (users, sessions, activity)

---

### Table: `ticket_schedule`

Stores the scheduling state for each Jira ticket.

```sql
CREATE TABLE ticket_schedule (
    ticket_key VARCHAR(20) PRIMARY KEY,   -- e.g. "PRES-1234"
    priority_order INTEGER,               -- Position in queue (1-based)
    in_queue BOOLEAN DEFAULT FALSE,       -- Whether in priority queue
    locked_week INTEGER,                  -- Week number if locked
    locked_year INTEGER,                  -- Year if locked
    scheduled_lines INTEGER,              -- Lines at time of scheduling (for mismatch detection)
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `ticket_key` | VARCHAR(20) | Jira ticket key (e.g., "PRES-1234") |
| `priority_order` | INTEGER | Position in the priority queue (1 = highest) |
| `in_queue` | BOOLEAN | True if ticket is in queue, False if in pool |
| `locked_week` | INTEGER | ISO week number if locked to a week |
| `locked_year` | INTEGER | Year if locked to a week |
| `scheduled_lines` | INTEGER | Lines at time of scheduling (for mismatch detection) |
| `updated_at` | TIMESTAMP | Last modification time |

**When Written:**
- User drags ticket in queue → `priority_order` updated for all affected
- User locks ticket to week → `locked_week`, `locked_year`, `scheduled_lines` set
- User unlocks ticket → `locked_week`, `locked_year` set to NULL
- User moves ticket to/from pool → `in_queue` updated

---

### Table: `week_settings`

Per-week capacity overrides and reservation unlocks.

```sql
CREATE TABLE week_settings (
    year INTEGER NOT NULL,
    week INTEGER NOT NULL,
    capacity INTEGER,                      -- Override capacity (NULL = use default)
    small_unlocked BOOLEAN DEFAULT FALSE,  -- Release small ticket reservation
    medium_unlocked BOOLEAN DEFAULT FALSE, -- Release medium ticket reservation
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (year, week)
);
```

**When Written:**
- Admin changes week capacity → `capacity` updated
- Admin unlocks reservation → `small_unlocked` or `medium_unlocked` set TRUE

---

### Table: `global_settings`

Application-wide settings stored as JSON.

```sql
CREATE TABLE global_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Current Settings:**
| Key | Default Value | Description |
|-----|---------------|-------------|
| `weekly_capacity` | `4000` | Default lines per week |
| `reservation_defaults` | `{"small": 500, "medium": 1500}` | Default reservation amounts |

---

### Table: `users`

Users who have logged in via Okta.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    okta_id VARCHAR(255) UNIQUE NOT NULL,  -- Okta user ID (sub claim)
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture VARCHAR(512),                   -- Profile picture URL
    is_admin BOOLEAN DEFAULT FALSE,         -- Derived from Okta groups
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**When Written:**
- User logs in → `last_login` updated, `is_admin` re-evaluated
- User details change in Okta → `name`, `email`, `picture` updated

---

### Table: `user_activity`

Audit log of user actions.

```sql
CREATE TABLE user_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255) NOT NULL,      -- Denormalized for retention
    action VARCHAR(50) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Action Types:**
| Action | Details Example |
|--------|-----------------|
| `login` | `{"method": "okta_oidc"}` |
| `logout` | — |
| `ticket_scheduled` | `{"ticket_key": "PRES-123", "week": 52, "year": 2024}` |
| `capacity_changed` | `{"week": 52, "old": 4000, "new": 3500}` |

---

### Table: `sessions`

Active user sessions.

```sql
CREATE TABLE sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tab_id VARCHAR(32),                    -- For single-tab enforcement
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Lifecycle:**
- Created on successful Okta login
- Extended when user clicks "Stay logged in"
- Deleted on logout or expiry
- Cleaned up automatically

---

## Data Flow

### On Application Startup

1. **Create connection pool** (2-10 connections via asyncpg)
2. **Test connection** - fails immediately if unreachable
3. **Run migrations** - idempotent, checks `_migrations` table
4. **Load into memory:**
   - `ticket_schedules` dict from `ticket_schedule` table
   - `week_settings` dict from `week_settings` table
   - Global settings into module variables

**If any step fails, the application crashes with an error.**

### On Read Operations

- All reads served from in-memory cache (no DB query)
- Ticket details fetched fresh from Jira API
- Scheduling state (queue, locks) from cache

### On Write Operations

Each write:
1. Updates in-memory cache immediately
2. Persists to database synchronously
3. Returns response to client

| User Action | API Endpoint | Tables Updated |
|-------------|--------------|----------------|
| Reorder queue | `POST /api/tickets/priority` | `ticket_schedule` |
| Lock ticket to week | `POST /api/tickets/priority` + `/due-date` | `ticket_schedule` |
| Change week capacity | `POST /api/capacity/week` | `week_settings` |
| Change default capacity | `POST /api/capacity/default` | `global_settings` |
| Toggle reservation | `POST /api/reservation/toggle` | `week_settings` |
| User login | `GET /api/auth/callback` | `users`, `sessions`, `user_activity` |

---

## What's Persisted vs. Not

### Persisted in Database

- ✅ Ticket queue order and positions
- ✅ Ticket week locks
- ✅ Scheduled lines (for mismatch detection)
- ✅ Per-week capacity overrides
- ✅ Per-week reservation unlocks
- ✅ Default weekly capacity
- ✅ Default reservation amounts
- ✅ User records and sessions
- ✅ Audit activity log

### NOT Persisted (from Jira API)

- ❌ Ticket details (summary, description, assignee)
- ❌ Current ticket line counts (Total Count field)
- ❌ Ticket approval status
- ❌ Ticket due dates (set via API, read from Jira)

---

## Database is REQUIRED

NoMAD **cannot** operate without a database.

**On startup:**
- If `DATABASE_URL` not set → **Application crashes**
- If database unreachable → **Application crashes**
- If migrations fail → **Application crashes**

**Error messages:**
```
[Database] FATAL: DATABASE_URL environment variable is not set.
NoMAD requires a PostgreSQL database to function.
Please configure DATABASE_URL and restart.
```

```
[Database] FATAL: Cannot connect to database.
NoMAD requires a working PostgreSQL database.
Error: connection refused
```

---

## Verifying Database Connection

### Check startup logs:
```
[NoMAD] Starting up on port 8080
[Database] Connecting to PostgreSQL...
[Database] DATABASE_URL configured: Yes
[Database] Connection pool created
[Database] Connected to: PostgreSQL 15.x
[Database] Migrations complete
[NoMAD] Loaded 15 ticket schedules from database
[NoMAD] Loaded 3 week settings from database
[NoMAD] Capacity: 4000, Small: 500, Medium: 1500
```

### Check health endpoint:
```bash
curl https://nomad.it.prewave.ai/api/health
```

Response:
```json
{
  "status": "healthy",
  "version": "0.1.1",
  "database": "connected",
  "okta": "configured"
}
```

---

## Manual Database Access

```bash
# Connect via Cloud SQL Auth Proxy
gcloud sql connect nomad-db --database=nomad --user=nomad-user --project=pw-it-common

# Or using psql if public IP enabled
psql "host=<IP_ADDRESS> dbname=nomad user=nomad-user"
```

---

## Backup and Recovery

### Automatic Backups
Cloud SQL provides:
- **Daily automatic backups** (retained 7 days)
- **Point-in-time recovery** (last 7 days)

### Manual Backup
```bash
gcloud sql backups create --instance=nomad-db --project=pw-it-common
```

### List Backups
```bash
gcloud sql backups list --instance=nomad-db --project=pw-it-common
```

### Export Critical Data
```sql
COPY ticket_schedule TO '/tmp/ticket_schedule.csv' CSV HEADER;
COPY week_settings TO '/tmp/week_settings.csv' CSV HEADER;
COPY global_settings TO '/tmp/global_settings.csv' CSV HEADER;
```

---

## Adding New Persisted Fields

1. Create new migration file: `backend/migrations/003_*.sql`
2. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
3. Update relevant functions in `backend/database.py`
4. Update `backend/main.py` to load/save the new field
5. Deploy - migrations run automatically on startup

**Example migration:**
```sql
-- 003_add_new_field.sql
ALTER TABLE ticket_schedule ADD COLUMN IF NOT EXISTS new_field VARCHAR(100);
```

---

## Troubleshooting

### Connection Timeout
- Check Cloud SQL instance is running
- Check Cloud Run has Cloud SQL connection configured
- Verify region matches (europe-west6)

### Authentication Failed
- Check username/password in DATABASE_URL
- Verify Cloud SQL user exists

### Missing Table/Column
- Check migrations ran successfully
- Run migrations manually if needed:
  ```sql
  -- In psql, run the migration SQL directly
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tab_id VARCHAR(32);
  ```

### Data Inconsistency
- In-memory cache and DB should always match
- If mismatch, restart container to reload from DB
