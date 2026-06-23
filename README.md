# NoMAD - No More Arbitrary Dates

**Version 0.1.1**

A priority-based scheduling application for managing Jira screening tickets with capacity planning, real-time collaboration, and Okta SSO authentication.

---

## What is NoMAD?

NoMAD enables the Prewave Content Screening team to:

- **Prioritize tickets** by dragging them into a queue
- **Schedule tickets** to specific weeks with capacity planning
- **Lock tickets** to weeks with automatic due date sync to Jira
- **Reserve capacity** for small/medium tickets per week
- **Detect mismatches** when Jira data changes after scheduling
- **Collaborate in real-time** with multi-user presence

---

## Features

### Scheduling
- **Priority Queue**: Drag-and-drop interface to order tickets
- **Week Locking**: Lock tickets to specific weeks
- **Automatic Due Dates**: Jira due dates set to Friday of locked week
- **Capacity Timeline**: Visual overview of capacity usage per week

### Capacity Management
- **Weekly Capacity**: Default 4000 lines/week (admin configurable)
- **Reservations**: Reserved capacity for small (500) and medium (1500) tickets
- **Per-Week Overrides**: Customize capacity for specific weeks

### Data Integrity
- **Mismatch Detection**: Red warning when Jira data changes after scheduling
- **Reset Option**: One-click reset for mismatched tickets
- **Database Persistence**: All scheduling state persisted to PostgreSQL

### Authentication & Security
- **Okta SSO**: OIDC authentication via Okta
- **Admin Rights**: Okta group-based admin access
- **Single-Tab Sessions**: Only one active tab per user
- **Audit Logging**: All actions logged for compliance

### Real-Time Collaboration
- **User Presence**: See who's online
- **Cursor Tracking**: See other users' cursors
- **Session Warnings**: 5-minute warning before session expiry

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| Drag & Drop | @dnd-kit |
| Backend | FastAPI (Python 3.11+) |
| Database | PostgreSQL 15+ (Cloud SQL) |
| Auth | Okta OIDC |
| Hosting | Google Cloud Run |
| Container | Docker (linux/amd64) |

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 15+ (local or Cloud SQL)
- Okta account with OIDC app configured

### Local Development

**1. Set up environment:**
```bash
cp env.example .env
# Edit .env with your credentials
```

**2. Start backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**3. Start frontend:**
```bash
cd frontend
npm install
npm run dev
```

**4. Open browser:**
- Frontend: http://localhost:5173
- Backend: http://localhost:8000

---

## Production Deployment

### Build Container
```bash
docker buildx build --platform linux/amd64 -t gcr.io/pw-nomad-app-jmgr8u/nomad:latest .
docker push gcr.io/pw-nomad-app-jmgr8u/nomad:latest
```

### Deploy to Cloud Run
```bash
gcloud run deploy nomad \
  --image gcr.io/pw-nomad-app-jmgr8u/nomad:latest \
  --project pw-nomad-app-jmgr8u \
  --region europe-west1 \
  --platform managed \
  --add-cloudsql-instances pw-nomad-app-jmgr8u:europe-west6:nomad-db \
  --set-env-vars "BASE_URL=https://nomad.it.prewave.ai,OKTA_DOMAIN=prewave.okta.com" \
  --set-secrets "DATABASE_URL=nomad-database-url:latest" \
  --set-secrets "ATLASSIAN_OAUTH_CLIENT_ID=nomad-atlassian-oauth-client-id:latest" \
  --set-secrets "ATLASSIAN_OAUTH_CLIENT_SECRET=nomad-atlassian-oauth-client-secret:latest" \
  --set-secrets "OKTA_CLIENT_ID=nomad-okta-client-id:latest" \
  --set-secrets "OKTA_CLIENT_SECRET=nomad-okta-client-secret:latest"
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BASE_URL` | Yes | Application URL (for Okta redirects) |
| `ATLASSIAN_OAUTH_CLIENT_ID` | Yes | Atlassian OAuth client ID |
| `ATLASSIAN_OAUTH_CLIENT_SECRET` | Yes | Atlassian OAuth client secret |
| `OKTA_DOMAIN` | No | Okta domain, defaults to `prewave.okta.com` |
| `OKTA_CLIENT_ID` | Yes | Okta OIDC client ID |
| `OKTA_CLIENT_SECRET` | Yes | Okta OIDC client secret |
| `PORT` | No | Server port (default: 8080) |

