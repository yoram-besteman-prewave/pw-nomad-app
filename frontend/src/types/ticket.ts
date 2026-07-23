export interface Ticket {
  key: string;
  summary: string;
  description: string | null;
  lines: number;
  status: string;
  assignee: string | null;
  created: string;
  priority_order: number | null;
  comments: Comment[];
  // New fields
  has_total_count: boolean;
  has_screening_link: boolean;
  is_approved: boolean;
  due_date: string | null;
  // Locked to specific week
  locked_week?: number;
  locked_year?: number;
  // Queue status from backend (source of truth)
  in_queue: boolean;
  // Mismatch detection (Jira vs NoMAD)
  has_mismatch?: boolean;
  mismatch_type?: 'date' | 'lines' | 'both' | null;
  scheduled_lines?: number | null;
  // Jumped workflow
  is_jumped?: boolean;  // True if ticket has been jumped (status = Jumped)
  fst_key?: string;     // Key of the linked FST ticket (if jumped)
  // Auto-return workflow
  was_auto_returned?: boolean;  // True if ticket was auto-returned from expired state
  // Computed
  queue_position?: number;
  expected_delivery?: string;
  cumulative_lines?: number;
  // Effective week (calculated from queue position or locked)
  effectiveWeek?: number;
  effectiveYear?: number;
}

export interface Comment {
  author: string;
  body: string;
  created: string;
}

export interface TicketSchedule {
  key: string;
  priority_order: number;
  in_queue: boolean;
  locked_week?: number;
  locked_year?: number;
}

export interface ScheduleUpdate {
  tickets: TicketSchedule[];
}

export interface CapacityConfig {
  weekly_capacity: number;
  small_ticket_reservation: number;
  current_week: number;
  current_year: number;
}

// Size categories for lanes
export type TicketSize = 'small' | 'medium' | 'big';

export function getTicketSize(lines: number): TicketSize {
  if (lines < 500) return 'small';
  if (lines <= 1500) return 'medium';
  return 'big';
}

// Ticket state types for visual styling
export type TicketState = 'ready' | 'pending_approval' | 'missing_data';

/**
 * Get the current state of a ticket for visual styling
 * - 'ready': Has total count, attachment, AND is approved (green)
 * - 'pending_approval': Has total count + attachment but NOT approved (orange/red)
 * - 'missing_data': Missing total count or attachment (cannot schedule)
 */
export function getTicketState(ticket: Ticket): TicketState {
  if (!ticket.has_total_count || !ticket.has_screening_link) return 'missing_data';
  if (!ticket.is_approved) return 'pending_approval';
  return 'ready';
}

/**
 * Return the reason a ticket cannot be scheduled, or null if it can.
 * Priority: missing line count is checked first, then missing attachment.
 */
export function getScheduleBlockReason(ticket: Ticket): string | null {
  if (!ticket.has_total_count) return 'Fill in Total Count in Jira first';
  if (!ticket.has_screening_link) return 'Screening List Link is missing - add the URL to the ticket in Jira';
  return null;
}

/**
 * Check if ticket can be scheduled (has total count AND an attachment).
 * Tickets pending approval CAN be scheduled, they just show as orange.
 */
export function isSchedulable(ticket: Ticket): boolean {
  return ticket.has_total_count && ticket.has_screening_link;
}

/**
 * Check if ticket is fully ready (has total count AND is approved)
 * Use this for the "green" state
 */
export function isFullyReady(ticket: Ticket): boolean {
  return ticket.has_total_count && ticket.is_approved;
}

/**
 * Get the Friday of a given ISO week
 */
export function getFridayOfWeek(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const daysToMonday = jan4.getDay() === 0 ? 6 : jan4.getDay() - 1;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - daysToMonday);
  
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
  
  const friday = new Date(targetMonday);
  friday.setDate(targetMonday.getDate() + 4);
  
  return friday;
}

/**
 * Get the Monday (start) of a given ISO week
 */
export function getMondayOfWeek(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const daysToMonday = jan4.getDay() === 0 ? 6 : jan4.getDay() - 1;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - daysToMonday);
  
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
  
  return targetMonday;
}

/**
 * Calculate working days (Mon-Fri) between two dates
 */
