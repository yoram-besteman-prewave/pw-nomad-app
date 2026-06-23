# NoMAD Technical Documentation

**Version:** 0.1.3  
**Last Updated:** December 2024

---

## Table of Contents

1. [Purpose & Business Logic](#purpose--business-logic)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Database](#database)
5. [Authentication (Okta OIDC)](#authentication-okta-oidc)
6. [Jira Integration](#jira-integration)
7. [Frontend Architecture](#frontend-architecture)
8. [Queue & Scheduling System](#queue--scheduling-system)
9. [Multi-Week Ticket Spanning](#multi-week-ticket-spanning)
10. [Capacity Management](#capacity-management)
11. [API Reference](#api-reference)
12. [Real-Time Features](#real-time-features)
13. [Deployment](#deployment)
14. [Key Relationships & Data Flow](#key-relationships--data-flow)
15. [Common Issues & Solutions](#common-issues--solutions)
16. [Code Reference Map](#code-reference-map)
17. [Version History](#version-history)

---

## Purpose & Business Logic

### What NoMAD Does

**NoMAD** (No More Arbitrary Dates) is a priority-based scheduling tool for Jira PRES tickets at Prewave. It solves:

- **Capacity planning**: Visualize how many lines can be processed per week
- **Priority management**: Drag-and-drop queue ordering
- **Due date sync**: Automatically sets Jira due dates when scheduling
- **Mismatch detection**: Flags when someone edits tickets directly in Jira
- **Multi-week spanning**: Large tickets automatically consume capacity across multiple weeks

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Ticket** | A Jira PRES issue with "Total Count" (lines to screen) |
| **Queue** | Ordered list of tickets to be processed, grouped by week |
| **Pool** | Unscheduled tickets (backlog), grouped by size |
| **Locked** | Ticket assigned to specific week, due date set in Jira |
| **Capacity** | Max lines per week (default: 4000) |
| **Reservation** | Lines reserved per week for small/medium tickets |
| **Overspill** | When a large ticket consumes capacity from earlier weeks |

### Ticket Sizes & Reservations

| Size | Line Range | Default Reserved/Week | Color |
|------|------------|----------------------|-------|
| Small | < 500 | 500 lines | Blue |
| Medium | 500-1499 | 1500 lines | Amber |
| Big | ≥ 1500 | Remaining (2000 default) | Slate |

### Scheduling Rules

1. Only **Approved** tickets can be scheduled (others show warning)
2. Tickets must have **Total Count** field filled in Jira
3. Locking to a week sets due date to **Friday of that week**
4. Admin can **unlock reservations** to release capacity for big tickets
5. Queue displays tickets **grouped by week** (never duplicate week dividers)
6. Within each week group, tickets maintain **priority order**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────┐ │
│  │    React     │  │  WebSocket   │  │     Cookies                    │ │
│  │  (Vite/TS)   │◄─┤   /ws/       │  │  session_token (HttpOnly)      │ │
│  │              │  │   presence   │  │  tab_id (for single-tab)       │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────────────────┘ │
└─────────┼─────────────────┼─────────────────────────────────────────────┘
          │ HTTPS           │ WSS
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUD RUN (europe-west1)                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      FastAPI + Uvicorn                              │ │
│  │                                                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │ │
│  │  │  REST API   │  │  WebSocket  │  │  In-Memory  │  │  Jira     │ │ │
│  │  │  Handlers   │  │  Handler    │  │  Cache      │  │  Client   │ │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │ │
│  │         │                │                │                │       │ │
│  │         └────────────────┴────────────────┘                │       │ │
│  │                          │                                 │       │ │
│  │              ┌───────────▼────────────┐                    │       │ │
│  │              │   asyncpg Pool (2-10)  │                    │       │ │
│  │              └───────────┬────────────┘                    │       │ │
│  └──────────────────────────┼─────────────────────────────────┼───────┘ │
│                             │ Unix Socket                     │ HTTPS   │
│                   Cloud SQL Auth Proxy                        │         │
└─────────────────────────────┼─────────────────────────────────┼─────────┘
                              ▼                                 ▼
┌─────────────────────────────────────┐  ┌────────────────────────────────┐
│         CLOUD SQL (europe-west6)     │  │         EXTERNAL SERVICES       │
│  ┌─────────────────────────────────┐│  │                                 │
│  │  PostgreSQL 15                  ││  │  ┌───────────────────────────┐ │
│  │  Instance: nomad-db             ││  │  │  Okta (prewave.okta.com)  │ │
│  │  Database: nomad                ││  │  │  - OIDC Authentication    │ │
│  │  User: nomad-user               ││  │  │  - Group membership       │ │
│  └─────────────────────────────────┘│  │  └───────────────────────────┘ │
└─────────────────────────────────────┘  │  ┌───────────────────────────┐ │
                                         │  │  Jira Cloud               │ │
                                         │  │  - api.atlassian.com      │ │
                                         │  │  - OAuth 2.0 (NoMAD App)  │ │
                                         │  └───────────────────────────┘ │
                                         │  ┌───────────────────────────┐ │
                                         │  │  n8n Webhook              │ │
                                         │  │  - Audit log events       │ │
                                         │  └───────────────────────────┘ │
                                         └────────────────────────────────┘
```

### Key Design Decisions

1. **Database is mandatory** - App crashes on startup if DB unavailable (no in-memory fallback)
2. **Backend is source of truth** - Frontend syncs from backend, not vice versa
3. **In-memory cache** - All schedules loaded into memory on startup for fast reads
4. **Dual-write pattern** - Updates go to cache + DB synchronously
5. **Single-tab sessions** - User can only be logged in from one browser tab
6. **Grouped week display** - Queue shows tickets grouped by week, never duplicate dividers

---

## Tech Stack

### Backend (`/backend`)

| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | 0.109+ | REST API framework, WebSocket support |
| `uvicorn` | 0.27+ | ASGI server |
| `asyncpg` | 0.29+ | Async PostgreSQL driver |
| `httpx` | 0.26+ | HTTP client for Okta/Jira |
| `python-jose` | 3.3+ | JWT decoding (Okta ID tokens) |
| `pydantic` | 2.10+ | Data validation |

### Frontend (`/frontend`)

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 18.x | UI framework |
| `typescript` | 5.x | Type safety |
| `vite` | 5.x | Build tool & dev server |
| `tailwindcss` | 3.x | Utility CSS |
| `@dnd-kit/core` | 6.x | Drag-and-drop |

### Infrastructure

| Component | Details |
|-----------|---------|
| Hosting | Cloud Run (europe-west1, 512MB, 1 CPU) |
| Database | Cloud SQL PostgreSQL 15 (europe-west6) |
| Container | Docker linux/amd64 |
| Domain | `nomad.it.prewave.ai` |

---

## Database

### Role & Purpose

The PostgreSQL database serves as the **persistent state layer** for NoMAD. It stores:

1. **Scheduling State** - Which tickets are in the queue vs pool, their order, and lock assignments
2. **Capacity Configuration** - Per-week capacity overrides and reservation unlocks
3. **User Management** - Okta user records synchronized on login
4. **Sessions** - Active login sessions with tab tracking for single-tab enforcement
5. **Audit Trail** - All user actions for compliance and debugging

**Why a database is required:**
- NoMAD is a **multi-user collaborative tool** - changes by one user must be visible to others
- **Persistence across restarts** - Cloud Run containers are ephemeral, state must survive restarts
- **Source of truth** - Frontend syncs FROM database, not vice versa (prevents inconsistency)

**What the database does NOT store:**
- Ticket metadata (summary, status, lines) - fetched live from Jira API
- Due dates - stored in Jira, database only stores `locked_week`/`locked_year`

### Hosting & Infrastructure

| Property | Value |
|----------|-------|
| **Provider** | Google Cloud SQL |
| **Engine** | PostgreSQL 15 |
| **Instance Name** | `nomad-db` |
| **Project** | `pw-it-common` |
| **Region** | `europe-west6` (Zurich) |
| **Database Name** | `nomad` |
| **User** | `nomad-user` |

**Connection Method:**

Cloud Run connects via **Cloud SQL Auth Proxy** using Unix sockets (not TCP):

```
postgresql://nomad-user:<password>@/nomad?host=/cloudsql/pw-it-common:europe-west6:nomad-db
```

This provides:
- **No public IP exposure** - Database not accessible from internet
- **IAM-based authentication** - Cloud Run service account has `cloudsql.client` role
- **Encrypted in transit** - All traffic through proxy is TLS-encrypted

### Security Measures

| Measure | Implementation |
|---------|----------------|
| **Network Isolation** | Database has no public IP; only accessible via Cloud SQL Auth Proxy |
| **IAM Authentication** | Cloud Run service account must have `cloudsql.client` role |
| **Strong Password** | 64-character cryptographically random password |
| **TLS Encryption** | All connections encrypted via Cloud SQL Proxy |
| **Connection Pooling** | `asyncpg` pool limits concurrent connections (min: 2, max: 10) |
| **Prepared Statements** | All queries use parameterized queries (no SQL injection) |
| **Principle of Least Privilege** | `nomad-user` only has access to `nomad` database |

**Password storage:** The 64-char password is stored as environment variable `DATABASE_URL` in Cloud Run (encrypted at rest by GCP).

### Connection Configuration

```python
# In database.py
pool = await asyncpg.create_pool(
    DATABASE_URL,
    min_size=2,           # Minimum connections kept open
    max_size=10,          # Maximum concurrent connections
    command_timeout=30,   # Query timeout in seconds
)
```

**Startup behavior:** If database is unreachable on startup, the application **crashes immediately** with a clear error message. There is no in-memory fallback mode - this is intentional to prevent data loss.

### Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE SCHEMA                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │   ticket_schedule   │         │    week_settings    │                    │
│  ├─────────────────────┤         ├─────────────────────┤                    │
│  │ ticket_key (PK)     │         │ year (PK)           │                    │
│  │ priority_order      │         │ week (PK)           │                    │
│  │ in_queue            │         │ capacity            │                    │
│  │ locked_week ────────┼────────►│ small_unlocked      │                    │
│  │ locked_year         │         │ medium_unlocked     │                    │
│  │ scheduled_lines     │         │ updated_at          │                    │
│  │ updated_at          │         └─────────────────────┘                    │
│  └─────────────────────┘                                                    │
│           │                       ┌─────────────────────┐                   │
│           │ (ticket_key links     │   global_settings   │                   │
│           │  to Jira issue key)   ├─────────────────────┤                   │
│           │                       │ key (PK)            │                   │
│           │                       │ value (JSONB)       │                   │
│           │                       │ updated_at          │                   │
│           │                       └─────────────────────┘                   │
│           │                                                                  │
│  ┌────────┼─────────────────────────────────────────────────────────────┐   │
│  │        │              USER & SESSION TABLES                          │   │
│  │        │                                                             │   │
│  │  ┌─────┴───────────────┐      ┌─────────────────────┐               │   │
│  │  │       users         │      │      sessions       │               │   │
│  │  ├─────────────────────┤      ├─────────────────────┤               │   │
│  │  │ id (PK)             │◄─────┤ user_id (FK)        │               │   │
│  │  │ okta_id (UNIQUE)    │      │ token (PK)          │               │   │
│  │  │ email (UNIQUE)      │      │ tab_id              │               │   │
│  │  │ name                │      │ created_at          │               │   │
│  │  │ picture             │      │ expires_at          │               │   │
│  │  │ is_admin            │      │ last_activity       │               │   │
│  │  │ created_at          │      └─────────────────────┘               │   │
│  │  │ last_login          │                │                           │   │
│  │  │ updated_at          │                │                           │   │
│  │  └─────────────────────┘                │                           │   │
│  │            │                            │                           │   │
│  │            │                            │                           │   │
│  │            ▼                            │                           │   │
│  │  ┌─────────────────────┐               │                           │   │
│  │  │   user_activity     │◄──────────────┘                           │   │
│  │  ├─────────────────────┤                                           │   │
│  │  │ id (PK)             │  (audit log references both               │   │
│  │  │ user_id (FK, NULL)  │   user and implicitly session)            │   │
│  │  │ user_email          │                                           │   │
│  │  │ action              │                                           │   │
│  │  │ details (JSONB)     │                                           │   │
│  │  │ ip_address          │                                           │   │
│  │  │ user_agent          │                                           │   │
│  │  │ created_at          │                                           │   │
│  │  └─────────────────────┘                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Table Details

#### `ticket_schedule` - Core scheduling data

```sql
CREATE TABLE ticket_schedule (
    ticket_key VARCHAR(20) PRIMARY KEY,  -- "PRES-1234" (matches Jira issue key)
    priority_order INTEGER,              -- Position in queue (0-indexed), NULL for pool
    in_queue BOOLEAN DEFAULT FALSE,      -- True = in queue, False = in pool/backlog
    locked_week INTEGER,                 -- ISO week number (1-52), TARGET/due date week
    locked_year INTEGER,                 -- Year (2024, 2025, etc.)
    scheduled_lines INTEGER,             -- Lines at time of lock (for mismatch detection)
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Column purposes:**
| Column | Purpose | When Updated |
|--------|---------|--------------|
| `ticket_key` | Links to Jira issue (e.g., "PRES-1234") | On first schedule |
| `priority_order` | Queue position (0 = highest priority) | On drag-and-drop reorder |
| `in_queue` | True = active queue, False = backlog | On move between queue/pool |
| `locked_week` | Target week for due date (Friday of this week) | On lock to week |
| `locked_year` | Year for the locked week | On lock to week |
| `scheduled_lines` | Snapshot of lines at lock time | On lock (for mismatch detection) |

**Important:** `locked_week` stores the TARGET/DUE DATE week. For multi-week tickets, capacity is consumed BACKWARD from this week.

#### `week_settings` - Per-week capacity overrides

```sql
CREATE TABLE week_settings (
    year INTEGER NOT NULL,
    week INTEGER NOT NULL,
    capacity INTEGER,                      -- NULL = use default (4000)
    small_unlocked BOOLEAN DEFAULT FALSE,  -- True = small reservation released
    medium_unlocked BOOLEAN DEFAULT FALSE, -- True = medium reservation released
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (year, week)
);
```

**Use cases:**
- Holiday weeks: reduce capacity to 2000
- Crunch weeks: increase capacity to 5000
- Unlock small/medium: release reserved capacity for big tickets

#### `global_settings` - App configuration

```sql
CREATE TABLE global_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Current keys:**
| Key | Value | Purpose |
|-----|-------|---------|
| `weekly_capacity` | `4000` | Default lines per week |
| `reservation_defaults` | `{"small": 500, "medium": 1500}` | Lines reserved per size |

#### `users` - Okta user records

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    okta_id VARCHAR(255) UNIQUE NOT NULL,  -- Okta "sub" claim (permanent user ID)
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture VARCHAR(512),                  -- Profile picture URL from Okta
    is_admin BOOLEAN DEFAULT FALSE,        -- Synced from Okta group membership
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Sync behavior:** User record created/updated on every login. `is_admin` is re-evaluated from Okta groups on each login.

#### `sessions` - Active login sessions

```sql
CREATE TABLE sessions (
    token VARCHAR(64) PRIMARY KEY,         -- 32-byte random hex token
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tab_id VARCHAR(32),                    -- Browser tab identifier
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,         -- 30 minutes from creation
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Single-tab enforcement:** When a user logs in, their `tab_id` is stored. If they have an existing WebSocket connection with a different `tab_id`, that connection receives a `session_invalidated` message.

#### `user_activity` - Audit log

```sql
CREATE TABLE user_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255) NOT NULL,      -- Denormalized (preserved if user deleted)
    action VARCHAR(50) NOT NULL,           -- Event type
    details JSONB,                         -- Event-specific data
    ip_address VARCHAR(45),                -- Client IP (IPv4 or IPv6)
    user_agent TEXT,                       -- Browser/client identifier
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Action types:** `login`, `logout`, `ticket_scheduled`, `ticket_unscheduled`, `ticket_moved_to_backlog`, `capacity_changed`, `reservation_changed`, `session_invalidated_other_tab`, `ticket_viewed`

### Migration System

Location: `backend/migrations/`

Migrations run automatically on application startup:

1. `001_initial.sql` - Creates `ticket_schedule`, `week_settings`, `global_settings`
2. `002_users.sql` - Creates `users`, `sessions`, `user_activity`
3. `003_add_scheduled_lines.sql` - Adds `scheduled_lines` column for mismatch detection

**Tracking:** Applied migrations recorded in `_migrations` table to prevent re-running.

**Idempotency:** All migrations use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to be safe for re-runs.

---

## Authentication (Okta OIDC)

### Overview

NoMAD uses **Okta OIDC (OpenID Connect)** for authentication. This provides:
- **Single Sign-On (SSO)** - Users authenticate with their Prewave Okta credentials
- **Group-based authorization** - Admin status determined by Okta group membership
- **No password storage** - NoMAD never sees or stores user passwords

### Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Okta Domain | `prewave.okta.com` | `backend/auth.py` |
| Client ID | `OKTA_CLIENT_ID` | Environment variable |
| Client Secret | `OKTA_CLIENT_SECRET` | Environment variable |
| Scopes | `openid profile email groups` | `backend/auth.py` |
| Admin Group ID | `00gsupqfaclQ4pT1Q417` | `backend/auth.py` |
| Admin Group Name | `Nomad Admins` | `backend/auth.py` |
| Redirect URI | `https://nomad.it.prewave.ai/api/auth/callback` | Okta App Config |

### Security Measures

| Measure | Implementation |
|---------|----------------|
| **HTTPS Only** | All OAuth flows require HTTPS; cookies set with `Secure` flag |
| **State Parameter** | Random 32-byte state token prevents CSRF attacks on OAuth callback |
| **HttpOnly Cookies** | Session token stored in HttpOnly cookie (not accessible to JavaScript) |
| **SameSite=Lax** | Cookie only sent with same-site requests (prevents CSRF) |
| **Short Session Lifetime** | Sessions expire after 30 minutes of inactivity |
| **Server-Side Sessions** | Session tokens are opaque; all data stored server-side |
| **Single-Tab Enforcement** | Logging in from new tab invalidates previous sessions |
| **No Token Storage** | Access/ID tokens from Okta are used once and discarded |
| **Group-Based Admin** | Admin status cannot be self-assigned; controlled via Okta groups |

### Authentication Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OIDC AUTHENTICATION FLOW                        │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser                    NoMAD Backend                 Okta
     │                            │                          │
     │ 1. Click "Sign in"         │                          │
     │ ──────────────────────────►│                          │
     │    GET /api/auth/login     │                          │
     │                            │                          │
     │                            │ 2. Generate state token  │
     │                            │    (32 bytes, random)    │
     │                            │    Store in memory       │
     │                            │                          │
     │ 3. 302 Redirect            │                          │
     │ ◄──────────────────────────│                          │
     │    Location: https://prewave.okta.com/oauth2/v1/authorize
     │    ?client_id=<okta-client-id>
     │    &response_type=code
     │    &scope=openid profile email groups
     │    &redirect_uri=https://nomad.it.prewave.ai/api/auth/callback
     │    &state=<random_state>
     │                            │                          │
     │ 4. User authenticates      │                          │
     │ ─────────────────────────────────────────────────────►│
     │    (Okta login page)       │                          │
     │                            │                          │
     │ 5. Okta redirects back     │                          │
     │ ◄─────────────────────────────────────────────────────│
     │    302 to /api/auth/callback?code=xxx&state=yyy       │
     │                            │                          │
     │ 6. Browser follows         │                          │
     │ ──────────────────────────►│                          │
     │    GET /api/auth/callback  │                          │
     │    ?code=xxx&state=yyy     │                          │
     │                            │                          │
     │                            │ 7. Verify state matches  │
     │                            │    (CSRF protection)     │
     │                            │                          │
     │                            │ 8. Exchange code for tokens
     │                            │ ─────────────────────────►│
     │                            │    POST /oauth2/v1/token │
     │                            │    grant_type=authorization_code
     │                            │    code=xxx              │
     │                            │    client_id + secret    │
     │                            │                          │
     │                            │ 9. Receive tokens        │
     │                            │ ◄─────────────────────────│
     │                            │    { access_token,       │
     │                            │      id_token,           │
     │                            │      refresh_token }     │
     │                            │                          │
     │                            │ 10. Get user info        │
     │                            │ ─────────────────────────►│
     │                            │    GET /oauth2/v1/userinfo
     │                            │    Authorization: Bearer │
     │                            │                          │
     │                            │ 11. Receive user info    │
     │                            │ ◄─────────────────────────│
     │                            │    { sub, email, name,   │
     │                            │      picture, groups }   │
     │                            │                          │
     │                            │ 12. Check admin status   │
     │                            │    groups.includes(      │
     │                            │      "Nomad Admins" OR   │
     │                            │      "00gsupqfaclQ4pT1Q417")
     │                            │                          │
     │                            │ 13. Upsert user in DB    │
     │                            │    (by okta_id)          │
     │                            │                          │
     │                            │ 14. Create session       │
     │                            │    - Generate 32-byte token
     │                            │    - Store in DB + cache │
     │                            │    - Set 30 min expiry   │
     │                            │                          │
     │                            │ 15. Invalidate other tabs│
     │                            │    (via WebSocket)       │
     │                            │                          │
     │ 16. 303 Redirect to /      │                          │
     │ ◄──────────────────────────│                          │
     │    Set-Cookie: session_token=<token>; HttpOnly; Secure
     │                            │                          │
     │ 17. Load app               │                          │
     │ ──────────────────────────►│                          │
     │    Cookie sent automatically                          │
     │                            │                          │
```

### Session Management

**Session Creation:**
```python
token = secrets.token_hex(32)  # 64-char hex string
expires_at = datetime.now() + timedelta(minutes=30)

# Store in database
INSERT INTO sessions (token, user_id, tab_id, expires_at) VALUES (...)

# Store in memory cache (for fast lookups)
sessions_cache[token] = session_data

# Set cookie
response.set_cookie(
    "session_token", token,
    httponly=True,      # Not accessible to JavaScript
    secure=True,        # HTTPS only
    samesite="lax",     # CSRF protection
    max_age=1800        # 30 minutes
)
```

**Session Validation (every request):**
```python
# 1. Get token from cookie
token = request.cookies.get("session_token")

# 2. Check memory cache first (fast path)
if token in sessions_cache:
    session = sessions_cache[token]
    if session.expires_at > now:
        return session

# 3. Fall back to database (cold start or cache miss)
session = await db.fetch("SELECT * FROM sessions WHERE token = $1", token)
if session and session.expires_at > now:
    sessions_cache[token] = session  # Warm cache
    return session

# 4. Invalid or expired
raise HTTPException(401, "Session expired")
```

**Session Extension:**
- User can click "Stay logged in" when warning appears (5 min before expiry)
- Extends session by 30 minutes
- Updates `expires_at` in both DB and cache

### Admin Authorization

Admin status is determined by Okta group membership, **not stored in NoMAD**:

```python
# In auth.py - on every login
def check_admin_status(groups: list[str]) -> bool:
    ADMIN_GROUP_ID = "00gsupqfaclQ4pT1Q417"
    ADMIN_GROUP_NAME = "Nomad Admins"
    
    for group in groups:
        if group == ADMIN_GROUP_ID or group == ADMIN_GROUP_NAME:
            return True
    return False
```

**Why check both ID and name?** Okta's userinfo endpoint sometimes returns group IDs, sometimes group names, depending on configuration. Checking both ensures reliable admin detection.

**Admin-only operations:**
- Change weekly capacity
- Change reservation defaults
- Unlock small/medium reservations per week
- View all users (admin portal)
- View full activity log

### Single-Tab Session Enforcement

**Problem:** User opens NoMAD in multiple tabs, makes conflicting changes.

**Solution:** Only one active session per user at a time.

```python
# On WebSocket connect
async def websocket_presence(websocket: WebSocket):
    # Get user from session
    session = await get_session(websocket.cookies.get("session_token"))
    
    # Check for existing connections from same user
    for existing_token, existing_ws in ws_connections.items():
        existing_session = await get_session(existing_token)
        if existing_session and existing_session.user_email == session.user_email:
            if existing_token != session.token:
                # Invalidate old session
                await existing_ws.send_json({
                    "type": "session_invalidated",
                    "reason": "signed_in_elsewhere",
                    "message": "You signed in from another tab"
                })
                await existing_ws.close()
    
    # Register new connection
    ws_connections[session.token] = websocket
```

**User experience:**
1. User has NoMAD open in Tab A
2. User opens NoMAD in Tab B and logs in
3. Tab A receives WebSocket message `session_invalidated`
4. Tab A shows modal: "You signed in from another tab"
5. Tab A logs out automatically

---

## Jira Integration

### Role & Purpose

The Jira API serves as the **source of truth for ticket metadata** and the **target for due date updates**:

**What NoMAD reads FROM Jira:**
- Ticket key, summary, status, assignee
- Total Count (lines to screen) - custom field
- Current due date
- Approval status

**What NoMAD writes TO Jira:**
- Due date (when locking ticket to a week)
- Screening Due date custom field (same value)

**Why Jira, not the database?**
- Tickets are created/managed in Jira by other teams
- Due dates must be visible in Jira for downstream processes
- Total Count can change in Jira (triggers mismatch detection)
- NoMAD is a scheduling overlay, not a ticket replacement

### When Jira API is Invoked

| Trigger | API Call | Purpose |
|---------|----------|---------|
| Page load / refresh | `POST /search/jql` | Fetch all PRES tickets |
| Lock ticket to week | `PUT /issue/{key}` | Set due date fields |
| Unlock ticket | `PUT /issue/{key}` | Clear due date fields |
| Reset mismatch | `PUT /issue/{key}` | Clear due date fields |
| View ticket details | (none - data already cached) | |

**NOT invoked:**
- Drag-and-drop reordering (only updates database)
- Capacity changes (only updates database)
- User login/logout

### Authentication (OAuth 2.0 Service Account)

NoMAD uses a **Jira Service Account** with OAuth 2.0 Client Credentials flow. This means:
- All changes appear as "NoMAD App" in Jira history (not a personal user)
- No user interaction required for token refresh
- Tokens managed automatically by the backend

**Configuration:**

| Setting | Value |
|---------|-------|
| OAuth Client ID | `ATLASSIAN_OAUTH_CLIENT_ID` |
| OAuth Client Secret | `ATLASSIAN_OAUTH_CLIENT_SECRET` |
| Token URL | `https://api.atlassian.com/oauth/token` |
| API Base | `https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3` |
| Cloud ID | Resolved dynamically from accessible resources |

### Security Measures

| Measure | Implementation |
|---------|----------------|
| **OAuth 2.0** | Industry-standard authentication (not basic auth) |
| **Service Account** | Dedicated account with minimal permissions |
| **Token Caching** | Tokens cached in memory, refreshed before expiry |
| **No Token Storage** | Tokens not persisted to disk/database |
| **HTTPS Only** | All API calls over TLS |
| **Scoped Access** | Service account only has access to PRES project |

### Token Lifecycle

```python
class JiraClient:
    # Class-level cached token (shared across requests)
    _access_token: Optional[str] = None
    _token_expires_at: Optional[datetime] = None
    _cloud_id: Optional[str] = None
    
    async def _ensure_token(self):
        """Get valid token, refreshing if needed."""
        now = datetime.now()
        
        # Check if token exists and not expired (with 5 min buffer)
        if self._access_token and self._token_expires_at:
            if now < self._token_expires_at - timedelta(seconds=300):
                return self._access_token
        
        # Request new token
        response = await httpx.post(
            "https://api.atlassian.com/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            }
        )
        
        data = response.json()
        self._access_token = data["access_token"]
        self._token_expires_at = now + timedelta(seconds=data["expires_in"])
        
        return self._access_token
```

### Custom Fields

| Field ID | Jira Name | Type | Purpose |
|----------|-----------|------|---------|
| `customfield_10142` | Total Count | Number | Lines to screen (set by ticket creator) |
| `customfield_10127` | Screening Due date | Date | Due date (set by NoMAD) |

**Field Discovery:** These field IDs are specific to Prewave's Jira instance. They were discovered using the Jira API field metadata endpoint.

### API Operations (Detailed)

#### 1. Fetch All Tickets

**When:** On every page load, refresh, or manual sync

**Request:**
```http
POST https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/search/jql
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "jql": "project = PRES AND status != Done ORDER BY created DESC",
  "maxResults": 500,
  "fields": [
    "summary",
    "status",
    "assignee",
    "duedate",
    "customfield_10142",
    "customfield_10127",
    "created",
    "updated"
  ]
}
```

**Response Processing:**
```python
for issue in response["issues"]:
    ticket = {
        "key": issue["key"],                           # "PRES-1234"
        "summary": issue["fields"]["summary"],
        "status": issue["fields"]["status"]["name"],   # "To Do", "Approved", etc.
        "lines": issue["fields"]["customfield_10142"], # Total Count
        "due_date": issue["fields"]["duedate"],        # "2025-01-10" or null
        "is_approved": status in ["Approved", "In Progress", ...],
        "has_total_count": lines is not None and lines > 0,
    }
```

#### 2. Set Due Date (Lock to Week)

**When:** User locks ticket to a specific week (drag to week or confirm overflow dialog)

**Request:**
```http
PUT https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/PRES-1234
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "fields": {
    "duedate": "2025-01-10",
    "customfield_10127": "2025-01-10"
  }
}
```

**Date Calculation:**
```python
def friday_of_week(week: int, year: int) -> str:
    """Get Friday's date for given ISO week."""
    # ISO week 1 contains Jan 4
    jan4 = date(year, 1, 4)
    # Find Monday of week 1
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    # Calculate target Monday
    target_monday = week1_monday + timedelta(weeks=week - 1)
    # Friday is 4 days after Monday
    friday = target_monday + timedelta(days=4)
    return friday.isoformat()  # "2025-01-10"
```

**Multi-Week Tickets:**
For tickets spanning multiple weeks, the due date is set to Friday of the **final/target week**:
```python
# 4000-line ticket locked to Week 5
# Big capacity = 2000 lines/week
# Spans Week 4 (overspill) + Week 5 (target)
# Due date = Friday of Week 5
```

#### 3. Clear Due Date (Unlock/Reset)

**When:** 
- User unlocks a ticket (removes from locked week)
- User resets a mismatched ticket

**Request:**
```http
PUT https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/PRES-1234
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "fields": {
    "duedate": null,
    "customfield_10127": null
  }
}
```

### Mismatch Detection

**Purpose:** Detect when someone edits a ticket directly in Jira after it was scheduled in NoMAD.

**Detection Logic (on ticket fetch):**
```python
def detect_mismatch(ticket, schedule):
    """Compare Jira data with stored schedule data."""
    mismatches = []
    
    # 1. Date mismatch: Jira due date != expected Friday
    if schedule.locked_week and schedule.locked_year:
        expected_date = friday_of_week(schedule.locked_week, schedule.locked_year)
        if ticket.due_date != expected_date:
            mismatches.append("due_date")
    
    # 2. Lines mismatch: Jira Total Count changed since lock
    if schedule.scheduled_lines:
        if ticket.lines != schedule.scheduled_lines:
            mismatches.append("lines")
    
    return mismatches
```

**UI Behavior:**
- Mismatched tickets show red warning banner
- Banner shows what changed: "Due date changed in Jira" or "Lines changed from X to Y"
- "Reset?" button clears due date and moves ticket to backlog

### Error Handling

| Error | Cause | Handling |
|-------|-------|----------|
| 401 Unauthorized | Token expired | Auto-refresh and retry |
| 403 Forbidden | No access to ticket | Log error, skip ticket |
| 404 Not Found | Ticket deleted in Jira | Remove from schedule |
| 429 Rate Limited | Too many requests | Exponential backoff |
| 500+ Server Error | Jira outage | Retry with backoff |

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         JIRA INTEGRATION DATA FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              JIRA CLOUD
                    ┌─────────────────────────────┐
                    │  PRES Project               │
                    │  ┌───────────────────────┐  │
                    │  │ PRES-1234             │  │
                    │  │ - Summary             │  │
                    │  │ - Status              │  │
                    │  │ - Total Count: 4000   │◄─┼──── Created/edited by
                    │  │ - Due Date: 2025-01-10│  │      product team
                    │  └───────────────────────┘  │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          │ GET /search/jql        │ PUT /issue/{key}       │
          │ (fetch tickets)        │ (set/clear due date)   │
          │                        │                        │
          ▼                        ▼                        │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NoMAD BACKEND                                   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           JiraClient                                   │ │
│  │  - _ensure_token()     : Get/refresh OAuth token                      │ │
│  │  - get_tickets()       : Fetch all PRES tickets                       │ │
│  │  - update_due_date()   : Set due date in Jira                         │ │
│  │  - clear_due_date()    : Remove due date from Jira                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│                                   │ Merge with DB schedule                   │
│                                   ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Ticket Processing                              │ │
│  │  1. Fetch tickets from Jira (metadata)                                 │ │
│  │  2. Fetch schedules from DB (priority, locks)                          │ │
│  │  3. Merge: ticket + schedule                                           │ │
│  │  4. Detect mismatches (due date, lines)                                │ │
│  │  5. Return enriched tickets to frontend                                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
└───────────────────────────────────┼──────────────────────────────────────────┘
                                    │
                                    ▼
                              FRONTEND
                    ┌─────────────────────────────┐
                    │  Displays ticket with:      │
                    │  - Jira metadata (live)     │
                    │  - Schedule info (from DB)  │
                    │  - Mismatch warnings        │
                    └─────────────────────────────┘
```

---

## Frontend Architecture

### File Structure

```
frontend/src/
├── App.tsx                    # Main component, DnD context, routing
├── hooks/
│   ├── useAuth.ts             # Auth state, login/logout, session check
│   ├── useJiraTickets.ts      # Ticket data, queue/pool state, persistence
│   └── usePresence.ts         # WebSocket, cursor sync, presence
├── components/
│   ├── LoginScreen.tsx        # Okta login UI
│   ├── QueueItem.tsx          # Draggable queue ticket + mismatch banner
│   ├── PoolItem.tsx           # Backlog ticket
│   ├── CapacityTimeline.tsx   # Week cards visualization + overspill indicators
│   ├── WeekDetail.tsx         # Week modal with ticket list + overspill section
│   ├── TicketDetail.tsx       # Ticket modal
│   ├── Settings.tsx           # Settings modal
│   ├── AdminPortal.tsx        # User list, activity log
│   ├── SessionWarning.tsx     # Expiry warning
│   ├── UserPresence.tsx       # Online users
│   ├── CursorOverlay.tsx      # Other users' cursors
│   └── Toast.tsx              # Notifications
├── types/
│   └── ticket.ts              # TypeScript interfaces + helpers
└── index.css                  # Global styles, animations, overspill patterns
```

### State Management

**useJiraTickets hook** manages:
- `queueTickets: Ticket[]` - Ordered queue
- `poolTickets: Ticket[]` - Backlog (grouped by size in UI)
- `lockedTickets: Map<string, {week, year}>` - Lock info
- `weekCapacities: Record<string, number>` - Per-week overrides
- `weekReservations: Record<string, {small, medium}>` - Unlock states

**localStorage Keys** (prefix: `pres-scheduler-`):
- `queue` - Queue ticket keys
- `pool` - Pool ticket keys
- `locks` - Lock info map
- `week-capacities` - Capacity overrides
- `week-reservations-v2` - Unlock states
- `reservation-defaults` - Default reservations

### Data Flow

```
1. On load:
   GET /api/tickets
   GET /api/capacity
   
2. Backend response includes:
   - Ticket data from Jira
   - locked_week, locked_year, in_queue from DB
   - has_mismatch, mismatch_type (computed)

3. Frontend:
   - If no localStorage: use backend in_queue to split queue/pool
   - If localStorage: preserve order, but sync locks from backend
   - Backend is SOURCE OF TRUTH for lock state

4. On drag/drop:
   - Update local state immediately
   - POST /api/tickets/priority
   - If locking to week: POST /api/tickets/due-date
```

---

## Queue & Scheduling System

### Week Grouping (v0.1.3)

**Problem solved:** Previously, week dividers appeared chaotically (W52 → W1 → W52 → W1) because locked tickets showed their week label regardless of position.

**Solution:** Queue now groups tickets by week:

```
Week 52 (This week)
├── Priority 1: PRES-2 (450 lines)
├── Priority 2: PRES-3 (2.4k lines)
└── Priority 5: PRES-5 (41 lines)

Week 1
├── Priority 3: PRES-4 (4.0k lines, W52-W1 span)
├── Priority 4: PRES-6 (2.0k lines)
└── Priority 6: PRES-8 (70 lines)
```

**Implementation in `App.tsx` `enrichedQueue` memo:**

```typescript
// Step 1: Calculate effective week for each ticket
const ticketsWithWeeks = queueTickets.map(ticket => ({
  ...ticket,
  effectiveWeek: ticket.locked_week ?? calculateAutoWeek(ticket),
  effectiveYear: ticket.locked_year ?? calculateAutoYear(ticket),
}));

// Step 2: Group by (year, week)
const weekGroups = new Map<string, TicketWithWeek[]>();
ticketsWithWeeks.forEach(t => {
  const key = `${t.effectiveYear}-${t.effectiveWeek.toString().padStart(2, '0')}`;
  weekGroups.get(key)?.push(t) ?? weekGroups.set(key, [t]);
});

// Step 3: Sort week keys chronologically
const sortedWeeks = [...weekGroups.keys()].sort((a, b) => {
  const [yearA, weekA] = a.split('-').map(Number);
  const [yearB, weekB] = b.split('-').map(Number);
  return (yearA * 100 + weekA) - (yearB * 100 + weekB);
});

// Step 4: Sort tickets within each group by original priority
// Step 5: Flatten with single divider per week
```

**Benefits:**
- Week dividers appear exactly ONCE per week
- Chronological flow (W52 → W1 → W2) - no backward jumps
- Priority order maintained within each week
- Capacity changes recalculate weeks but grouping stays cohesive

---

## Multi-Week Ticket Spanning

### Concept

Tickets larger than a single week's capacity automatically span multiple weeks. The system uses **size-specific capacity**:

| Size | Capacity Per Week | Example |
|------|-------------------|---------|
| Small | 500 (or full if unlocked) | 400 lines → 1 week |
| Medium | 1500 (or full if unlocked) | 1200 lines → 1 week |
| Big | 2000 (remaining after reservations) | 4000 lines → 2 weeks |

### Backward Spanning (Locked Tickets)

When a ticket is locked to a week, that week becomes the **TARGET/DUE DATE** week. Capacity is consumed **backward** from that week:

```
Ticket: 4000 lines (Big)
Locked to: Week 5
Big capacity per week: 2000

Week 4: 2000 lines consumed (overspill)
Week 5: 2000 lines consumed (target week)

Display: "W4-W5 🔒 (2w)"
Due date: Friday of Week 5
```

**Implementation (`getBackwardStartWeek`):**

```typescript
const getBackwardStartWeek = (targetWeek, targetYear, lines, ticketSize) => {
  let remaining = lines;
  let currentWeek = targetWeek;
  let weeksNeeded = 0;
  
  while (remaining > 0) {
    const capacity = getSizeCapacity(currentWeek, currentYear, ticketSize);
    remaining -= capacity;
    weeksNeeded++;
    currentWeek--; // Move backward
    if (currentWeek < 1) { currentWeek = 52; currentYear--; }
  }
  
  return { week: startWeek, year: startYear, weeksNeeded };
};
```

### Forward Spanning (Auto-Scheduled Tickets)

Tickets not locked to a specific week span **forward** from the first available week:

```
Ticket: 6000 lines (Big)
First available: Week 52
Big capacity per week: 2000

Week 52: 2000 lines
Week 1: 2000 lines
Week 2: 2000 lines (final)

Display: "W52-W2 (3w)"
```

### Overspill Visualization

When capacity is consumed from earlier weeks due to spanning:

**CapacityTimeline (Week Cards):**
- Striped pattern on capacity bars for overspill portions
- `↩` icon indicates overspill
- Hover tooltip shows which ticket(s) cause the overspill

**WeekDetail (Modal):**
- Striped capacity bars with overspill indicator
- "Overspill from later weeks" section lists tickets due in future weeks that consume capacity in this week
- Each overspill ticket shows its actual due week badge

**CSS Classes (in `index.css`):**
```css
.striped-bg-blue {
  background-image: repeating-linear-gradient(
    45deg, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 2px,
    transparent 2px, transparent 4px
  );
  background-color: theme('colors.blue.500');
}
/* Similar for .striped-bg-amber, .striped-bg-slate */
```

### Capacity Overflow Dialog

When dragging a ticket to a week where it exceeds capacity:

1. Dialog appears: "This exceeds capacity. Schedule across multiple weeks?"
2. Shows which weeks will be used (backward from target)
3. If confirmed:
   - Ticket locks to TARGET week
   - Capacity consumed backward
   - Toast shows span info

---

## Capacity Management

### Capacity Change Warnings

When admin changes a week's capacity, the system warns if:

1. **New capacity < reservations**: "Capacity 330 is less than Small (500) + Medium (1500) reservations. Unlock?"
2. **Scheduled tickets exceed capacity**: Lists affected tickets, offers to move to backlog

**Implementation in `WeekCard` component:**

```typescript
const checkCapacityChange = (newCapacity) => {
  // Check if reservations fit
  const needsSmallUnlock = !unlocks.small && newCapacity < reservationDefaults.small;
  const needsMediumUnlock = !unlocks.medium && newCapacity < (small + medium);
  
  if (needsSmallUnlock || needsMediumUnlock) {
    return { type: 'reservation', needsSmallUnlock, needsMediumUnlock };
  }
  
  // Check if scheduled tickets fit
  if (scheduledLines > newCapacity) {
    return { type: 'overflow', affectedTickets: [...] };
  }
};
```

### Size-Specific Capacity Calculation

```typescript
const getSizeCapacity = (week, year, ticketSize) => {
  const totalCapacity = getWeekCapacity(week, year);
  const unlocks = getWeekUnlocks(week, year);
  
  if (ticketSize === 'small') {
    return unlocks.small ? totalCapacity : reservationDefaults.small;
  } else if (ticketSize === 'medium') {
    return unlocks.medium ? totalCapacity : reservationDefaults.medium;
  } else {
    // Big: remaining after reservations
    const smallReserved = unlocks.small ? 0 : reservationDefaults.small;
    const mediumReserved = unlocks.medium ? 0 : reservationDefaults.medium;
    return Math.max(0, totalCapacity - smallReserved - mediumReserved);
  }
};
```

---

## API Reference

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/login` | GET | No | Redirect to Okta |
| `/api/auth/callback` | GET | No | Handle Okta callback |
| `/api/auth/me` | GET | Yes | Get current user + session info |
| `/api/auth/extend` | POST | Yes | Extend session 30 min |
| `/api/auth/logout` | POST | Yes | Delete session |
| `/api/auth/config` | GET | No | Debug auth config |

### Tickets

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/tickets` | GET | Yes | Fetch all tickets (Jira + DB state) |
| `/api/tickets/priority` | POST | Yes | Save queue order + lock state |
| `/api/tickets/due-date` | POST | Yes | Set due date in Jira |
| `/api/tickets/unlock` | POST | Yes | Clear due date, unlock ticket |
| `/api/tickets/reset-mismatch` | POST | Yes | Clear due date, unschedule, move to pool |
| `/api/tickets/inspect` | POST | Yes | Log ticket view (audit) |

**POST /api/tickets/priority body:**
```json
{
  "tickets": [
    {"key": "PRES-1", "priority_order": 0, "in_queue": true, "locked_week": 5, "locked_year": 2025},
    {"key": "PRES-2", "priority_order": 1, "in_queue": true},
    {"key": "PRES-3", "priority_order": 0, "in_queue": false}
  ]
}
```

**POST /api/tickets/due-date response:**
```json
{
  "success": true,
  "message": "Due date set",
  "weeks_spanned": 2,
  "final_week": 5,
  "final_year": 2025
}
```

### Capacity & Settings

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/capacity` | GET | Yes | Get default capacity + current week |
| `/api/capacity/week` | POST | Admin | Set week capacity |
| `/api/capacity/default` | POST | Admin | Set default capacity |
| `/api/capacity/weeks` | GET | Yes | Get all week overrides |
| `/api/settings` | GET | Yes | Get all settings |
| `/api/settings/reservations` | POST | Admin | Set reservation defaults |
| `/api/reservation/toggle` | POST | Admin | Toggle week unlock |

### Admin

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/users` | GET | Admin | List all users |
| `/api/admin/activity` | GET | Admin | Get activity log |

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Status, version, DB/Okta connectivity |
| `/api/version` | GET | App version |

---

## Real-Time Features

### WebSocket Endpoint

**`/ws/presence`** - Authenticated via session_token cookie

**Messages from server:**
```json
{"type": "presence", "users": [...], "tab_id": "xxx"}
{"type": "cursor", "user": {...}, "cursor": {"x": 100, "y": 200}}
{"type": "user_left", "user": {...}}
{"type": "session_invalidated", "reason": "signed_in_elsewhere", "message": "..."}
{"type": "pong"}
```

**Messages from client:**
```json
{"type": "cursor", "cursor": {"x": 100, "y": 200}}
{"type": "ping"}
```

### Single-Tab Enforcement

```python
# In main.py
ws_connections: dict[str, WebSocket] = {}  # token -> WebSocket

# On new WebSocket connect:
for token, ws in ws_connections.items():
    session = await get_session_by_token(token)
    if session and session.user_email == new_user_email and token != new_token:
        await ws.send_json({"type": "session_invalidated", "reason": "signed_in_elsewhere"})
        await ws.close()
```

### Audit Events

Events sent to n8n webhook (`backend/audit.py`):
- `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`
- `TICKET_SCHEDULED`, `TICKET_UNSCHEDULED`, `TICKET_MOVED_TO_BACKLOG`
- `CAPACITY_CHANGED`, `RESERVATION_CHANGED`
- `SESSION_INVALIDATED_OTHER_TAB`
- `TICKET_VIEWED`

---

## Deployment

### Build & Deploy

```bash
# Build container
docker build --platform linux/amd64 -t gcr.io/pw-it-common/nomad:latest .

# Push to registry
docker push gcr.io/pw-it-common/nomad:latest

# Deploy
gcloud run deploy nomad \
  --image gcr.io/pw-it-common/nomad:latest \
  --project pw-it-common \
  --region europe-west1 \
  --platform managed
```

### Required Environment Variables

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `postgresql://nomad-user:<pw>@/nomad?host=/cloudsql/pw-it-common:europe-west6:nomad-db` |
| `BASE_URL` | `https://nomad.it.prewave.ai` |

### Cloud Run Settings

| Setting | Value |
|---------|-------|
| Region | europe-west1 |
| Memory | 512 MiB |
| CPU | 1 |
| Cloud SQL | pw-it-common:europe-west6:nomad-db |

---

## Key Relationships & Data Flow

### Ticket State Machine

```
                    ┌─────────────────────────────┐
                    │       JIRA (External)       │
                    │  - Total Count              │
                    │  - Due Date                 │
                    │  - Status                   │
                    └─────────────┬───────────────┘
                                  │ GET /api/tickets
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND                                        │
│                                                                          │
│   Jira Data ──────► Merge with DB ──────► Detect Mismatch ──────► Response │
│                           │                     │                        │
│                           │                     │                        │
│   ┌───────────────────────▼─────────────────────▼───────────────────┐   │
│   │                    ticket_schedule                               │   │
│   │  - priority_order                                                │   │
│   │  - in_queue                                                      │   │
│   │  - locked_week/year (TARGET week for due date)                   │   │
│   │  - scheduled_lines (for mismatch detection)                      │   │
│   └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
│                                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
│   │   Queue      │  │   Pool       │  │   Capacity Timeline          │  │
│   │ (by week)    │  │   (by size)  │  │   (with overspill)           │  │
│   └──────┬───────┘  └──────┬───────┘  └──────────────────────────────┘  │
│          │                 │                                             │
│          └─────────────────┴── Drag/Drop ───────────────────────────────►│
│                                    │                                     │
│                    POST /api/tickets/priority                            │
│                    POST /api/tickets/due-date (if locking)               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Multi-Week Spanning Flow

```
User drags 4000-line ticket to Week 5
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ Check: Can fit in one week?                 │
│ Big capacity = 2000 lines/week              │
│ 4000 > 2000 → NO                           │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ Show Capacity Overflow Dialog               │
│ "Schedule across W4-W5 (2 weeks)?"          │
└─────────────┬───────────────────────────────┘
              │ User confirms
              ▼
┌─────────────────────────────────────────────┐
│ Backend: updateDueDate                      │
│ - Calculate final week (Week 5)             │
│ - Set Jira due date to Friday of Week 5     │
│ - Save locked_week=5 to DB                  │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ Frontend: Update display                    │
│ - Queue: "W4-W5 🔒 (2w)"                    │
│ - Timeline Week 4: +2000 overspill (striped)│
│ - Timeline Week 5: +2000 direct             │
└─────────────────────────────────────────────┘
```

---

## Common Issues & Solutions

### "column scheduled_lines does not exist"

**Cause**: Migration 003 not applied.  
**Fix**: Redeploy container - migrations run on startup.

### "Session invalidation not working between tabs"

**Cause**: Container restart loses in-memory WebSocket connections.  
**Fix**: On WebSocket connect, iterate all connections, check session email, invalidate matching.

### "Week shows empty in incognito but filled in regular browser"

**Cause**: Frontend was prioritizing localStorage for lock state.  
**Fix**: Backend is source of truth. Frontend syncs locks FROM backend, not vice versa.

### "Admin can't change settings despite being in admin group"

**Cause**: Checking for group ID only, but Okta returns group name.  
**Fix**: Check for BOTH group ID (`00gsupqfaclQ4pT1Q417`) AND name (`Nomad Admins`).

### "Duplicate W52/W1 week dividers in queue"

**Cause**: Showing week divider for every locked ticket regardless of position.  
**Fix**: Group tickets by week first, then show single divider per group. (v0.1.3)

### "4000/2000 capacity display (impossible)"

**Cause**: Using total capacity instead of size-specific capacity for multi-week calculation.  
**Fix**: Use `getSizeCapacity()` which respects reservations. Big tickets use remaining capacity (2000), not total (4000).

### "Unlocked ticket re-locks on refresh"

**Cause**: Frontend unlock wasn't clearing Jira due date.  
**Fix**: Call `/api/tickets/unlock` which clears Jira `duedate` AND `customfield_10127`.

### "Wnull showing for locked tickets"

**Cause**: JavaScript `null !== undefined` is `true`, so `ticket.locked_week !== undefined` passed for null values.  
**Fix**: Use `ticket.locked_week != null` (loose equality catches both null and undefined).

---

## Code Reference Map

### Backend Key Files

| File | Key Functions/Classes |
|------|----------------------|
| `main.py` | `app`, `websocket_presence()`, `get_tickets()`, `reset_mismatched_ticket()`, `detect_mismatch()` |
| `auth.py` | `create_session()`, `get_session()`, `get_or_create_user()`, `ADMIN_GROUP_*` |
| `database.py` | `init_db()`, `save_ticket_schedules()`, `get_all_ticket_schedules()` |
| `jira_client.py` | `JiraClient`, `_ensure_token()`, `update_due_date()`, `clear_due_date()` |
| `models.py` | `Ticket`, `ScheduleUpdate`, `TicketSchedule`, `DueDateUpdateResponse` |
| `audit.py` | `audit.ticket_scheduled()`, `audit.login_success()`, `audit.session_invalidated_other_tab()` |

### Frontend Key Files

| File | Key Functions/Components |
|------|-------------------------|
| `App.tsx` | `AuthenticatedApp`, drag handlers, `enrichedQueue` (grouped by week), overflow dialog |
| `useJiraTickets.ts` | `fetchData()`, `resetMismatch()`, `unlockTicketApi()`, `saveOrder()`, `lockTicketToWeek()` |
| `useAuth.ts` | `login()`, `logout()`, `checkSession()` |
| `usePresence.ts` | WebSocket connection, cursor broadcasting |
| `CapacityTimeline.tsx` | `WeekCard`, `SizeBar` (with overspill), `calculateWeekUsage()` |
| `WeekDetail.tsx` | `CapacityRow` (with overspill), overspill ticket section |
| `QueueItem.tsx` | Mismatch banner, reset dialog, share link |
| `types/ticket.ts` | `Ticket` interface, `canScheduleTicket()`, `getTicketSize()`, `getScheduledBySize()` |

### Critical Code Paths

**User Login:**
`LoginScreen` → `useAuth.login()` → `/api/auth/login` → Okta → `/api/auth/callback` → `get_or_create_user()` → `create_session()`

**Ticket Lock (with multi-week):**
`App.handleDragEnd()` → Check capacity → Show overflow dialog if needed → `lockTicketToWeek()` → `updateDueDate()` → `/api/tickets/due-date` → `JiraClient.update_due_date()` (calculates final week)

**Mismatch Reset:**
`QueueItem.onResetMismatch()` → `useJiraTickets.resetMismatch()` → `/api/tickets/reset-mismatch` → `JiraClient.clear_due_date()` → DB update → Frontend state update

**Queue Grouping:**
`enrichedQueue` memo → Calculate effective week per ticket → Group by week → Sort chronologically → Flatten with single divider per week

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | Dec 2024 | Initial release with Google OAuth |
| 0.1.1 | Dec 2024 | Okta OIDC, mismatch detection, single-tab sessions, Jira OAuth service account |
| 0.1.2 | Dec 2024 | Multi-week ticket spanning (large tickets auto-span weeks, due date set to final week), overspill visualization |
| 0.1.3 | Dec 2024 | Fixed duplicate week dividers (queue now grouped by week), capacity change warnings, shareable ticket links, enhanced audit logging |
