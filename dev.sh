#!/bin/bash
set -e

# ===========================================
# NoMAD Local Development Startup Script
# Starts: Cloud SQL Auth Proxy, backend, frontend
# ===========================================

PROJECT="pw-nomad-app-jmgr8u"
DB_INSTANCE="${PROJECT}:europe-west6:nomad-db"
DB_URL="${DATABASE_URL:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔════════════════════════════════════════╗"
echo "║       NoMAD Local Dev Startup          ║"
echo "╚════════════════════════════════════════╝"

if [ -z "${DB_URL}" ]; then
    echo "✗  DATABASE_URL must be set before running dev.sh"
    exit 1
fi

# ---- Cloud SQL Auth Proxy ----
if lsof -i :5433 &>/dev/null; then
    echo "✓  Cloud SQL Proxy already running on :5433"
else
    echo "▶  Starting Cloud SQL Auth Proxy on :5433..."
    cloud-sql-proxy "${DB_INSTANCE}" --port 5433 > /tmp/cloud-sql-proxy.log 2>&1 &
    PROXY_PID=$!
    sleep 3
    if ! lsof -i :5433 &>/dev/null; then
        echo "✗  Cloud SQL Proxy failed to start. Check /tmp/cloud-sql-proxy.log"
        exit 1
    fi
    echo "✓  Cloud SQL Proxy running (PID $PROXY_PID)"
fi

# ---- Backend ----
echo "▶  Starting backend on :8000..."
cd "${SCRIPT_DIR}/backend"
if [ ! -d ".venv" ]; then
    echo "   Creating virtualenv..."
    python3.11 -m venv .venv
    .venv/bin/pip install --quiet -r requirements.txt
fi
DATABASE_URL="${DB_URL}" BASE_URL="http://localhost:8000" PORT=8000 \
    .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "✓  Backend running (PID $BACKEND_PID)"

# ---- Frontend ----
echo "▶  Starting frontend on :5173..."
cd "${SCRIPT_DIR}/frontend"
# Load nvm if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 20 --silent 2>/dev/null || true
fi
if [ ! -d "node_modules" ]; then
    echo "   Installing npm dependencies..."
    npm install
fi
NO_COLOR=1 node node_modules/.bin/vite --port 5173 &
FRONTEND_PID=$!
echo "✓  Frontend running (PID $FRONTEND_PID)"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   All services started!                ║"
echo "║   Frontend:  http://localhost:5173     ║"
echo "║   Backend:   http://localhost:8000     ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait and propagate Ctrl+C to all children
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