For Cloud Run, `deploy.sh` injects sensitive values from Google Secret Manager:

| Runtime env var | Secret Manager secret |
|-----------------|-----------------------|
| `DATABASE_URL` | `nomad-database-url` |
| `ATLASSIAN_OAUTH_CLIENT_ID` | `nomad-atlassian-oauth-client-id` |
| `ATLASSIAN_OAUTH_CLIENT_SECRET` | `nomad-atlassian-oauth-client-secret` |
| `OKTA_CLIENT_ID` | `nomad-okta-client-id` |
| `OKTA_CLIENT_SECRET` | `nomad-okta-client-secret` |

### Okta Configuration

Configured with environment variables:
- Domain: `OKTA_DOMAIN` (defaults to `prewave.okta.com`)
- Client ID: `OKTA_CLIENT_ID`
- Client secret: `OKTA_CLIENT_SECRET`
- Admin Group: `Nomad Admins`

In Okta Admin Console:
- Sign-in redirect: `https://nomad.it.prewave.ai/api/auth/callback`
- Sign-out redirect: `https://nomad.it.prewave.ai`
- Initiate login: `https://nomad.it.prewave.ai/api/auth/login`

---

## Documentation

| Document | Description |
|----------|-------------|
| [TECHNICAL.md](./TECHNICAL.md) | Comprehensive technical documentation |
| [DATABASE.md](./DATABASE.md) | Database schema and operations |
| [CLOUD_SQL_SETUP.md](./CLOUD_SQL_SETUP.md) | Cloud SQL configuration guide |

---

## Project Structure

```
jira-screening-scheduler/
├── backend/
│   ├── main.py              # FastAPI app, routes, WebSocket
│   ├── auth.py              # Okta OIDC authentication
│   ├── database.py          # PostgreSQL operations
│   ├── jira_client.py       # Jira API integration
│   ├── models.py            # Pydantic models
│   ├── audit.py             # Audit logging
│   └── migrations/          # SQL migrations
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main application
│   │   ├── components/      # UI components
│   │   ├── hooks/           # React hooks
│   │   └── types/           # TypeScript types
│   └── package.json
├── Dockerfile               # Production container
├── docker-compose.yml       # Local development
└── *.md                     # Documentation
```

---

## Key Business Logic

### Ticket Sizes
- **Small**: < 500 lines
- **Medium**: 500-1999 lines
- **Big**: ≥ 2000 lines

### Scheduling Rules
1. Tickets are processed in queue order
2. Cumulative lines determine which week a ticket falls into
3. Locked tickets bypass calculation and stay in their week
4. Reservations reduce available capacity for big tickets

### Jira Integration
- Fetches tickets from PRES board with Total Count field
- Sets due date (standard + Screening Due date custom field) on lock
- Clears due date on reset

---

## Admin Features

Requires membership in `Nomad Admins` Okta group:

- Change default weekly capacity
- Change per-week capacity overrides
- Set reservation defaults
- Unlock reservations early
- View all users and activity log

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/login` | GET | No | Initiate Okta login |
| `/api/auth/callback` | GET | No | Okta callback |
| `/api/auth/me` | GET | Yes | Current user info |
| `/api/tickets` | GET | Yes | Fetch all tickets |
| `/api/tickets/priority` | POST | Yes | Save queue order |
| `/api/tickets/due-date` | POST | Yes | Set ticket due date |
| `/api/tickets/reset-mismatch` | POST | Yes | Reset mismatched ticket |
| `/api/capacity` | GET | Yes | Get capacity config |
| `/api/capacity/week` | POST | Admin | Set week capacity |
| `/api/settings` | GET | Yes | Get all settings |
| `/ws/presence` | WS | Yes | Real-time presence |

---

## Support

For issues or questions, contact the IT team or check the technical documentation.

---

Built for Prewave Content Screening team.
