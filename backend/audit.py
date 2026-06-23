"""
Audit logging system for CS Scheduler
Posts structured logs to n8n webhook endpoint
"""
import asyncio
import httpx
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Any
from dataclasses import dataclass, asdict
import json
import traceback

# Webhook configuration
WEBHOOK_URL = "https://n8n-750886765018.europe-west1.run.app/webhook/feeaede1-25b9-4019-85db-936c2ab66e1e"
WEBHOOK_USER = "csopsdashboarduser"
WEBHOOK_PASSWORD = "ZBFu0IzXk28febEPIGirhkoHIjeohNHeIA2983$2#iIHAJo"


class AuditCategory(str, Enum):
    SECURITY = "security"
    SYSTEM = "system"
    INFO = "info"
    OTHER = "other"


class AuditEvent(str, Enum):
    # Security events
    LOGIN_ATTEMPT_FAILED = "login_attempt_failed"
    LOGIN_SUCCESS = "login_success"
    LOGOUT = "logout"
    FORCE_LOGOUT = "force_logout"
    SESSION_EXPIRED = "session_expired"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    INVALID_DOMAIN_LOGIN = "invalid_domain_login"
    SESSION_INVALIDATED_OTHER_TAB = "session_invalidated_other_tab"
    
    # System events
    CAPACITY_WEEK_CHANGED = "capacity_week_changed"
    CAPACITY_DEFAULT_CHANGED = "capacity_default_changed"
    RESERVATION_UNLOCKED = "reservation_unlocked"
    RESERVATION_LOCKED = "reservation_locked"
    NUCLEAR_RESET = "nuclear_reset"
    
    # Info events
    TICKET_SCHEDULED = "ticket_scheduled"
    TICKET_UNSCHEDULED = "ticket_unscheduled"
    TICKET_LOCKED = "ticket_locked"
    TICKET_UNLOCKED = "ticket_unlocked"
    TICKET_MOVED_TO_BACKLOG = "ticket_moved_to_backlog"
    TICKET_ADDED_TO_QUEUE = "ticket_added_to_queue"
    TICKET_INSPECTED = "ticket_inspected"
    TICKET_DUE_DATE_SET = "ticket_due_date_set"
    TICKET_MOVED = "ticket_moved"
    TICKET_PRIORITY_CHANGED = "ticket_priority_changed"
    TICKET_MISMATCH_RESET = "ticket_mismatch_reset"
    
    # Other events
    WEBHOOK_ERROR = "webhook_error"
    SYSTEM_ERROR = "system_error"


@dataclass
class AuditLogEntry:
    timestamp: str
    category: str
    event: str
    user_email: Optional[str]
    user_name: Optional[str]
    ip_address: Optional[str]
    user_agent: Optional[str]
    details: dict
    success: bool
    error_message: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)


def get_category_for_event(event: AuditEvent) -> AuditCategory:
    """Determine the category for an audit event"""
    security_events = {
        AuditEvent.LOGIN_ATTEMPT_FAILED,
        AuditEvent.LOGIN_SUCCESS,
        AuditEvent.LOGOUT,
        AuditEvent.FORCE_LOGOUT,
        AuditEvent.SESSION_EXPIRED,
        AuditEvent.UNAUTHORIZED_ACCESS,
        AuditEvent.INVALID_DOMAIN_LOGIN,
        AuditEvent.SESSION_INVALIDATED_OTHER_TAB,
    }
    
    system_events = {
        AuditEvent.CAPACITY_WEEK_CHANGED,
        AuditEvent.CAPACITY_DEFAULT_CHANGED,
        AuditEvent.RESERVATION_UNLOCKED,
        AuditEvent.RESERVATION_LOCKED,
        AuditEvent.NUCLEAR_RESET,
    }
    
    info_events = {
        AuditEvent.TICKET_SCHEDULED,
        AuditEvent.TICKET_UNSCHEDULED,
        AuditEvent.TICKET_LOCKED,
        AuditEvent.TICKET_UNLOCKED,
        AuditEvent.TICKET_MOVED_TO_BACKLOG,
        AuditEvent.TICKET_ADDED_TO_QUEUE,
        AuditEvent.TICKET_INSPECTED,
        AuditEvent.TICKET_DUE_DATE_SET,
        AuditEvent.TICKET_MOVED,
        AuditEvent.TICKET_PRIORITY_CHANGED,
        AuditEvent.TICKET_MISMATCH_RESET,
    }
    
    if event in security_events:
        return AuditCategory.SECURITY
    elif event in system_events:
        return AuditCategory.SYSTEM
    elif event in info_events:
        return AuditCategory.INFO
    else:
        return AuditCategory.OTHER


