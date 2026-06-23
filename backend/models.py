from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Comment(BaseModel):
    author: str
    body: str
    created: datetime


class Ticket(BaseModel):
    key: str
    summary: str
    description: Optional[str] = None
    lines: int
    status: str
    assignee: Optional[str] = None
    created: datetime
    priority_order: Optional[int] = None
    comments: list[Comment] = []
    # New fields
    has_total_count: bool = True  # False if Total Count is missing
    has_screening_link: bool = False  # True if the Screening List Link URL field is populated in Jira
    is_approved: bool = False  # True only if status is "Approved"
    due_date: Optional[datetime] = None
    locked_week: Optional[int] = None  # Week locked for scheduling
    locked_year: Optional[int] = None  # Year locked for scheduling
    in_queue: bool = False  # Whether ticket is in the scheduling queue
    # Mismatch detection (Jira vs NoMAD)
    has_mismatch: bool = False  # True if Jira data doesn't match NoMAD schedule
    mismatch_type: Optional[str] = None  # "date", "lines", or "both"
    scheduled_lines: Optional[int] = None  # Lines at time of scheduling (for comparison)
    # Jumped workflow
    is_jumped: bool = False  # True if ticket has been jumped (status = Jumped)
    fst_key: Optional[str] = None  # Key of the linked FST ticket (if jumped)
    # Auto-return workflow
    was_auto_returned: bool = False  # True if ticket was auto-returned from expired state


class TicketSchedule(BaseModel):
    key: str
    priority_order: int
    in_queue: bool = True
    locked_week: Optional[int] = None
    locked_year: Optional[int] = None


class ScheduleUpdate(BaseModel):
    tickets: list[TicketSchedule]


class CapacityConfig(BaseModel):
    weekly_capacity: int = 4000
    small_ticket_reservation: int = 500  # Lines reserved for small tickets per month
    current_week: int
    current_year: int


class DueDateUpdate(BaseModel):
    ticket_key: str
    week: int
    year: int
    lines: int = 0  # Lines to calculate weeks spanned (0 = use start week only)


class WeekCapacityUpdate(BaseModel):
    week: int
    year: int
    capacity: int
