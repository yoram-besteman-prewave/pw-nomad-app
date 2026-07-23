import os
import json
import asyncio
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from models import Ticket, ScheduleUpdate, CapacityConfig, TicketSchedule, DueDateUpdate, WeekCapacityUpdate
from jira_client import JiraClient
from auth import (
    get_oauth_auth_url, verify_oauth_state, exchange_code_for_tokens, get_user_info,
    get_or_create_user, create_session, get_session, delete_session,
    User, get_current_user, require_auth, update_user_presence,
    get_active_users, cleanup_expired_sessions, active_users, sessions,
    log_user_activity, set_db_pool,
    get_all_users, get_user_activity_log,
    is_okta_configured, get_okta_config_status,
    SESSION_DURATION_MINUTES, SESSION_WARNING_MINUTES, BASE_URL,
    OKTA_DOMAIN, OKTA_LOGOUT_URL,
)
from audit import audit, AuditEvent
import database as db

load_dotenv()

# Determine if we're in production (Cloud Run sets this)
IS_PRODUCTION = os.getenv("K_SERVICE") is not None or "run.app" in BASE_URL

# App version
APP_VERSION = "0.2.0"


async def handle_tab_invalidation(email: str, old_tab_id: str, reason: str, user_name: str = None, new_tab_id: str = None):
    """Handle tab invalidation - notify WebSocket clients and log audit event"""
    # Find WebSocket connection for this user's old tab
    if email in user_ws_connections:
        conn_info = user_ws_connections[email]
        if conn_info.get("tab_id") == old_tab_id:
            ws = conn_info.get("ws")
            if ws:
                try:
                    await ws.send_text(json.dumps({
                        "type": "session_invalidated",
                        "reason": reason,
                        "message": "You signed into a new tab and were signed out here."
                    }))
                    print(f"[SingleTab] Notified {email} tab {old_tab_id} of invalidation")
                except Exception as e:
                    print(f"[SingleTab] Error notifying WebSocket: {e}")
    
    # Audit log: session invalidated
    audit.session_invalidated_other_tab(
        email=email,
        name=user_name or email,
        old_tab_id=old_tab_id,
        new_tab_id=new_tab_id,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage app lifecycle - startup and shutdown"""
    # Startup
    port = os.getenv("PORT", "8080")
    print(f"[NoMAD] Starting up on port {port}")
    print(f"[NoMAD] Production mode: {IS_PRODUCTION}")
    print(f"[NoMAD] Version: {APP_VERSION}")
    
    # Initialize database
    await db.init_db()
    
    # Share database pool with auth module
    if db.pool:
        set_db_pool(db.pool)
    
    # Register tab invalidation callback for single-tab enforcement
    from auth import register_tab_invalidation_callback
    register_tab_invalidation_callback(handle_tab_invalidation)
    print("[NoMAD] Single-tab session enforcement enabled")
    
    # Load global settings from database
    await load_global_settings()
    
    yield
    
    # Shutdown
    await db.close_db()
    print("[NoMAD] Shutdown complete")


app = FastAPI(
    title="NoMAD",
    description="Priority-based screening scheduler for Jira PRES tickets",
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://localhost:5173", 
        "https://nomad.it.prewave.ai",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Middleware to prevent browser caching of API responses
# This ensures all clients always see fresh Jira data
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# In-memory storage (fallback if DB not available, also serves as cache)
ticket_schedules: dict[str, dict] = {}  # ticket_key -> schedule info
week_settings: dict[str, dict] = {}  # "year-week" -> settings

DEFAULT_WEEKLY_CAPACITY = 4000
SMALL_TICKET_RESERVATION = 500
MEDIUM_TICKET_RESERVATION = 1500

# WebSocket connections for real-time presence
ws_connections: dict[str, WebSocket] = {}
# Track which WebSocket belongs to which user (email -> {token, tab_id, ws})
user_ws_connections: dict[str, dict] = {}


async def load_global_settings():
    """Load global settings from database into memory"""
    global DEFAULT_WEEKLY_CAPACITY, SMALL_TICKET_RESERVATION, MEDIUM_TICKET_RESERVATION
    global ticket_schedules, week_settings
    
    if db.is_connected():
        # Load ticket schedules
        ticket_schedules = await db.get_all_ticket_schedules()
        print(f"[NoMAD] Loaded {len(ticket_schedules)} ticket schedules from database")
        
        # Load week settings
        week_settings = await db.get_all_week_settings()
        print(f"[NoMAD] Loaded {len(week_settings)} week settings from database")
        
        # Load global settings
        capacity = await db.get_global_setting("weekly_capacity")
        if capacity:
            DEFAULT_WEEKLY_CAPACITY = int(capacity) if isinstance(capacity, (int, str)) else capacity.get("value", 4000)
        
        reservations = await db.get_global_setting("reservation_defaults")
        if reservations:
            SMALL_TICKET_RESERVATION = reservations.get("small", 500)
            MEDIUM_TICKET_RESERVATION = reservations.get("medium", 1500)
        
        print(f"[NoMAD] Capacity: {DEFAULT_WEEKLY_CAPACITY}, Small: {SMALL_TICKET_RESERVATION}, Medium: {MEDIUM_TICKET_RESERVATION}")
    else:
        print("[NoMAD] Running without database - using in-memory storage only")


def get_client_info(request: Request) -> tuple[str, str]:
    """Extract client IP and user agent from request"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    
    user_agent = request.headers.get("user-agent", "unknown")
    return ip, user_agent


def get_current_week() -> tuple[int, int]:
    """Get current ISO week number and year"""
    now = datetime.now()
    return now.isocalendar()[1], now.isocalendar()[0]


# =====================
# Authentication Routes (Okta OIDC)
# =====================

@app.get("/api/auth/login")
async def login(request: Request):
    """Redirect to Okta OIDC authorization"""
    try:
        auth_url = get_oauth_auth_url()
        return RedirectResponse(url=auth_url)
    except HTTPException as e:
        return RedirectResponse(url=f"/?error={e.detail}")


@app.get("/api/auth/callback")
async def oauth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle Okta OIDC callback"""
    ip, user_agent = get_client_info(request)
    
    # Handle errors from Okta
    if error:
        audit.login_failed("unknown", f"Okta error: {error}", ip, user_agent)
        return RedirectResponse(url=f"/?error={error}", status_code=303)
    
    if not code:
        audit.login_failed("unknown", "No authorization code received", ip, user_agent)
        return RedirectResponse(url="/?error=no_code", status_code=303)
    
    # Verify state (CSRF protection)
    if state and not verify_oauth_state(state):
        audit.login_failed("unknown", "Invalid state token", ip, user_agent)
        return RedirectResponse(url="/?error=invalid_state", status_code=303)
    
    try:
        # Exchange code for tokens
        tokens = await exchange_code_for_tokens(code)
        access_token = tokens.get("access_token")
        id_token = tokens.get("id_token")
        
        if not access_token:
            audit.login_failed("unknown", "No access token received", ip, user_agent)
            return RedirectResponse(url="/?error=no_token", status_code=303)
        
        # Get user info from Okta
        user_info = await get_user_info(access_token)
        print(f"[Auth] User info from Okta: {user_info}")
        
        user_id = user_info.get("sub")
        
        # Try to get groups from multiple sources
        groups = user_info.get("groups", [])
        
        # Try ID token if not in userinfo
        if not groups and id_token:
            try:
                import base64
                parts = id_token.split(".")
                if len(parts) >= 2:
                    payload = parts[1]
                    payload += "=" * (4 - len(payload) % 4)
                    import json
                    id_token_claims = json.loads(base64.urlsafe_b64decode(payload))
                    print(f"[Auth] ID token claims: {id_token_claims}")
                    groups = id_token_claims.get("groups", [])
            except Exception as e:
                print(f"[Auth] Failed to decode ID token: {e}")
        
        # If still no groups, try fetching via API
        if not groups and user_id:
            from auth import get_user_groups_via_token
            groups = await get_user_groups_via_token(access_token, user_id)
        
        print(f"[Auth] Groups found: {groups}")
        
        email = user_info.get("email")
        if not email:
            audit.login_failed("unknown", "No email in user info", ip, user_agent)
            return RedirectResponse(url="/?error=no_email", status_code=303)
        
        # Get or create user in database
        user = await get_or_create_user(
            okta_id=user_info.get("sub", email),
            email=email,
            name=user_info.get("name", email.split("@")[0]),
            picture=user_info.get("picture", ""),
            groups=groups,
        )
        
        # Create session
        session = await create_session(user)
        
        # Log activity
        await log_user_activity(user, "login", {"method": "okta_oidc"}, ip, user_agent)
        audit.login_success(user.email, user.name, ip, user_agent)
        
        # Redirect to app with session cookie
        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(
            key="session_token",
            value=session.token,
            httponly=True,
            secure=IS_PRODUCTION,
            samesite="lax",
            max_age=SESSION_DURATION_MINUTES * 60,
        )
        return response
        
    except HTTPException as e:
        audit.login_failed("unknown", f"OIDC error: {e.detail}", ip, user_agent)
        return RedirectResponse(url=f"/?error={e.detail}", status_code=303)
    except Exception as e:
        print(f"OIDC Auth error: {e}")
        audit.login_failed("unknown", f"OIDC exception: {str(e)}", ip, user_agent)
        return RedirectResponse(url="/?error=auth_failed", status_code=303)


@app.get("/api/auth/me")
async def get_me(request: Request):
    """Get current user info and session status"""
    token = request.cookies.get("session_token")
    if not token:
        return JSONResponse(status_code=401, content={"authenticated": False})
    
    session = await get_session(token)
    if not session:
        response = JSONResponse(status_code=401, content={"authenticated": False})
        response.delete_cookie("session_token")
        return response
    
    return {
        "authenticated": True,
        "user": {
            "email": session.user.email,
            "name": session.user.name,
            "picture": session.user.picture,
            "is_admin": session.user.is_admin,
        },
        "session": {
            "expires_in_seconds": session.time_remaining_seconds(),
            "should_warn": session.should_warn(),
            "warning_threshold_seconds": SESSION_WARNING_MINUTES * 60,
        }
    }


@app.post("/api/auth/extend")
async def extend_session(request: Request):
    """Extend current session"""
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    session = await get_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    
    session.extend()
    
    response = JSONResponse(content={
        "success": True,
        "expires_in_seconds": session.time_remaining_seconds(),
    })
    response.set_cookie(
        key="session_token",
        value=session.token,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        max_age=SESSION_DURATION_MINUTES * 60,
    )
    return response


@app.post("/api/auth/logout")
async def logout(request: Request):
    """Logout current user"""
    token = request.cookies.get("session_token")
    ip, user_agent = get_client_info(request)
    
    if token:
        session = await get_session(token)
        if session:
            await log_user_activity(session.user, "logout", None, ip, user_agent)
            audit.logout(session.user.email, session.user.name, ip, user_agent)
        await delete_session(token)
        await broadcast_presence_update()
    
    response = JSONResponse(content={"success": True})
    response.delete_cookie("session_token")
    return response


async def require_admin(request: Request) -> User:
    """Require admin privileges for an endpoint"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access(request.url.path, ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    if not user.is_admin:
        ip, user_agent = get_client_info(request)
        print(f"Admin access denied for {user.email} to {request.url.path}")
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return user


# =====================
# Admin Portal API
# =====================

@app.get("/api/admin/users")
async def admin_get_users(request: Request):
    """Get all users who have logged in (admin only)"""
    await require_admin(request)
    
    users = await get_all_users()
    return {"users": users}


@app.get("/api/admin/activity")
async def admin_get_activity_log(request: Request, months: int = 6):
    """Get all user activity from the last N months (admin only)"""
    await require_admin(request)
    
    activity = await get_user_activity_log(months_back=months)
    return {"activity": activity}


@app.post("/api/admin/nuclear-reset")
async def admin_nuclear_reset(request: Request):
    """
    NUCLEAR RESET: Clears all ticket schedules, unlocks all weeks, moves everything to backlog.
    This is a destructive operation for testing purposes only.
    Admin only.
    """
    ip, user_agent = get_client_info(request)
    user = await require_admin(request)
    
    print(f"[NUCLEAR] Nuclear reset initiated by {user.email}")
    
    # Get all scheduled tickets from database
    schedules = await db.get_all_ticket_schedules()
    ticket_keys = list(schedules.keys())
    
    print(f"[NUCLEAR] Found {len(ticket_keys)} tickets to process")
    
    # Clear due dates in Jira for all tickets
    jira = JiraClient()
    cleared_count = 0
    failed_tickets = []
    
    for key in ticket_keys:
        try:
            print(f"[NUCLEAR] Clearing due date for {key}...")
            if jira.clear_due_date(key):
                cleared_count += 1
                print(f"[NUCLEAR] ✓ Cleared due date for {key}")
            else:
                print(f"[NUCLEAR] ✗ Failed to clear {key} (returned false)")
                failed_tickets.append(key)
        except Exception as e:
            print(f"[NUCLEAR] ✗ Exception clearing {key}: {e}")
            failed_tickets.append(key)
    
    # Reset all ticket schedules in database (set locked_week, locked_year, scheduled_lines to NULL, in_queue to FALSE)
    try:
        async with db.pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE ticket_schedule 
                SET locked_week = NULL, 
                    locked_year = NULL, 
                    scheduled_lines = NULL, 
                    in_queue = FALSE
            """)
            print(f"[NUCLEAR] DB update result: {result}")
            
            # Clear all week unlocks
            result2 = await conn.execute("DELETE FROM week_unlocks")
            print(f"[NUCLEAR] Week unlocks delete result: {result2}")
            
            # Reset week capacities to default
            result3 = await conn.execute("DELETE FROM week_capacities")
            print(f"[NUCLEAR] Week capacities delete result: {result3}")
            
        # Also clear in-memory caches
        global ticket_schedules, week_settings
        ticket_schedules.clear()
        week_settings.clear()
            
        print(f"[NUCLEAR] Reset all {len(ticket_keys)} tickets in database")
    except Exception as e:
        print(f"[NUCLEAR] Database reset failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Database reset failed: {str(e)}")
    
    # Audit log with proper event type - await it directly instead of fire-and-forget
    try:
        await audit.log(
            event=AuditEvent.NUCLEAR_RESET,
            user_email=user.email,
            user_name=user.name,
            ip_address=ip,
            user_agent=user_agent,
            details={
                "tickets_cleared": cleared_count,
                "tickets_failed": len(failed_tickets),
                "action": "NUCLEAR_RESET",
            },
            success=True,
        )
        print(f"[NUCLEAR] Audit log posted successfully")
    except Exception as e:
        print(f"[NUCLEAR] Audit log failed: {e}")
    
    print(f"[NUCLEAR] Complete! Cleared {cleared_count} tickets, {len(failed_tickets)} failed")
    
    return {
        "success": True,
        "message": f"Nuclear reset complete. Cleared {cleared_count} tickets.",
        "tickets_cleared": cleared_count,
        "tickets_failed": len(failed_tickets),
        "failed_tickets": failed_tickets[:10]
    }


# =====================
# Real-time Presence
# =====================

async def broadcast_presence_update():
    """Broadcast presence update to all connected clients"""
    users = get_active_users()
    message = json.dumps({"type": "presence", "users": users})
    
    disconnected = []
    for token, ws in ws_connections.items():
        try:
            await ws.send_text(message)
        except:
            disconnected.append(token)
    
    for token in disconnected:
        ws_connections.pop(token, None)


async def broadcast_cursor_update(sender_token: str, cursor_data: dict):
    """Broadcast cursor position to all other clients"""
    session = await get_session(sender_token)
    if not session:
        return
    
    message = json.dumps({
        "type": "cursor",
        "user": {
            "email": session.user.email,
            "name": session.user.name,
            "picture": session.user.picture,
        },
        "cursor": cursor_data,
    })
    
    disconnected = []
    for token, ws in ws_connections.items():
        if token != sender_token:
            try:
                await ws.send_text(message)
            except:
                disconnected.append(token)
    
    for token in disconnected:
        ws_connections.pop(token, None)


async def broadcast_user_left(user: User):
    """Broadcast that a user has left (for cursor cleanup)"""
    message = json.dumps({
        "type": "user_left",
        "user": {
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
        },
    })
    
    disconnected = []
    for token, ws in ws_connections.items():
        try:
            await ws.send_text(message)
        except:
            disconnected.append(token)
    
    for token in disconnected:
        ws_connections.pop(token, None)


async def broadcast_data_update(change_type: str, changed_by: str = None, details: dict = None):
    """Broadcast that data has changed - all clients should refresh
    
    change_type: 'queue_order', 'capacity', 'week_settings', 'ticket_locked', 'ticket_unlocked'
    changed_by: email of user who made the change (excluded from broadcast)
    details: optional dict with change details
    """
    message = json.dumps({
        "type": "data_updated",
        "change_type": change_type,
        "changed_by": changed_by,
        "details": details or {},
        "timestamp": datetime.utcnow().isoformat(),
    })
    
    disconnected = []
    for token, ws in ws_connections.items():
        try:
            await ws.send_text(message)
        except:
            disconnected.append(token)
    
    for token in disconnected:
        ws_connections.pop(token, None)
    
    print(f"[Sync] Broadcast data_updated: {change_type} by {changed_by}")


@app.websocket("/ws/presence")
async def websocket_presence(websocket: WebSocket):
    """WebSocket endpoint for real-time presence"""
    token = websocket.cookies.get("session_token")
    
    if not token:
        token = websocket.query_params.get("token")
    
    if not token:
        await websocket.close(code=4001, reason="No session token")
        return
    
    session = await get_session(token, check_tab=False)  # Don't invalidate during WS connect
    if not session:
        await websocket.close(code=4001, reason="Invalid or expired session")
        return
    
    await websocket.accept()
    
    ws_connections[token] = websocket
    
    # Check if there's already a WebSocket for this user from a different tab
    old_conn = user_ws_connections.get(session.user.email)
    if old_conn and old_conn.get("tab_id") != session.tab_id:
        old_ws = old_conn.get("ws")
        if old_ws:
            try:
                await old_ws.send_text(json.dumps({
                    "type": "session_invalidated",
                    "reason": "signed_in_elsewhere",
                    "message": "You signed into a new tab and were signed out here."
                }))
                print(f"[SingleTab] Notified {session.user.email} old tab of invalidation")
                await old_ws.close()
            except Exception as e:
                print(f"[SingleTab] Error closing old WebSocket: {e}")
    
    # Track this WebSocket by user email for single-tab enforcement
    user_ws_connections[session.user.email] = {
        "token": token,
        "tab_id": session.tab_id,
        "ws": websocket,
    }
    
    update_user_presence(token)
    
    print(f"Presence: {session.user.name} connected (tab: {session.tab_id})")
    
    await websocket.send_text(json.dumps({
        "type": "presence",
        "users": get_active_users(exclude_token=token),
        "tab_id": session.tab_id,  # Send tab_id to client
    }))
    
    await broadcast_presence_update()
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg.get("type") == "cursor":
                cursor = msg.get("cursor", {})
                update_user_presence(token, cursor.get("x"), cursor.get("y"))
                await broadcast_cursor_update(token, cursor)
            
            elif msg.get("type") == "ping":
                update_user_presence(token)
                # Check if session is still valid (tab not invalidated)
                current_session = await get_session(token)
                if not current_session:
                    await websocket.send_text(json.dumps({
                        "type": "session_invalidated",
                        "reason": "signed_in_elsewhere",
                        "message": "You signed into a new tab and were signed out here."
                    }))
                else:
                    await websocket.send_text(json.dumps({"type": "pong"}))
                
    except WebSocketDisconnect:
        print(f"Presence: {session.user.name} disconnected")
    except Exception as e:
        print(f"WebSocket error for {session.user.name}: {e}")
    finally:
        ws_connections.pop(token, None)
        if token in active_users:
            del active_users[token]
        await broadcast_user_left(session.user)
        await broadcast_presence_update()


@app.get("/api/presence")
async def get_presence(request: Request):
    """Get current active users (HTTP fallback)"""
    token = request.cookies.get("session_token")
    return {"users": get_active_users(exclude_token=token)}


# =====================
# Health Check & Version
# =====================

@app.get("/api/health")
async def health_check():
    """Health check endpoint for Cloud Run"""
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "production": IS_PRODUCTION,
        "base_url": BASE_URL,
        "database": "connected" if db.is_connected() else "not connected",
        "okta": "configured" if is_okta_configured() else "not configured",
    }


@app.get("/api/version")
async def get_version():
    """Get app version"""
    return {"version": APP_VERSION}


@app.get("/api/auth/config")
async def get_auth_config():
    """
    Get authentication configuration status.
    Useful for debugging Okta setup.
    Does not expose sensitive values.
    """
    return get_okta_config_status()


# =====================
# Ticket Routes
# =====================

def get_expected_due_date(week: int, year: int) -> datetime:
    """Calculate the expected Friday due date for a given week/year"""
    from datetime import datetime, timedelta
    jan4 = datetime(year, 1, 4)  # Jan 4 is always in week 1
    days_to_monday = jan4.weekday()
    week1_monday = jan4 - timedelta(days=days_to_monday)
    target_monday = week1_monday + timedelta(weeks=week - 1)
    friday = target_monday + timedelta(days=4)  # Friday
    return friday


def detect_mismatch(ticket: Ticket, schedule: dict) -> tuple[bool, str | None]:
    """
    Detect if there's a mismatch between Jira data and NoMAD schedule.
    Returns (has_mismatch, mismatch_type) where mismatch_type is "date", "lines", or "both"
    """
    locked_week = schedule.get("locked_week")
    locked_year = schedule.get("locked_year")
    scheduled_lines = schedule.get("scheduled_lines")
    
    if not locked_week or not locked_year:
        return False, None
    
    date_mismatch = False
    lines_mismatch = False
    
    # Check date mismatch
    expected_due = get_expected_due_date(locked_week, locked_year)
    if ticket.due_date:
        # Compare just the date part (ignore time)
        jira_date = ticket.due_date.date() if hasattr(ticket.due_date, 'date') else ticket.due_date
        expected_date = expected_due.date()
        if jira_date != expected_date:
            date_mismatch = True
    else:
        # Due date was cleared in Jira
        date_mismatch = True
    
    # Check lines mismatch (only if we have scheduled_lines)
    if scheduled_lines is not None and ticket.lines != scheduled_lines:
        lines_mismatch = True
    
    if date_mismatch and lines_mismatch:
        return True, "both"
    elif date_mismatch:
        return True, "date"
    elif lines_mismatch:
        return True, "lines"
    
    return False, None


@app.get("/api/tickets", response_model=list[Ticket])
async def get_tickets(request: Request):
    """Fetch all eligible screening tickets from the selected Jira board/project"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        client = JiraClient()
        project_key = (
            request.query_params.get("project_key")
            or request.query_params.get("project")
            or JiraClient.PRES_PROJECT_KEY
        ).upper()
        allowed_project_keys = {JiraClient.PRES_PROJECT_KEY, JiraClient.PREMAP_PROJECT_KEY}
        if project_key not in allowed_project_keys:
            raise HTTPException(status_code=400, detail=f"Unsupported Jira project: {project_key}")

        tickets = client.get_screening_tickets(project_key=project_key)
        
        # Apply saved priority order, lock info, and queue status from database/cache
        # Also detect mismatches between Jira and NoMAD
        for ticket in tickets:
            if ticket.key in ticket_schedules:
                schedule = ticket_schedules[ticket.key]
                ticket.priority_order = schedule.get("priority_order")
                ticket.locked_week = schedule.get("locked_week")
                ticket.locked_year = schedule.get("locked_year")
                ticket.in_queue = schedule.get("in_queue", False)
                ticket.scheduled_lines = schedule.get("scheduled_lines")
                ticket.was_auto_returned = schedule.get("was_auto_returned", False)
                ticket.fst_key = schedule.get("fst_key")
                
                # Detect mismatches for scheduled tickets
                if ticket.locked_week and ticket.locked_year:
                    has_mismatch, mismatch_type = detect_mismatch(ticket, schedule)
                    ticket.has_mismatch = has_mismatch
                    ticket.mismatch_type = mismatch_type
            else:
                # New ticket with no saved schedule: auto-enqueue if it has both
                # an attachment and a line count so it skips the backlog.
                if ticket.has_screening_link and ticket.has_total_count:
                    ticket.in_queue = True
        
        # Sort: prioritized tickets first (by order), then unprioritized (by lines desc)
        def sort_key(t: Ticket):
            if t.priority_order is not None:
                return (0, t.priority_order)
            return (1, -t.lines)
        
        tickets.sort(key=sort_key)
        
        return tickets
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch tickets: {str(e)}")


@app.post("/api/tickets/priority")
async def update_priority(update: ScheduleUpdate, request: Request):
    """Save the ticket priority ordering"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/priority", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    
    # Update in-memory cache and detect changes
    schedules_to_save = []
    for ts in update.tickets:
        # Preserve existing scheduled_lines if not being updated
        existing = ticket_schedules.get(ts.key, {})
        
        # Detect if ticket is being unlocked (was locked, now not locked)
        was_locked = existing.get("locked_week") is not None
        now_locked = ts.locked_week is not None
        
        if was_locked and not now_locked:
            # Ticket is being unlocked
            audit.ticket_unscheduled(
                email=user.email,
                name=user.name,
                ticket_key=ts.key,
                previous_week=existing.get("locked_week"),
                previous_year=existing.get("locked_year"),
                ip_address=ip,
                user_agent=user_agent,
            )
        
        # Detect if ticket is being moved to backlog (was in queue, now not)
        was_in_queue = existing.get("in_queue", False)
        now_in_queue = ts.in_queue
        
        if was_in_queue and not now_in_queue:
            # Ticket is being moved to backlog
            audit.ticket_moved_to_backlog(
                email=user.email,
                name=user.name,
                ticket_key=ts.key,
                previous_week=existing.get("locked_week"),
                previous_year=existing.get("locked_year"),
                ip_address=ip,
                user_agent=user_agent,
            )
        
        # Clear was_auto_returned when ticket is rescheduled (locked to a week)
        was_auto_returned = existing.get("was_auto_returned", False)
        if ts.locked_week is not None and ts.locked_year is not None:
            was_auto_returned = False  # Clear the flag when rescheduled
        
        ticket_schedules[ts.key] = {
            "priority_order": ts.priority_order,
            "in_queue": ts.in_queue,
            "locked_week": ts.locked_week,
            "locked_year": ts.locked_year,
            "scheduled_lines": existing.get("scheduled_lines"),
            "was_auto_returned": was_auto_returned,
        }
        schedules_to_save.append({
            "key": ts.key,
            "priority_order": ts.priority_order,
            "in_queue": ts.in_queue,
            "locked_week": ts.locked_week,
            "locked_year": ts.locked_year,
            "scheduled_lines": existing.get("scheduled_lines"),
            "was_auto_returned": was_auto_returned,
        })
    
    # Persist to database
    await db.save_ticket_schedules(schedules_to_save)
    
    # Broadcast to all clients that data has changed
    await broadcast_data_update("queue_order", user.email, {"ticket_count": len(update.tickets)})
    
    return {"status": "success", "updated": len(update.tickets)}


@app.post("/api/tickets/due-date")
async def update_due_date(update: DueDateUpdate, request: Request):
    """Update the due date of a ticket. For large tickets (>capacity), sets due date to end of final week."""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/due-date", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    
    try:
        client = JiraClient()
        
        ticket_details = client.get_ticket_details(update.ticket_key)
        ticket_summary = ticket_details.summary if ticket_details else None
        ticket_lines = update.lines if update.lines > 0 else (ticket_details.lines if ticket_details else 0)

        if ticket_details and not ticket_details.has_screening_link:
            raise HTTPException(
                status_code=400,
                detail="Screening List Link is missing - add the URL to the ticket in Jira before scheduling"
            )
        
        # Pass lines and capacity to calculate multi-week spanning
        success, final_week, final_year = client.update_due_date(
            update.ticket_key, 
            update.week, 
            update.year, 
            lines=ticket_lines,
            weekly_capacity=DEFAULT_WEEKLY_CAPACITY
        )
        
        if success:
            from datetime import datetime, timedelta
            # Calculate Friday of the FINAL week (not start week)
            jan4 = datetime(final_year, 1, 4)
            days_to_monday = jan4.weekday()
            week1_monday = jan4 - timedelta(days=days_to_monday)
            target_monday = week1_monday + timedelta(weeks=final_week - 1)
            friday = target_monday + timedelta(days=4)
            due_date_str = friday.strftime('%Y-%m-%d')
            
            # Store scheduled_lines for mismatch detection
            if update.ticket_key in ticket_schedules:
                ticket_schedules[update.ticket_key]["scheduled_lines"] = ticket_lines
                # Save to database
                await db.save_ticket_schedules([{
                    "key": update.ticket_key,
                    **ticket_schedules[update.ticket_key],
                }])
            
            weeks_spanned = ((ticket_lines + DEFAULT_WEEKLY_CAPACITY - 1) // DEFAULT_WEEKLY_CAPACITY) if ticket_lines > DEFAULT_WEEKLY_CAPACITY else 1
            
            # Audit: ticket locked to week
            audit.ticket_locked(
                email=user.email,
                name=user.name,
                ticket_key=update.ticket_key,
                week=update.week,
                year=update.year,
                ticket_summary=ticket_summary,
                ticket_lines=ticket_lines,
                ip_address=ip,
                user_agent=user_agent,
            )
            # Audit: due date set
            audit.ticket_due_date_set(
                email=user.email,
                name=user.name,
                ticket_key=update.ticket_key,
                week=final_week,  # Log the final week
                year=final_year,
                ticket_summary=ticket_summary,
                ticket_lines=ticket_lines,
                due_date=due_date_str,
                ip_address=ip,
                user_agent=user_agent,
            )
            
            # Also log to database for Admin Portal activity log
            await log_user_activity(user, "ticket_locked", {
                "ticket_key": update.ticket_key,
                "week": update.week,
                "year": update.year,
                "week_label": f"W{update.week}/{update.year}",
                "due_date": due_date_str,
                "ticket_lines": ticket_lines,
            }, ip, user_agent)
            
            # Broadcast to all clients
            await broadcast_data_update("ticket_locked", user.email, {
                "ticket_key": update.ticket_key,
                "week": final_week,
                "year": final_year,
            })
            
            return {
                "status": "success", 
                "ticket_key": update.ticket_key,
                "start_week": update.week,
                "start_year": update.year,
                "final_week": final_week,
                "final_year": final_year,
                "weeks_spanned": weeks_spanned,
                "due_date": due_date_str,
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update due date in Jira")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update due date: {str(e)}")


@app.post("/api/tickets/reset-mismatch")
async def reset_mismatched_ticket(request: Request):
    """Reset a mismatched ticket - clear due date in Jira and unschedule in NoMAD"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/reset-mismatch", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    ticket_key = body.get("ticket_key")
    
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticket_key is required")
    
    try:
        client = JiraClient()
        
        # Clear the due date in Jira
        success = client.clear_due_date(ticket_key)
        
        if success:
            # Get previous schedule info for audit
            previous_week = None
            previous_year = None
            if ticket_key in ticket_schedules:
                previous_week = ticket_schedules[ticket_key].get("locked_week")
                previous_year = ticket_schedules[ticket_key].get("locked_year")
            
            # Unschedule in NoMAD - remove lock and move to pool
            if ticket_key in ticket_schedules:
                ticket_schedules[ticket_key]["locked_week"] = None
                ticket_schedules[ticket_key]["locked_year"] = None
                ticket_schedules[ticket_key]["in_queue"] = False
                ticket_schedules[ticket_key]["scheduled_lines"] = None
                
                # Save to database
                await db.save_ticket_schedules([{
                    "key": ticket_key,
                    **ticket_schedules[ticket_key],
                }])
            
            # Audit log: mismatch reset
            audit.ticket_mismatch_reset(
                email=user.email,
                name=user.name,
                ticket_key=ticket_key,
                mismatch_type=body.get("mismatch_type", "unknown"),
                ip_address=ip,
                user_agent=user_agent,
            )
            
            # Also log to database for Admin Portal activity log
            await log_user_activity(user, "ticket_mismatch_reset", {
                "ticket_key": ticket_key,
                "mismatch_type": body.get("mismatch_type", "unknown"),
                "previous_week": previous_week,
                "previous_year": previous_year,
            }, ip, user_agent)
            
            print(f"[Mismatch] Reset ticket {ticket_key} by {user.email}")
            return {"status": "success", "ticket_key": ticket_key}
        else:
            raise HTTPException(status_code=500, detail="Failed to clear due date in Jira")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset ticket: {str(e)}")


@app.post("/api/tickets/unlock")
async def unlock_ticket(request: Request):
    """Unlock a ticket - clear due date in Jira and remove lock in NoMAD"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/unlock", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    ticket_key = body.get("ticket_key")
    
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticket_key is required")
    
    try:
        # Get previous schedule info for audit
        previous_week = None
        previous_year = None
        if ticket_key in ticket_schedules:
            previous_week = ticket_schedules[ticket_key].get("locked_week")
            previous_year = ticket_schedules[ticket_key].get("locked_year")
        
        # ALWAYS clear Jira due date - tickets in queue have auto-calculated due dates
        # even when not explicitly locked to a week
        client = JiraClient()
        success = client.clear_due_date(ticket_key)
        if success:
            print(f"[Unlock] Cleared Jira due date for {ticket_key}")
        else:
            print(f"[Unlock] Warning: Could not clear Jira due date for {ticket_key}")
        
        # Update NoMAD - remove lock but keep in queue
        if ticket_key in ticket_schedules:
            ticket_schedules[ticket_key]["locked_week"] = None
            ticket_schedules[ticket_key]["locked_year"] = None
            ticket_schedules[ticket_key]["scheduled_lines"] = None  # Clear scheduled lines too
            
            # Save to database
            await db.save_ticket_schedules([{
                "key": ticket_key,
                **ticket_schedules[ticket_key],
            }])
        else:
            # Create schedule entry if it doesn't exist
            ticket_schedules[ticket_key] = {
                "priority_order": 0,
                "in_queue": True,
                "locked_week": None,
                "locked_year": None,
                "scheduled_lines": None,
            }
            await db.save_ticket_schedules([{
                "key": ticket_key,
                **ticket_schedules[ticket_key],
            }])
        
        # Audit log - ticket unlocked
        audit.ticket_unlocked(
            email=user.email,
            name=user.name,
            ticket_key=ticket_key,
            previous_week=previous_week,
            previous_year=previous_year,
            ip_address=ip,
            user_agent=user_agent,
        )
        
        # Also log to database for Admin Portal activity log
        await log_user_activity(user, "ticket_unlocked", {
            "ticket_key": ticket_key,
            "previous_week": previous_week,
            "previous_year": previous_year,
            "previous_week_label": f"W{previous_week}/{previous_year}" if previous_week else None,
        }, ip, user_agent)
        
        # Broadcast to all clients
        await broadcast_data_update("ticket_unlocked", user.email, {"ticket_key": ticket_key})
        
        print(f"[Unlock] Ticket {ticket_key} unlocked by {user.email}")
        return {"status": "success", "ticket_key": ticket_key}
    except Exception as e:
        print(f"[Unlock] Error unlocking {ticket_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to unlock ticket: {str(e)}")


@app.post("/api/tickets/auto-return")
async def mark_tickets_auto_returned(request: Request):
    """
    Mark tickets as auto-returned from expired state.
    Called when frontend automatically moves expired tickets back to the queue.
    """
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/auto-return", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    ticket_keys = body.get("ticket_keys", [])
    
    if not ticket_keys:
        raise HTTPException(status_code=400, detail="ticket_keys is required")
    
    try:
        schedules_to_save = []
        for ticket_key in ticket_keys:
            if ticket_key in ticket_schedules:
                # Mark as auto-returned and unlock
                ticket_schedules[ticket_key]["was_auto_returned"] = True
                ticket_schedules[ticket_key]["locked_week"] = None
                ticket_schedules[ticket_key]["locked_year"] = None
                ticket_schedules[ticket_key]["scheduled_lines"] = None
                schedules_to_save.append({
                    "key": ticket_key,
                    **ticket_schedules[ticket_key],
                })
            else:
                # Create new entry
                ticket_schedules[ticket_key] = {
                    "priority_order": 0,
                    "in_queue": True,
                    "locked_week": None,
                    "locked_year": None,
                    "scheduled_lines": None,
                    "was_auto_returned": True,
                }
                schedules_to_save.append({
                    "key": ticket_key,
                    **ticket_schedules[ticket_key],
                })
            
            # Clear due date in Jira
            try:
                client = JiraClient()
                client.clear_due_date(ticket_key)
            except Exception as e:
                print(f"[AutoReturn] Warning: Could not clear Jira due date for {ticket_key}: {e}")
        
        # Save to database
        await db.save_ticket_schedules(schedules_to_save)
        
        print(f"[AutoReturn] Marked {len(ticket_keys)} ticket(s) as auto-returned by system")
        
        # Broadcast to all clients
        await broadcast_data_update("tickets_auto_returned", "system", {"ticket_keys": ticket_keys})
        
        return {"status": "success", "ticket_keys": ticket_keys}
    except Exception as e:
        print(f"[AutoReturn] Error marking tickets as auto-returned: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to mark tickets: {str(e)}")


@app.post("/api/tickets/approve")
async def approve_ticket(request: Request):
    """
    Approve a ticket via Jira transition (admin only).
    This transitions the ticket to 'Approved' status in Jira.
    Only tickets that have valid line count and are not already approved can be approved.
    """
    user = await require_admin(request)
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    ticket_key = body.get("ticket_key")
    # Agreed (scheduled) start week for the ticket, sent by the frontend so the FST
    # ticket can be created and scheduled to it at approval time. Optional.
    agreed_week = body.get("week")
    agreed_year = body.get("year")
    
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticket_key is required")
    
    try:
        client = JiraClient()
        
        # Get ticket details to validate it's eligible for approval
        ticket = client.get_ticket_details(ticket_key)
        if not ticket:
            raise HTTPException(status_code=404, detail=f"Ticket {ticket_key} not found")
        
        # Check eligibility
        if not ticket.has_total_count:
            raise HTTPException(status_code=400, detail=f"Ticket {ticket_key} is missing line count - cannot approve")
        
        if ticket.is_approved:
            raise HTTPException(status_code=400, detail=f"Ticket {ticket_key} is already approved")
        
        if ticket.is_jumped:
            raise HTTPException(status_code=400, detail=f"Ticket {ticket_key} has already been handed off")
        
        # Approve: transition to Approved, create the FST ticket, schedule it to the
        # agreed week, and link FST <-> PRES.
        result = client.process_approved_ticket(
            ticket_key,
            week=agreed_week,
            year=agreed_year,
            lines=ticket.lines,
            weekly_capacity=DEFAULT_WEEKLY_CAPACITY,
        )
        
        if result.get("success"):
            fst_key = result.get("fst_key")
            fst_warning = result.get("fst_warning")
            # Lock the PRES ticket to the agreed (delivery) week so it can't drift
            # away from the FST copy. Fall back to the requested week if the backend
            # couldn't compute the final week.
            locked_week = result.get("locked_week") if result.get("locked_week") is not None else agreed_week
            locked_year = result.get("locked_year") if result.get("locked_year") is not None else agreed_year
            
            # Persist the FST key + lock on the ticket's schedule so the board and the
            # later jump step know the ticket has been handed off and pinned.
            if fst_key or locked_week is not None:
                sched = ticket_schedules.get(ticket_key) or {
                    "priority_order": 0,
                    "in_queue": True,
                    "locked_week": None,
                    "locked_year": None,
                }
                if fst_key:
                    sched["fst_key"] = fst_key
                if locked_week is not None:
                    sched["locked_week"] = locked_week
                    sched["locked_year"] = locked_year
                ticket_schedules[ticket_key] = sched
                await db.save_ticket_schedules([{
                    "key": ticket_key,
                    **sched,
                }])
            
            # Log the approval action
            await log_user_activity(user, "ticket_approved", {
                "ticket_key": ticket_key,
                "ticket_summary": ticket.summary,
                "ticket_lines": ticket.lines,
                "fst_key": fst_key,
                "locked_week": locked_week,
                "locked_year": locked_year,
            }, ip, user_agent)
            
            # Broadcast to all clients that a ticket was approved
            await broadcast_data_update("ticket_approved", user.email, {
                "ticket_key": ticket_key,
                "fst_key": fst_key,
                "locked_week": locked_week,
                "locked_year": locked_year,
            })
            
            print(f"[EC] Ticket {ticket_key} approved by {user.email} -> FST {fst_key} "
                  f"(locked W{locked_week}/{locked_year})")
            message = f"Ticket {ticket_key} has been approved"
            if fst_key:
                message += f" and handed off to {fst_key}"
            return {
                "status": "success",
                "ticket_key": ticket_key,
                "fst_key": fst_key,
                "fst_warning": fst_warning,
                "locked_week": locked_week,
                "locked_year": locked_year,
                "message": message,
            }
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Failed to approve {ticket_key}: {result.get('error', 'Unknown error')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[EC] Error approving {ticket_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to approve ticket: {str(e)}")


@app.post("/api/tickets/jump")
async def jump_ticket(request: Request):
    """
    Jump a ticket: transition to 'Jumped' status, create FST copy, and link them.
    This is triggered when an approved ticket's scheduled week has started.
    """
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/tickets/jump", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    ticket_key = body.get("ticket_key")
    project_key = (body.get("project_key") or body.get("project") or JiraClient.PRES_PROJECT_KEY).upper()
    
    if not ticket_key:
        raise HTTPException(status_code=400, detail="ticket_key is required")
    allowed_project_keys = {JiraClient.PRES_PROJECT_KEY, JiraClient.PREMAP_PROJECT_KEY}
    if project_key not in allowed_project_keys:
        raise HTTPException(status_code=400, detail=f"Unsupported Jira project: {project_key}")
    
    try:
        client = JiraClient()
        
        # Execute the jump workflow
        result = client.process_jumped_ticket(ticket_key)
        
        if result["success"]:
            # The FST ticket is created at approval time, so prefer the already-stored
            # fst_key; fall back to whatever the jump lookup found. Never overwrite an
            # existing key with None.
            existing_fst_key = (ticket_schedules.get(ticket_key) or {}).get("fst_key")
            fst_key = existing_fst_key or result.get("fst_key")
            
            # Save fst_key to database
            if ticket_key in ticket_schedules:
                if fst_key:
                    ticket_schedules[ticket_key]["fst_key"] = fst_key
                await db.save_ticket_schedules([{
                    "key": ticket_key,
                    **ticket_schedules[ticket_key],
                }])
            else:
                ticket_schedules[ticket_key] = {
                    "priority_order": 0,
                    "in_queue": True,
                    "locked_week": None,
                    "locked_year": None,
                    "fst_key": fst_key,
                }
                await db.save_ticket_schedules([{
                    "key": ticket_key,
                    **ticket_schedules[ticket_key],
                }])
            
            # Log the jump action
            await log_user_activity(user, "ticket_jumped", {
                "ticket_key": ticket_key,
                "fst_key": fst_key,
                "project_key": project_key,
            }, ip, user_agent)
            
            # Broadcast to all clients
            await broadcast_data_update("ticket_jumped", user.email, {
                "ticket_key": ticket_key,
                "fst_key": fst_key,
                "project_key": project_key,
            })
            
            print(f"[Jump] Ticket {ticket_key} jumped by {user.email} -> FST: {fst_key}")
            return {
                "status": "success",
                "ticket_key": ticket_key,
                "fst_key": fst_key,
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Handoff workflow failed"))
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Jump] Error jumping {ticket_key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to hand off ticket: {str(e)}")


@app.post("/api/tickets/inspect")
async def log_ticket_inspection(request: Request):
    """Log when a user inspects a ticket"""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    
    audit.ticket_inspected(
        email=user.email,
        name=user.name,
        ticket_key=body.get("ticket_key", "unknown"),
        ticket_summary=body.get("ticket_summary", ""),
        ticket_lines=body.get("ticket_lines", 0),
        ticket_status=body.get("ticket_status", ""),
        ip_address=ip,
        user_agent=user_agent,
    )
    
    return {"status": "logged"}


@app.get("/api/capacity", response_model=CapacityConfig)
async def get_capacity(request: Request):
    """Get capacity configuration"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/capacity", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    week, year = get_current_week()
    return CapacityConfig(
        weekly_capacity=DEFAULT_WEEKLY_CAPACITY,
        small_ticket_reservation=SMALL_TICKET_RESERVATION,
        current_week=week,
        current_year=year
    )


@app.get("/api/capacity/weeks")
async def get_week_capacities(request: Request):
    """Get all per-week capacity overrides"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/capacity/weeks", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Convert week_settings to capacity-only format for backward compatibility
    overrides = {}
    for key, settings in week_settings.items():
        if settings.get("capacity"):
            overrides[key] = settings["capacity"]
    
    return {"default": DEFAULT_WEEKLY_CAPACITY, "overrides": overrides}


@app.post("/api/capacity/week")
async def set_week_capacity(update: WeekCapacityUpdate, request: Request):
    """Set capacity for a specific week (admin only)"""
    user = await require_admin(request)
    
    ip, user_agent = get_client_info(request)
    key = f"{update.year}-{update.week}"
    old_capacity = week_settings.get(key, {}).get("capacity", DEFAULT_WEEKLY_CAPACITY)
    
    # Update in-memory cache
    if key not in week_settings:
        week_settings[key] = {"year": update.year, "week": update.week}
    
    if update.capacity == DEFAULT_WEEKLY_CAPACITY:
        week_settings[key].pop("capacity", None)
    else:
        week_settings[key]["capacity"] = update.capacity
    
    # Persist to database
    await db.save_week_setting(update.year, update.week, capacity=update.capacity)
    
    audit.capacity_week_changed(
        email=user.email,
        name=user.name,
        week=update.week,
        year=update.year,
        old_capacity=old_capacity,
        new_capacity=update.capacity,
        ip_address=ip,
        user_agent=user_agent,
    )
    
    # Broadcast to all clients
    await broadcast_data_update("capacity", user.email, {
        "week": update.week, 
        "year": update.year, 
        "capacity": update.capacity
    })
    
    return {"status": "success", "week": update.week, "year": update.year, "capacity": update.capacity}


@app.post("/api/capacity/default")
async def set_default_capacity(request: Request):
    """Set the default weekly capacity (admin only)"""
    global DEFAULT_WEEKLY_CAPACITY
    
    user = await require_admin(request)
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    new_capacity = body.get("capacity")
    
    if not new_capacity or new_capacity < 0:
        raise HTTPException(status_code=400, detail="Invalid capacity value")
    
    old_capacity = DEFAULT_WEEKLY_CAPACITY
    DEFAULT_WEEKLY_CAPACITY = new_capacity
    
    # Persist to database
    await db.save_global_setting("weekly_capacity", new_capacity)
    
    audit.capacity_default_changed(
        email=user.email,
        name=user.name,
        old_capacity=old_capacity,
        new_capacity=new_capacity,
        ip_address=ip,
        user_agent=user_agent,
    )
    
    # Broadcast to all clients
    await broadcast_data_update("capacity", user.email, {"default_capacity": new_capacity})
    
    return {"status": "success", "capacity": new_capacity}


@app.get("/api/settings")
async def get_settings(request: Request):
    """Get all global settings including reservations"""
    user = await get_current_user(request)
    if not user:
        ip, user_agent = get_client_info(request)
        audit.unauthorized_access("/api/settings", ip, user_agent)
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    week, year = get_current_week()
    return {
        "weekly_capacity": DEFAULT_WEEKLY_CAPACITY,
        "reservation_defaults": {
            "small": SMALL_TICKET_RESERVATION,
            "medium": MEDIUM_TICKET_RESERVATION,
        },
        "current_week": week,
        "current_year": year,
        "week_settings": week_settings,
    }


@app.post("/api/settings/reservations")
async def set_reservation_defaults(request: Request):
    """Set reservation defaults (admin only)"""
    global SMALL_TICKET_RESERVATION, MEDIUM_TICKET_RESERVATION
    
    user = await require_admin(request)
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    
    small = body.get("small")
    medium = body.get("medium")
    
    if small is not None:
        if small < 0:
            raise HTTPException(status_code=400, detail="Invalid small reservation value")
        SMALL_TICKET_RESERVATION = small
    
    if medium is not None:
        if medium < 0:
            raise HTTPException(status_code=400, detail="Invalid medium reservation value")
        MEDIUM_TICKET_RESERVATION = medium
    
    # Persist to database
    await db.save_global_setting("reservation_defaults", {
        "small": SMALL_TICKET_RESERVATION,
        "medium": MEDIUM_TICKET_RESERVATION,
    })
    
    print(f"[NoMAD] Reservation defaults updated: small={SMALL_TICKET_RESERVATION}, medium={MEDIUM_TICKET_RESERVATION}")
    
    return {
        "status": "success",
        "reservation_defaults": {
            "small": SMALL_TICKET_RESERVATION,
            "medium": MEDIUM_TICKET_RESERVATION,
        }
    }


@app.post("/api/reservation/toggle")
async def toggle_reservation(request: Request):
    """Toggle a reservation lock/unlock (admin only)"""
    user = await require_admin(request)
    
    ip, user_agent = get_client_info(request)
    body = await request.json()
    
    reservation_type = body.get("type", "small_ticket")
    week = body.get("week")
    year = body.get("year")
    unlocked = body.get("unlocked", False)
    
    # Update week settings
    key = f"{year}-{week}"
    if key not in week_settings:
        week_settings[key] = {"year": year, "week": week}
    
    if reservation_type == "small_ticket":
        week_settings[key]["small_unlocked"] = unlocked
        await db.save_week_setting(year, week, small_unlocked=unlocked)
    elif reservation_type == "medium_ticket":
        week_settings[key]["medium_unlocked"] = unlocked
        await db.save_week_setting(year, week, medium_unlocked=unlocked)
    
    if unlocked:
        audit.reservation_unlocked(
            email=user.email,
            name=user.name,
            reservation_type=reservation_type,
            week=week,
            year=year,
            ip_address=ip,
            user_agent=user_agent,
        )
    else:
        audit.reservation_locked(
            email=user.email,
            name=user.name,
            reservation_type=reservation_type,
            week=week,
            year=year,
            ip_address=ip,
            user_agent=user_agent,
        )
    
    return {"status": "logged"}


# =====================
# Static Files & SPA
# =====================

static_path = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_path, "assets")), name="assets")
    
    # Cache-control headers to prevent stale index.html (JS bundle references)
    NO_CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate"}
    
    @app.get("/")
    async def serve_root():
        return FileResponse(
            os.path.join(static_path, "index.html"),
            headers=NO_CACHE_HEADERS
        )
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404)
        
        file_path = os.path.join(static_path, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        # SPA fallback to index.html - also no cache
        return FileResponse(
            os.path.join(static_path, "index.html"),
            headers=NO_CACHE_HEADERS
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