async def post_audit_log(entry: AuditLogEntry) -> bool:
    """Post audit log entry to webhook endpoint"""
    try:
        print(f"[AUDIT] Posting event: {entry.event} for user {entry.user_email}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                WEBHOOK_URL,
                json=entry.to_dict(),
                auth=(WEBHOOK_USER, WEBHOOK_PASSWORD),
                headers={"Content-Type": "application/json"},
            )
            success = response.status_code in (200, 201, 202, 204)
            if success:
                print(f"[AUDIT] Successfully posted: {entry.event}")
            else:
                print(f"[AUDIT] Webhook returned {response.status_code}: {response.text[:200]}")
            return success
    except Exception as e:
        # Log locally if webhook fails
        print(f"[AUDIT ERROR] Failed to post audit log: {e}")
        print(f"[AUDIT FALLBACK] {json.dumps(entry.to_dict())}")
        return False


def fire_and_forget(coro):
    """Run a coroutine in the background without waiting"""
    try:
        # Try to get the running loop (Python 3.10+ preferred way)
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, create a task
            asyncio.create_task(coro)
            return
        except RuntimeError:
            # No running loop, we're in a sync context
            pass
        
        # Try the deprecated way for older patterns
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(coro)
            else:
                loop.run_until_complete(coro)
        except RuntimeError:
            # No event loop at all, create a new one
            asyncio.run(coro)
    except Exception as e:
        print(f"[AUDIT] fire_and_forget failed: {e}")
        # Last resort: try to run synchronously with a new event loop
        try:
            asyncio.run(coro)
        except Exception as e2:
            print(f"[AUDIT] Final fallback also failed: {e2}")