function countWorkingDays(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) { // Not Sunday (0) or Saturday (6)
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Get the number of working days until the ticket's due date
 * Returns null if ticket has no locked week/year
 */
export function getWorkingDaysUntilDue(ticket: Ticket): number | null {
  if (ticket.locked_week == null || ticket.locked_year == null) {
    return null;
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Due date is Friday of the locked week
  const dueDate = getFridayOfWeek(ticket.locked_week, ticket.locked_year);
  dueDate.setHours(0, 0, 0, 0);
  
  if (dueDate < today) {
    return 0; // Already past due
  }
  
  return countWorkingDays(today, dueDate);
}

/**
 * Check if a ticket is approaching its deadline (< 10 working days) and still not approved
 * This triggers the RED state
 */
export function isApproachingDeadline(ticket: Ticket): boolean {
  if (ticket.is_approved) return false; // Approved tickets are fine
  if (ticket.locked_week == null || ticket.locked_year == null) return false;
  
  const workingDays = getWorkingDaysUntilDue(ticket);
  if (workingDays === null) return false;
  
  return workingDays < 10;
}

/**
 * Check if a ticket's scheduled week has started (or passed)
 * Used for auto-queue logic
 */
export function hasScheduledWeekStarted(ticket: Ticket): boolean {
  if (ticket.locked_week == null || ticket.locked_year == null) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekStart = getMondayOfWeek(ticket.locked_week, ticket.locked_year);
  weekStart.setHours(0, 0, 0, 0);
  
  return today >= weekStart;
}

/**
 * Check if a ticket's scheduled week is completely in the past (Friday has passed)
 * Used for detecting expired tickets that should trigger alerts
 */
export function hasScheduledWeekPassed(ticket: Ticket): boolean {
  if (ticket.locked_week == null || ticket.locked_year == null) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekEnd = getFridayOfWeek(ticket.locked_week, ticket.locked_year);
  weekEnd.setHours(23, 59, 59, 999); // End of Friday
  
  return today > weekEnd;
}

/**
 * Status values that indicate a ticket was intentionally completed/skipped
 * Tickets with these statuses won't trigger "expired" alerts
 */
export const COMPLETED_STATUSES = ['Jumped', 'Done', 'Closed', 'Completed', 'Resolved'];

/**
 * Check if a ticket has a "completed" status (Jumped, Done, etc.)
 */
export function isCompletedStatus(ticket: Ticket): boolean {
  return COMPLETED_STATUSES.some(s => 
    ticket.status.toLowerCase() === s.toLowerCase()
  );
}

/**
 * Get current ISO week number and year
 */
export function getCurrentWeekAndYear(): { week: number; year: number } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  
  return { week, year: d.getUTCFullYear() };
}

/**
 * Get ISO week number and year from a specific date
 */
export function getWeekFromDate(date: Date | string): { week: number; year: number } {
  const inputDate = typeof date === 'string' ? new Date(date) : date;
  const d = new Date(Date.UTC(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  
  return { week, year: d.getUTCFullYear() };
}

// Re-export reservation types for convenience
export interface ReservationDefaults {
  small: number;
  medium: number;
}

export interface WeekUnlocks {
  small: boolean;
  medium: boolean;
}

// Header data for a week swimlane in the queue: date range + capacity usage
export interface WeekHeader {
  week: number;
  year: number;
  label: string;      // e.g. "W31"
  dateRange: string;  // e.g. "Jul 28 – Aug 1"
  used: number;       // total scheduled lines in this week's lane
  capacity: number;   // total capacity for the week
  isOver: boolean;    // used > capacity
}

// Capacity breakdown by ticket size
export interface CapacityBySize {
  small: { used: number; reserved: number; available: number };
  medium: { used: number; reserved: number; available: number };
  large: { used: number; reserved: number; available: number };
  total: { used: number; capacity: number; available: number };
}

/**
 * Get tickets scheduled in a specific week, grouped by size
 */
export function getScheduledBySize(
  tickets: Ticket[],
  week: number,
  year: number
): { small: number; medium: number; large: number; total: number } {
  const result = { small: 0, medium: 0, large: 0, total: 0 };
  
  for (const ticket of tickets) {
    if (ticket.locked_week === week && ticket.locked_year === year) {
      const size = getTicketSize(ticket.lines);
      if (size === 'small') result.small += ticket.lines;
      else if (size === 'medium') result.medium += ticket.lines;
      else result.large += ticket.lines;
      result.total += ticket.lines;
    }
  }
  
  return result;
}

/**
 * Calculate available capacity for each size category in a given week
 */
export function getAvailableCapacityBySize(
  scheduledBySize: { small: number; medium: number; large: number; total: number },
  weekCapacity: number,
  reservationDefaults: ReservationDefaults,
  weekUnlocks: WeekUnlocks
): CapacityBySize {
  // Calculate reserved amounts (considering unlocks)
  const smallReserved = weekUnlocks.small ? 0 : reservationDefaults.small;
  const mediumReserved = weekUnlocks.medium ? 0 : reservationDefaults.medium;
  
  // Large gets whatever is left after reservations
  const largeReserved = Math.max(0, weekCapacity - smallReserved - mediumReserved);
  
  // Calculate available for each size
  // Small tickets can only use their reserved space (unless unlocked, then any available)
  const smallAvailable = weekUnlocks.small 
    ? weekCapacity - scheduledBySize.total // Can use any available space
    : Math.max(0, smallReserved - scheduledBySize.small); // Only within reservation
  
  // Medium tickets can only use their reserved space (unless unlocked)
  const mediumAvailable = weekUnlocks.medium
    ? weekCapacity - scheduledBySize.total // Can use any available space
    : Math.max(0, mediumReserved - scheduledBySize.medium); // Only within reservation
  
  // Large tickets use the remaining space (total capacity minus reservations that are still active)
  const largeAvailable = Math.max(0, 
    weekCapacity - scheduledBySize.total - smallReserved - mediumReserved + scheduledBySize.small + scheduledBySize.medium
  );
  
  return {
    small: {
      used: scheduledBySize.small,
      reserved: smallReserved,
      available: smallAvailable,
    },
    medium: {
      used: scheduledBySize.medium,
      reserved: mediumReserved,
      available: mediumAvailable,
    },
    large: {
      used: scheduledBySize.large,
      reserved: largeReserved,
      available: largeAvailable,
    },
    total: {
      used: scheduledBySize.total,
      capacity: weekCapacity,
      available: weekCapacity - scheduledBySize.total,
    },
  };
}

/**
 * Check if a ticket can be scheduled to a week based on size reservations
 * Returns null if schedulable, or an error message if not
 */
export function canScheduleTicket(
  ticket: Ticket,
  scheduledBySize: { small: number; medium: number; large: number; total: number },
  weekCapacity: number,
  reservationDefaults: ReservationDefaults,
  weekUnlocks: WeekUnlocks,
  excludeTicketKey?: string
): { allowed: boolean; reason?: string; availableLines?: number } {
  const size = getTicketSize(ticket.lines);
  
  // If we're moving a ticket within the same week, exclude its lines from the calculation
  const adjustedScheduled = { ...scheduledBySize };
  if (excludeTicketKey === ticket.key) {
    if (size === 'small') adjustedScheduled.small -= ticket.lines;
    else if (size === 'medium') adjustedScheduled.medium -= ticket.lines;
    else adjustedScheduled.large -= ticket.lines;
    adjustedScheduled.total -= ticket.lines;
  }
  
  const capacity = getAvailableCapacityBySize(
    adjustedScheduled,
    weekCapacity,
    reservationDefaults,
    weekUnlocks
  );
  
  // Check based on ticket size
  if (size === 'small') {
    if (weekUnlocks.small) {
      // Unlocked: can use any available space
      if (ticket.lines <= capacity.total.available) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Week is full (${capacity.total.available.toLocaleString()} lines available)`,
        availableLines: capacity.total.available,
      };
    } else {
      // Locked: must fit within small reservation
      if (ticket.lines <= capacity.small.available) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Would exceed small ticket reservation (${capacity.small.available.toLocaleString()} of ${reservationDefaults.small.toLocaleString()} lines available)`,
        availableLines: capacity.small.available,
      };
    }
  } else if (size === 'medium') {
    if (weekUnlocks.medium) {
      // Unlocked: can use any available space
      if (ticket.lines <= capacity.total.available) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Week is full (${capacity.total.available.toLocaleString()} lines available)`,
        availableLines: capacity.total.available,
      };
    } else {
      // Locked: must fit within medium reservation
      if (ticket.lines <= capacity.medium.available) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Would exceed medium ticket reservation (${capacity.medium.available.toLocaleString()} of ${reservationDefaults.medium.toLocaleString()} lines available)`,
        availableLines: capacity.medium.available,
      };
    }
  } else {
    // Large tickets use remaining capacity
    if (ticket.lines <= capacity.large.available) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Would exceed large ticket capacity (${capacity.large.available.toLocaleString()} lines available after reservations)`,
      availableLines: capacity.large.available,
    };
  }
}
