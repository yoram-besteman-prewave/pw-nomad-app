"""
Okta OIDC authentication for NoMAD
Only users assigned to the Okta app can sign in (Okta handles this)
nomad-admins group members get admin privileges

Supports both:
- SP-initiated login: User clicks "Sign in with Okta" in app
- IdP-initiated login: User clicks NoMAD app tile in Okta dashboard
"""
import os
import time
import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

# ===================
# Okta OIDC Configuration
# ===================
OKTA_DOMAIN = os.getenv("OKTA_DOMAIN", "prewave.okta.com")
OKTA_CLIENT_ID = os.getenv("OKTA_CLIENT_ID", "")
OKTA_CLIENT_SECRET = os.getenv("OKTA_CLIENT_SECRET", "")

# Okta OIDC endpoints (using Org Authorization Server)
OKTA_ISSUER = f"https://{OKTA_DOMAIN}"
OKTA_AUTH_URL = f"https://{OKTA_DOMAIN}/oauth2/v1/authorize"
OKTA_TOKEN_URL = f"https://{OKTA_DOMAIN}/oauth2/v1/token"
OKTA_USERINFO_URL = f"https://{OKTA_DOMAIN}/oauth2/v1/userinfo"
OKTA_LOGOUT_URL = f"https://{OKTA_DOMAIN}/oauth2/v1/logout"

# Application URLs
BASE_URL = os.getenv("BASE_URL", "https://nomad.it.prewave.ai")
REDIRECT_URI = f"{BASE_URL}/api/auth/callback"

# Session configuration
SESSION_DURATION_MINUTES = 30
SESSION_WARNING_MINUTES = 5
# Okta group for admins (people in this group get admin rights)
# Check for both group ID and group name since Okta may return either
ADMIN_GROUP_ID = "00gsupqfaclQ4pT1Q417"
ADMIN_GROUP_NAME = "Nomad Admins"

# Database pool reference (set by main.py)
db_pool = None


def set_db_pool(pool):
    """Set the database pool for auth operations"""
    global db_pool
    db_pool = pool


def is_okta_configured() -> bool:
    """Check if Okta is properly configured"""
    return bool(OKTA_CLIENT_ID and OKTA_CLIENT_SECRET)


def get_okta_config_status() -> dict:
    """Get Okta configuration status for debugging"""
    return {
        "configured": is_okta_configured(),
        "domain": OKTA_DOMAIN,
        "client_id_set": bool(OKTA_CLIENT_ID),
        "redirect_uri": REDIRECT_URI,
        "admin_group_id": ADMIN_GROUP_ID,
        "admin_group_name": ADMIN_GROUP_NAME,
    }


@dataclass
class User:
    id: int
    okta_id: str
    email: str
    name: str
    picture: str
    is_admin: bool = False


@dataclass 
class Session:
    token: str
    user: User
    created_at: datetime
    expires_at: datetime
    tab_id: str = ""  # Unique tab identifier for single-tab enforcement
    last_activity: datetime = field(default_factory=datetime.utcnow)
    
    def is_expired(self) -> bool:
        return datetime.utcnow() > self.expires_at
    
    def time_remaining_seconds(self) -> int:
        remaining = (self.expires_at - datetime.utcnow()).total_seconds()
        return max(0, int(remaining))
    
    def should_warn(self) -> bool:
        """Returns True if less than 5 minutes remaining"""
        return self.time_remaining_seconds() < SESSION_WARNING_MINUTES * 60
    
    def extend(self):
        """Extend session by full duration"""
        self.expires_at = datetime.utcnow() + timedelta(minutes=SESSION_DURATION_MINUTES)
        self.last_activity = datetime.utcnow()


# In-memory session cache (backed by database for persistence)
sessions: dict[str, Session] = {}

# Track active tab for each user (email -> tab_id)
# Only one tab per user is allowed at a time
user_active_tabs: dict[str, str] = {}

# Callbacks for notifying tabs of session invalidation (set by main.py)
tab_invalidation_callbacks: list = []

# Active users for presence
active_users: dict[str, dict] = {}  # session_token -> {user, last_seen, cursor}

# OAuth state tokens (short-lived, for CSRF protection)
oauth_states: dict[str, datetime] = {}