class AuditLogger:
    """Audit logger with convenience methods for common events"""
    
    @staticmethod
    def _create_entry(
        event: AuditEvent,
        user_email: Optional[str] = None,
        user_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        details: Optional[dict] = None,
        success: bool = True,
        error_message: Optional[str] = None,
    ) -> AuditLogEntry:
        return AuditLogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            category=get_category_for_event(event).value,
            event=event.value,
            user_email=user_email,
            user_name=user_name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details or {},
            success=success,
            error_message=error_message,
        )
    
    @staticmethod
    async def log(
        event: AuditEvent,
        user_email: Optional[str] = None,
        user_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        details: Optional[dict] = None,
        success: bool = True,
        error_message: Optional[str] = None,
    ):
        """Log an audit event"""
        entry = AuditLogger._create_entry(
            event=event,
            user_email=user_email,
            user_name=user_name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=success,
            error_message=error_message,
        )
        await post_audit_log(entry)
    
    @staticmethod
    def log_async(
        event: AuditEvent,
        user_email: Optional[str] = None,
        user_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        details: Optional[dict] = None,
        success: bool = True,
        error_message: Optional[str] = None,
    ):
        """Log an audit event without waiting (fire and forget)"""
        print(f"[AUDIT] Creating log entry: {event.value} for {user_email}")
        entry = AuditLogger._create_entry(
            event=event,
            user_email=user_email,
            user_name=user_name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=success,
            error_message=error_message,
        )
        fire_and_forget(post_audit_log(entry))
    
    # Convenience methods for common events
    
    @staticmethod
    def login_failed(
        email: str,
        reason: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log a failed login attempt"""
        AuditLogger.log_async(
            event=AuditEvent.LOGIN_ATTEMPT_FAILED,
            user_email=email,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"reason": reason, "attempted_email": email},
            success=False,
            error_message=reason,
        )
    
    @staticmethod
    def invalid_domain_login(
        email: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log a login attempt with invalid domain"""
        domain = email.split("@")[-1] if "@" in email else "unknown"
        AuditLogger.log_async(
            event=AuditEvent.INVALID_DOMAIN_LOGIN,
            user_email=email,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "attempted_email": email,
                "domain": domain,
                "allowed_domain": "prewave.ai",
            },
            success=False,
            error_message=f"Domain '{domain}' not allowed",
        )
    
    @staticmethod
    def login_success(
        email: str,
        name: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log a successful login"""
        AuditLogger.log_async(
            event=AuditEvent.LOGIN_SUCCESS,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"login_time": datetime.now(timezone.utc).isoformat()},
            success=True,
        )
    
    @staticmethod
    def logout(
        email: str,
        name: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log a user logout"""
        AuditLogger.log_async(
            event=AuditEvent.LOGOUT,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"logout_time": datetime.now(timezone.utc).isoformat()},
            success=True,
        )
    
    @staticmethod
    def force_logout(
        email: str,
        name: str,
        reason: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log a forced logout (session expired, etc.)"""
        AuditLogger.log_async(
            event=AuditEvent.FORCE_LOGOUT,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"reason": reason},
            success=True,
        )
    
    @staticmethod
    def ticket_scheduled(
        email: str,
        name: str,
        ticket_key: str,
        week: int,
        year: int,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        due_date: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is scheduled to a week"""
        details = {
            "ticket_key": ticket_key,
            "scheduled_week": week,
            "scheduled_year": year,
            "week_label": f"W{week}/{year}",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
        if due_date:
            details["due_date"] = due_date
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_SCHEDULED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        # Also print to console for immediate visibility
        print(f"[AUDIT] TICKET_SCHEDULED: {ticket_key} -> W{week}/{year} by {name} ({email})")
    
    @staticmethod
    def ticket_due_date_set(
        email: str,
        name: str,
        ticket_key: str,
        week: int,
        year: int,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        due_date: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket's due date is set"""
        details = {
            "ticket_key": ticket_key,
            "week": week,
            "year": year,
            "week_label": f"W{week}/{year}",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
        if due_date:
            details["due_date"] = due_date
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_DUE_DATE_SET,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        # Also print to console for immediate visibility
        print(f"[AUDIT] TICKET_DUE_DATE_SET: {ticket_key} due={due_date} (W{week}/{year}) by {name}")
    
    @staticmethod
    def ticket_inspected(
        email: str,
        name: str,
        ticket_key: str,
        ticket_summary: str,
        ticket_lines: int,
        ticket_status: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user inspects a ticket"""
        AuditLogger.log_async(
            event=AuditEvent.TICKET_INSPECTED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "ticket_key": ticket_key,
                "ticket_summary": ticket_summary[:100],  # Truncate long summaries
                "ticket_lines": ticket_lines,
                "ticket_status": ticket_status,
            },
            success=True,
        )
    
    @staticmethod
    def capacity_week_changed(
        email: str,
        name: str,
        week: int,
        year: int,
        old_capacity: int,
        new_capacity: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user changes capacity for a specific week"""
        AuditLogger.log_async(
            event=AuditEvent.CAPACITY_WEEK_CHANGED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "week": week,
                "year": year,
                "week_label": f"W{week}/{year}",
                "old_capacity": old_capacity,
                "new_capacity": new_capacity,
                "capacity_change": new_capacity - old_capacity,
            },
            success=True,
        )
    
    @staticmethod
    def capacity_default_changed(
        email: str,
        name: str,
        old_capacity: int,
        new_capacity: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user changes the default weekly capacity"""
        AuditLogger.log_async(
            event=AuditEvent.CAPACITY_DEFAULT_CHANGED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "old_capacity": old_capacity,
                "new_capacity": new_capacity,
                "capacity_change": new_capacity - old_capacity,
            },
            success=True,
        )
    
    @staticmethod
    def reservation_unlocked(
        email: str,
        name: str,
        reservation_type: str,
        week: int,
        year: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user unlocks a reservation"""
        AuditLogger.log_async(
            event=AuditEvent.RESERVATION_UNLOCKED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "reservation_type": reservation_type,
                "week": week,
                "year": year,
                "week_label": f"W{week}/{year}",
            },
            success=True,
        )
        # Also print to console for immediate visibility
        print(f"[AUDIT] RESERVATION_UNLOCKED: {reservation_type} W{week}/{year} by {name} ({email})")
    
    @staticmethod
    def reservation_locked(
        email: str,
        name: str,
        reservation_type: str,
        week: int,
        year: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user locks a reservation"""
        AuditLogger.log_async(
            event=AuditEvent.RESERVATION_LOCKED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "reservation_type": reservation_type,
                "week": week,
                "year": year,
                "week_label": f"W{week}/{year}",
            },
            success=True,
        )
        # Also print to console for immediate visibility
        print(f"[AUDIT] RESERVATION_LOCKED: {reservation_type} W{week}/{year} by {name} ({email})")
    
    @staticmethod
    def unauthorized_access(
        endpoint: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log an unauthorized access attempt"""
        AuditLogger.log_async(
            event=AuditEvent.UNAUTHORIZED_ACCESS,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"endpoint": endpoint},
            success=False,
            error_message="Unauthorized access attempt",
        )
    
    @staticmethod
    def ticket_unscheduled(
        email: str,
        name: str,
        ticket_key: str,
        previous_week: int,
        previous_year: int,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is unlocked/unscheduled from a week"""
        details = {
            "ticket_key": ticket_key,
            "previous_week": previous_week,
            "previous_year": previous_year,
            "previous_week_label": f"W{previous_week}/{previous_year}",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_UNSCHEDULED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_UNSCHEDULED: {ticket_key} from W{previous_week}/{previous_year} by {name} ({email})")
    
    @staticmethod
    def ticket_moved_to_backlog(
        email: str,
        name: str,
        ticket_key: str,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        previous_week: Optional[int] = None,
        previous_year: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is moved from queue to backlog (pool)"""
        details = {
            "ticket_key": ticket_key,
            "destination": "backlog",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
        if previous_week is not None and previous_year is not None:
            details["previous_week"] = previous_week
            details["previous_year"] = previous_year
            details["previous_week_label"] = f"W{previous_week}/{previous_year}"
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_MOVED_TO_BACKLOG,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_MOVED_TO_BACKLOG: {ticket_key} by {name} ({email})")
    
    @staticmethod
    def session_invalidated_other_tab(
        email: str,
        name: str,
        old_tab_id: Optional[str] = None,
        new_tab_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a user's session is invalidated because they signed in from another tab"""
        AuditLogger.log_async(
            event=AuditEvent.SESSION_INVALIDATED_OTHER_TAB,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "reason": "signed_in_from_different_tab",
                "old_tab_id": old_tab_id,
                "new_tab_id": new_tab_id,
            },
            success=True,
        )
        print(f"[AUDIT] SESSION_INVALIDATED_OTHER_TAB: {email} signed in from new tab")
    
    @staticmethod
    def ticket_locked(
        email: str,
        name: str,
        ticket_key: str,
        week: int,
        year: int,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is locked to a specific week"""
        details = {
            "ticket_key": ticket_key,
            "locked_week": week,
            "locked_year": year,
            "week_label": f"W{week}/{year}",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_LOCKED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_LOCKED: {ticket_key} -> W{week}/{year} by {name} ({email})")
    
    @staticmethod
    def ticket_unlocked(
        email: str,
        name: str,
        ticket_key: str,
        previous_week: Optional[int] = None,
        previous_year: Optional[int] = None,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is unlocked (due date cleared)"""
        details = {
            "ticket_key": ticket_key,
        }
        if previous_week is not None and previous_year is not None:
            details["previous_week"] = previous_week
            details["previous_year"] = previous_year
            details["previous_week_label"] = f"W{previous_week}/{previous_year}"
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_UNLOCKED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_UNLOCKED: {ticket_key} by {name} ({email})")
    
    @staticmethod
    def ticket_added_to_queue(
        email: str,
        name: str,
        ticket_key: str,
        position: int,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket is added to the queue from backlog"""
        details = {
            "ticket_key": ticket_key,
            "position": position,
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_ADDED_TO_QUEUE,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_ADDED_TO_QUEUE: {ticket_key} at position {position} by {name} ({email})")
    
    @staticmethod
    def ticket_priority_changed(
        email: str,
        name: str,
        ticket_key: str,
        old_position: int,
        new_position: int,
        ticket_summary: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a ticket's priority/position in queue changes"""
        details = {
            "ticket_key": ticket_key,
            "old_position": old_position,
            "new_position": new_position,
            "direction": "up" if new_position < old_position else "down",
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_PRIORITY_CHANGED,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_PRIORITY_CHANGED: {ticket_key} {old_position} -> {new_position} by {name}")
    
    @staticmethod
    def ticket_mismatch_reset(
        email: str,
        name: str,
        ticket_key: str,
        mismatch_type: str,
        ticket_summary: Optional[str] = None,
        ticket_lines: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when a mismatched ticket is reset"""
        details = {
            "ticket_key": ticket_key,
            "mismatch_type": mismatch_type,
        }
        if ticket_summary:
            details["ticket_summary"] = ticket_summary[:100]
        if ticket_lines is not None:
            details["ticket_lines"] = ticket_lines
            
        AuditLogger.log_async(
            event=AuditEvent.TICKET_MISMATCH_RESET,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
            success=True,
        )
        print(f"[AUDIT] TICKET_MISMATCH_RESET: {ticket_key} ({mismatch_type}) by {name} ({email})")
    
    @staticmethod
    def nuclear_reset(
        email: str,
        name: str,
        tickets_cleared: int,
        tickets_failed: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """Log when an admin performs a nuclear reset"""
        AuditLogger.log_async(
            event=AuditEvent.NUCLEAR_RESET,
            user_email=email,
            user_name=name,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "tickets_cleared": tickets_cleared,
                "tickets_failed": tickets_failed,
                "action": "NUCLEAR_RESET",
            },
            success=True,
        )
        print(f"[AUDIT] NUCLEAR_RESET: {tickets_cleared} tickets cleared by {name} ({email})")


# Singleton instance
audit = AuditLogger()

