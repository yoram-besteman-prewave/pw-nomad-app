# Cloud SQL Setup for NoMAD

## Prerequisites
- Google Cloud SDK installed
- Project ID: `pw-it-common`
- Cloud SQL Region: `europe-west6`
- Cloud Run Region: `europe-west1`

## Database Credentials

```
Instance:  nomad-db
Database:  nomad
User:      nomad-user
Password:  <secure-password>
```

## 1. Create Cloud SQL Instance

```bash
# Create PostgreSQL instance
gcloud sql instances create nomad-db \
  --database-version=POSTGRES_17 \
  --tier=db-f1-micro \
  --region=europe-west6 \
  --storage-auto-increase \
  --backup-start-time=02:00

# Create database
gcloud sql databases create nomad --instance=nomad-db

# Create user with secure password
gcloud sql users create nomad-user \
  --instance=nomad-db \
  --password='<secure-password>'
```

## 2. Update Existing User Password

If the user already exists, update the password:

```bash
gcloud sql users set-password nomad-user \
  --instance=nomad-db \
  --password='<secure-password>'
```

## 3. Configure Cloud Run Access

```bash
# Get your project ID
PROJECT_ID=pw-it-common

# Grant Cloud Run service account access to Cloud SQL
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Update Cloud Run service with Cloud SQL connection
gcloud run services update nomad \
  --add-cloudsql-instances=${PROJECT_ID}:europe-west6:nomad-db \
  --region=europe-west1
```

## 4. Set Environment Variables

Set the `DATABASE_URL` environment variable in Cloud Run:

```bash
gcloud run services update nomad \
  --set-env-vars="DATABASE_URL=postgresql://nomad-user:<secure-password>@/nomad?host=/cloudsql/pw-it-common:europe-west6:nomad-db" \
  --region=europe-west1
```

## 5. Verify Connection

Check Cloud Run logs to verify database connection:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=nomad" \
  --limit=50 --format="table(timestamp,textPayload)"
```

Look for:
- `[Database] Connecting to PostgreSQL...`
- `[Database] Connection pool created`
- `[Database] Connected to: PostgreSQL 17.x`
- `[Database] Migrations complete`

Or use the health endpoint:
```bash
curl https://nomad-750886765018.europe-west1.run.app/api/health
```

## Backup Commands

### Manual Backup
```bash
gcloud sql backups create --instance=nomad-db
```

### List Backups
```bash
gcloud sql backups list --instance=nomad-db
```

### Restore from Backup
```bash
gcloud sql backups restore <BACKUP_ID> --restore-instance=nomad-db
```

## Database Schema

The application automatically creates the following tables on startup:

- `ticket_schedule` - Stores ticket queue position and lock status
- `week_settings` - Per-week capacity and reservation unlocks
- `global_settings` - Application-wide settings (JSON)
- `users` - Okta users who have logged in
- `user_activity` - Audit log of user actions
- `sessions` - Active user sessions
- `_migrations` - Migration tracking

## Troubleshooting

### Connection Issues
- Ensure Cloud SQL Admin API is enabled
- Verify IAM permissions for Cloud SQL Client role
- Check Cloud Run has the Cloud SQL instance attached
- Verify DATABASE_URL is set correctly

### Migration Issues
- Check the `_migrations` table for applied migrations
- Review application logs for migration errors
- Migrations are idempotent (safe to rerun)

### Application Won't Start
NoMAD **requires** a working database. If the database is unreachable:
- Application will crash on startup
- Check Cloud Run logs for error messages
- Verify Cloud SQL instance is running
- Verify network connectivity

## Local Development

For local development, you need a PostgreSQL database:

```bash
# Using Docker
docker run --name nomad-postgres \
  -e POSTGRES_USER=nomad-user \
  -e POSTGRES_PASSWORD=<secure-password> \
  -e POSTGRES_DB=nomad \
  -p 5432:5432 \
  -d postgres:17

# Set environment variable
export DATABASE_URL="postgresql://nomad-user:<secure-password>@localhost:5432/nomad"
```