def get_oauth_auth_url(state: str = None) -> str:
    """Generate Okta OAuth authorization URL"""
    if not is_okta_configured():
        raise HTTPException(status_code=500, detail="Okta not configured")
    
    # Generate state for CSRF protection
    if not state:
        state = secrets.token_urlsafe(32)
    
    # Store state with expiry (5 minutes)
    oauth_states[state] = datetime.utcnow() + timedelta(minutes=5)
    
    # Clean up old states
    now = datetime.utcnow()
    expired = [s for s, exp in oauth_states.items() if exp < now]
    for s in expired:
        oauth_states.pop(s, None)
    
    params = {
        "client_id": OKTA_CLIENT_ID,
        "response_type": "code",
        "scope": "openid profile email groups",
        "redirect_uri": REDIRECT_URI,
        "state": state,
    }
    
    return f"{OKTA_AUTH_URL}?{urlencode(params)}"


def verify_oauth_state(state: str) -> bool:
    """Verify OAuth state token"""
    if state not in oauth_states:
        return False
    
    expiry = oauth_states.pop(state)
    return datetime.utcnow() < expiry


async def exchange_code_for_tokens(code: str) -> dict:
    """Exchange authorization code for tokens"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            OKTA_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": OKTA_CLIENT_ID,
                "client_secret": OKTA_CLIENT_SECRET,
                "code": code,
                "redirect_uri": REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        
        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=400, detail="Failed to exchange code for tokens")
        
        return response.json()


async def get_user_info(access_token: str) -> dict:
    """Get user info from Okta userinfo endpoint"""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            OKTA_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        
        if response.status_code != 200:
            logger.error(f"Userinfo failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=400, detail="Failed to get user info")
        
        return response.json()


async def get_user_groups_via_token(access_token: str, user_id: str) -> list[str]:
    """Fetch user's groups using access token"""
    try:
        async with httpx.AsyncClient() as client:
            # Try to get groups using the access token
            response = await client.get(
                f"https://{OKTA_DOMAIN}/api/v1/users/{user_id}/groups",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            
            if response.status_code == 200:
                groups_data = response.json()
                group_ids = [g.get("id") for g in groups_data if g.get("id")]
                logger.info(f"Fetched groups via API for user {user_id}: {group_ids}")
                return group_ids
            else:
                logger.warning(f"Failed to fetch groups via API (status {response.status_code}): {response.text[:200]}")
                return []
    except Exception as e:
        logger.error(f"Error fetching user groups: {e}")
        return []


async def get_or_create_user(okta_id: str, email: str, name: str, picture: str, groups: list[str]) -> User:
    """Get existing user or create new one from Okta data"""
    # Check for admin status - could be group ID or group name depending on Okta config
    is_admin = ADMIN_GROUP_ID in groups or ADMIN_GROUP_NAME in groups
    
    logger.info(f"User {email} groups: {groups}, is_admin: {is_admin} (checking for '{ADMIN_GROUP_ID}' or '{ADMIN_GROUP_NAME}')")
    
    if not db_pool:
        # Fallback to in-memory only
        return User(
            id=0,
            okta_id=okta_id,
            email=email,
            name=name,
            picture=picture,
            is_admin=is_admin,
        )
    
    async with db_pool.acquire() as conn:
        # Try to get existing user
        row = await conn.fetchrow(
            "SELECT id FROM users WHERE okta_id = $1",
            okta_id
        )
        
        if row:
            # Update existing user with latest info from Okta
            await conn.execute(
                """
                UPDATE users 
                SET email = $2, name = $3, picture = $4, is_admin = $5, last_login = CURRENT_TIMESTAMP
                WHERE okta_id = $1
                """,
                okta_id, email, name, picture, is_admin
            )
            
            return User(
                id=row["id"],
                okta_id=okta_id,
                email=email,
                name=name,
                picture=picture,
                is_admin=is_admin,
            )
        else:
            # Create new user
            row = await conn.fetchrow(
                """
                INSERT INTO users (okta_id, email, name, picture, is_admin, last_login)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                RETURNING id
                """,
                okta_id, email, name, picture, is_admin
            )
            
            return User(
                id=row["id"],
                okta_id=okta_id,
                email=email,
                name=name,
                picture=picture,
                is_admin=is_admin,
            )


async def log_user_activity(user: User, action: str, details: dict = None, ip_address: str = None, user_agent: str = None):
    """Log user activity to database"""
    if not db_pool:
        return
    
    import json
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO user_activity (user_id, user_email, action, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            user.id if user.id else None,
            user.email,
            action,
            json.dumps(details) if details else None,
            ip_address,
            user_agent
        )


async def create_session(user: User, tab_id: str = None) -> Session:
    """Create a new session for user. Invalidates any existing sessions for single-tab enforcement."""
    token = secrets.token_urlsafe(32)
    if not tab_id:
        tab_id = secrets.token_urlsafe(16)
    
    now = datetime.utcnow()
    
    # Single-tab enforcement: notify any existing tabs for this user
    old_tab_id = user_active_tabs.get(user.email)
    if old_tab_id and old_tab_id != tab_id:
        logger.info(f"[SingleTab] User {user.email} signed in on new tab, invalidating old tab {old_tab_id}")
        # Notify callbacks (WebSocket handlers) that the old tab should be invalidated
        for callback in tab_invalidation_callbacks:
            try:
                await callback(user.email, old_tab_id, "signed_in_elsewhere")
            except Exception as e:
                logger.error(f"Error notifying tab invalidation: {e}")
    
    # Set new active tab for this user
    user_active_tabs[user.email] = tab_id
    
    session = Session(
        token=token,
        user=user,
        created_at=now,
        expires_at=now + timedelta(minutes=SESSION_DURATION_MINUTES),
        tab_id=tab_id,
    )
    sessions[token] = session
    
    # Persist to database
    if db_pool:
        async with db_pool.acquire() as conn:
            # Try with tab_id first, fall back to without if column doesn't exist
            try:
                await conn.execute(
                    """
                    INSERT INTO sessions (token, user_id, tab_id, expires_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (token) DO UPDATE SET expires_at = $4, tab_id = $3, last_activity = CURRENT_TIMESTAMP
                    """,
                    token, user.id if user.id else None, tab_id, session.expires_at
                )
            except Exception as e:
                if "tab_id" in str(e):
                    # Column doesn't exist yet, use old schema
                    logger.warning("tab_id column not found, using legacy schema")
                    await conn.execute(
                        """
                        INSERT INTO sessions (token, user_id, expires_at)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (token) DO UPDATE SET expires_at = $3, last_activity = CURRENT_TIMESTAMP
                        """,
                        token, user.id if user.id else None, session.expires_at
                    )
                else:
                    raise
    
    return session


def register_tab_invalidation_callback(callback):
    """Register a callback to be called when a tab needs to be invalidated"""
    tab_invalidation_callbacks.append(callback)


def is_tab_valid(email: str, tab_id: str) -> bool:
    """Check if the given tab_id is still the active tab for the user"""
    active_tab = user_active_tabs.get(email)
    return active_tab == tab_id


async def get_session(token: str, check_tab: bool = True) -> Optional[Session]:
    """Get session by token, returns None if expired, not found, or tab invalidated"""
    # Check in-memory cache first
    session = sessions.get(token)
    if session and not session.is_expired():
        # Check if this tab is still the active one for the user
        if check_tab and session.tab_id and not is_tab_valid(session.user.email, session.tab_id):
            logger.info(f"[SingleTab] Session for {session.user.email} invalidated - signed in elsewhere")
            await delete_session(token)
            return None
        return session
    elif session:
        # Clean up expired session
        await delete_session(token)
        return None
    
    # Try database
    if db_pool:
        async with db_pool.acquire() as conn:
            # Try with tab_id first, fall back without if column doesn't exist
            try:
                row = await conn.fetchrow(
                    """
                    SELECT s.token, s.expires_at, s.last_activity, s.tab_id,
                           u.id, u.okta_id, u.email, u.name, u.picture, u.is_admin
                    FROM sessions s
                    JOIN users u ON s.user_id = u.id
                    WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP
                    """,
                    token
                )
            except Exception as e:
                if "tab_id" in str(e):
                    # Column doesn't exist yet, use old schema
                    row = await conn.fetchrow(
                        """
                        SELECT s.token, s.expires_at, s.last_activity,
                               u.id, u.okta_id, u.email, u.name, u.picture, u.is_admin
                        FROM sessions s
                        JOIN users u ON s.user_id = u.id
                        WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP
                        """,
                        token
                    )
                else:
                    raise
            
            if row:
                user = User(
                    id=row["id"],
                    okta_id=row["okta_id"],
                    email=row["email"],
                    name=row["name"],
                    picture=row["picture"] or "",
                    is_admin=row["is_admin"],
                )
                
                tab_id = row.get("tab_id", "") or ""
                
                # Check if this tab is still valid
                if check_tab and tab_id and not is_tab_valid(user.email, tab_id):
                    logger.info(f"[SingleTab] Session for {user.email} invalidated - signed in elsewhere")
                    return None
                
                session = Session(
                    token=token,
                    user=user,
                    created_at=row["last_activity"],
                    expires_at=row["expires_at"],
                    tab_id=tab_id,
                    last_activity=row["last_activity"],
                )
                sessions[token] = session
                return session
    
    return None


async def delete_session(token: str):
    """Delete a session"""
    if token in sessions:
        del sessions[token]
    if token in active_users:
        del active_users[token]
    
    if db_pool:
        async with db_pool.acquire() as conn:
            await conn.execute("DELETE FROM sessions WHERE token = $1", token)


async def get_current_user(request: Request) -> Optional[User]:
    """Get current user from session cookie"""
    token = request.cookies.get("session_token")
    if not token:
        return None
    
    session = await get_session(token)
    if not session:
        return None
    
    return session.user


async def require_auth(request: Request) -> User:
    """Dependency that requires authentication"""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def update_user_presence(token: str, cursor_x: int = None, cursor_y: int = None):
    """Update user presence/cursor position"""
    session = sessions.get(token)
    if session:
        active_users[token] = {
            "email": session.user.email,
            "name": session.user.name,
            "picture": session.user.picture,
            "last_seen": time.time(),
            "cursor": {"x": cursor_x, "y": cursor_y} if cursor_x is not None else None,
        }


def get_active_users(exclude_token: str = None) -> list[dict]:
    """Get list of active users (seen in last 30 seconds)"""
    now = time.time()
    active = []
    to_remove = []
    
    for token, data in active_users.items():
        if now - data["last_seen"] > 30:
            to_remove.append(token)
        elif token != exclude_token:
            active.append({
                "email": data["email"],
                "name": data["name"],
                "picture": data["picture"],
                "cursor": data.get("cursor"),
            })
    
    # Clean up stale entries
    for token in to_remove:
        del active_users[token]
    
    return active


async def cleanup_expired_sessions():
    """Remove all expired sessions"""
    expired = [token for token, session in sessions.items() if session.is_expired()]
    for token in expired:
        await delete_session(token)

    # Also clean up database
    if db_pool:
        async with db_pool.acquire() as conn:
            await conn.execute("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP")


# =====================
# Admin: View Users & Activity
# =====================

async def get_all_users() -> list[dict]:
    """Get all users who have logged in"""
    if not db_pool:
        return []
    
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, email, name, picture, is_admin, created_at, last_login
            FROM users
            ORDER BY last_login DESC NULLS LAST
            """
        )
        
        return [
            {
                "id": row["id"],
                "email": row["email"],
                "name": row["name"],
                "picture": row["picture"],
                "is_admin": row["is_admin"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "last_login": row["last_login"].isoformat() if row["last_login"] else None,
            }
            for row in rows
        ]


async def get_user_activity_log(user_id: int = None, months_back: int = 6) -> list[dict]:
    """Get user activity log from the last N months"""
    if not db_pool:
        return []
    
    async with db_pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                """
                SELECT id, user_id, user_email, action, details, ip_address, created_at
                FROM user_activity
                WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 month' * $2
                ORDER BY created_at DESC
                """,
                user_id, months_back
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, user_id, user_email, action, details, ip_address, created_at
                FROM user_activity
                WHERE created_at >= NOW() - INTERVAL '1 month' * $1
                ORDER BY created_at DESC
                """,
                months_back
            )
        
        import json
        return [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "user_email": row["user_email"],
                "action": row["action"],
                "details": json.loads(row["details"]) if row["details"] else None,
                "ip_address": row["ip_address"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ]
