import { useState, useEffect, useCallback, useRef } from 'react';
import type { Ticket, CapacityConfig, ScheduleUpdate } from '../types/ticket';
import { hasScheduledWeekStarted, hasScheduledWeekPassed, isCompletedStatus, getCurrentWeekAndYear, getTicketSize } from '../types/ticket';

const API_BASE = '/api';

// User preferences only - NOT used for data synchronization
const WEEK_CAPACITIES_KEY = 'pres-scheduler-week-capacities';
const WEEK_RESERVATIONS_KEY = 'pres-scheduler-week-reservations-v2';
const RESERVATION_DEFAULTS_KEY = 'pres-scheduler-reservation-defaults';

// Auto-refresh interval in milliseconds (10 minutes - reduced from 5 to avoid visual disturbance)
const AUTO_REFRESH_INTERVAL = 600000;

interface LockInfo {
  week: number;
  year: number;
}

// Global default reservation settings
export interface ReservationDefaults {
  small: number;   // default 500 lines reserved for small tickets per week
  medium: number;  // default 1500 lines reserved for medium tickets per week
}

// Per-size unlock flags for a specific week
export interface WeekUnlocks {
  small: boolean;   // if true, small reservation is released for this week
  medium: boolean;  // if true, medium reservation is released for this week
}

// Per-week reservation overrides
export interface WeekReservation {
  week: number;
  year: number;
  unlocks: WeekUnlocks;
}

const DEFAULT_RESERVATION_DEFAULTS: ReservationDefaults = {
  small: 500,
  medium: 1500,
};

export function useJiraTickets() {
  const [queueTickets, setQueueTickets] = useState<Ticket[]>([]);
  const [poolTickets, setPoolTickets] = useState<Ticket[]>([]);
  const [lockedTickets, setLockedTickets] = useState<Map<string, LockInfo>>(new Map());
  const [capacity, setCapacity] = useState<CapacityConfig | null>(null);
  const [weeklyCapacity, setWeeklyCapacity] = useState(4000);
  const [weekCapacities, setWeekCapacities] = useState<Record<string, number>>({});
  const [weekReservations, setWeekReservations] = useState<Record<string, WeekReservation>>({});
  const [reservationDefaults, setReservationDefaultsState] = useState<ReservationDefaults>(DEFAULT_RESERVATION_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoMovedTickets, setAutoMovedTickets] = useState<string[]>([]);
  const [expiredTickets, setExpiredTickets] = useState<Ticket[]>([]); // Tickets scheduled in past weeks that weren't completed
  const [jumpedTickets, setJumpedTickets] = useState<Array<{ key: string; fst_key: string }>>([]); // Tickets that were just jumped
  
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInitialLoadRef = useRef(true);
  const autoQueueProcessedRef = useRef(false);
  const expiredCheckProcessedRef = useRef(false);
  const jumpProcessedRef = useRef(false);

  // Load reservation defaults from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(RESERVATION_DEFAULTS_KEY);
    if (saved) {
      try {
        setReservationDefaultsState(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse reservation defaults:', e);
      }
    }
  }, []);

  // Save reservation defaults
  useEffect(() => {
    localStorage.setItem(RESERVATION_DEFAULTS_KEY, JSON.stringify(reservationDefaults));
  }, [reservationDefaults]);

  // Load week reservations from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(WEEK_RESERVATIONS_KEY);
    if (saved) {
      try {
        setWeekReservations(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse week reservations:', e);
      }
    }
  }, []);

  // Save week reservations
  useEffect(() => {
    localStorage.setItem(WEEK_RESERVATIONS_KEY, JSON.stringify(weekReservations));
  }, [weekReservations]);

  // Load week capacities from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(WEEK_CAPACITIES_KEY);
    if (saved) {
      try {
        setWeekCapacities(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse week capacities:', e);
      }
    }
  }, []);

  // Save week capacities
  useEffect(() => {
    localStorage.setItem(WEEK_CAPACITIES_KEY, JSON.stringify(weekCapacities));
  }, [weekCapacities]);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      const [ticketsRes, capacityRes] = await Promise.all([
        fetch(`${API_BASE}/tickets`, { credentials: 'include' }),
        fetch(`${API_BASE}/capacity`, { credentials: 'include' }),
      ]);

      if (ticketsRes.status === 401 || capacityRes.status === 401) {
        // User is not authenticated, don't set error - let auth handle it
        if (!silent) setLoading(false);
        return;
      }

      if (!ticketsRes.ok || !capacityRes.ok) {
        throw new Error('Failed to fetch data from API');
      }

      const [allTickets, cap] = await Promise.all([
        ticketsRes.json(),
        capacityRes.json(),
      ]);

      // ALWAYS use backend data as the SINGLE SOURCE OF TRUTH
      // This ensures all users see the same data
      console.log('[NoMAD] Using backend data as single source of truth');
      
      // Build locks map from backend data
      const locks = new Map<string, LockInfo>();
      
      const queue: Ticket[] = [];
      const pool: Ticket[] = [];
      
      // Sort all tickets by priority_order first
      const sortedTickets = [...allTickets].sort((a: Ticket, b: Ticket) => {
        if (a.priority_order === null && b.priority_order === null) return 0;
        if (a.priority_order === null) return 1;
        if (b.priority_order === null) return -1;
        return (a.priority_order ?? 0) - (b.priority_order ?? 0);
      });
      
      for (const ticket of sortedTickets) {
        // Build locks from backend data
        if (ticket.locked_week != null && ticket.locked_year != null) {
          locks.set(ticket.key, { week: ticket.locked_week, year: ticket.locked_year });
        }
        
        // Distribute to queue or pool based on backend in_queue flag
        if (ticket.in_queue) {
          queue.push(ticket);
        } else {
          pool.push(ticket);
        }
      }
      
      console.log(`[NoMAD] Loaded from backend: ${queue.length} in queue, ${pool.length} in pool`);
      
      setLockedTickets(locks);
        setQueueTickets(queue);
        setPoolTickets(pool);
        isInitialLoadRef.current = false;
      
      setCapacity(cap);
      setWeeklyCapacity(cap.weekly_capacity);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      console.error('Fetch error:', err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh: poll for ticket updates
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => {
      fetchData(true); // Silent refresh - doesn't show loading state
    }, AUTO_REFRESH_INTERVAL);

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
      }
    };
  }, [fetchData]);

  // NOTE: Queue/pool/locks are NO LONGER saved to localStorage
  // The database is the SINGLE SOURCE OF TRUTH for all users
  // This ensures all users see identical data after any change

  const lockTicketToWeek = useCallback((ticketKey: string, week: number, year: number) => {
    setLockedTickets(prev => {
      const next = new Map(prev);
      next.set(ticketKey, { week, year });
      return next;
    });
    
    setQueueTickets(prev => prev.map(t => 
      t.key === ticketKey ? { ...t, locked_week: week, locked_year: year } : t
    ));
  }, []);

  const unlockTicket = useCallback((ticketKey: string) => {
    setLockedTickets(prev => {
      const next = new Map(prev);
      next.delete(ticketKey);
      return next;
    });
    
    setQueueTickets(prev => prev.map(t => 
      t.key === ticketKey ? { ...t, locked_week: undefined, locked_year: undefined } : t
    ));
  }, []);

  const saveOrder = useCallback(async (queue: Ticket[], pool: Ticket[]) => {
    const update: ScheduleUpdate = {
      tickets: [
        ...queue.map((t, i) => ({ 
          key: t.key, 
          priority_order: i, 
          in_queue: true,
          locked_week: t.locked_week,
          locked_year: t.locked_year,
        })),
        ...pool.map((t, i) => ({ key: t.key, priority_order: i, in_queue: false })),
      ],
    };

    try {
      await fetch(`${API_BASE}/tickets/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(update),
      });
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }, []);

  const updateDueDate = useCallback(async (ticketKey: string, week: number, year: number, lines: number = 0) => {
    try {
      const response = await fetch(`${API_BASE}/tickets/due-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket_key: ticketKey, week, year, lines }),
      });
      if (response.ok) {
        const result = await response.json();
        // Return the result including weeks_spanned info
        return result;
      }
      return null;
    } catch (err) {
      console.error('Failed to update due date:', err);
      return null;
    }
  }, []);

  // Unlock a ticket (clear due date in Jira, remove lock in NoMAD, keep in queue)
  const unlockTicketApi = useCallback(async (ticketKey: string) => {
    try {
      const response = await fetch(`${API_BASE}/tickets/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket_key: ticketKey }),
      });
      
      if (response.ok) {
        // Remove from locked tickets map
        setLockedTickets(prev => {
          const next = new Map(prev);
          next.delete(ticketKey);
          return next;
        });
        
        // Update queue ticket to remove lock and clear due date
        setQueueTickets(prev => prev.map(t => 
          t.key === ticketKey 
            ? { ...t, locked_week: undefined, locked_year: undefined, due_date: null }
            : t
        ));
        
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to unlock ticket:', err);
      return false;
    }
  }, []);

  // Reset a mismatched ticket (clear due date in Jira, unschedule in NoMAD)
  const resetMismatch = useCallback(async (ticketKey: string) => {
    try {
      const response = await fetch(`${API_BASE}/tickets/reset-mismatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket_key: ticketKey }),
      });
      
      if (response.ok) {
        // Remove from locked tickets (Map-based state)
        setLockedTickets(prev => {
          const next = new Map(prev);
          next.delete(ticketKey);
          return next;
        });
        
        // Find the ticket before moving it
        const ticketToMove = queueTickets.find(t => t.key === ticketKey);
        
        // Remove from queue
        setQueueTickets(prev => prev.filter(t => t.key !== ticketKey));
        
        // Add to pool with cleared lock/mismatch state
        if (ticketToMove) {
          const resetTicket: Ticket = {
            ...ticketToMove,
            locked_week: undefined,
            locked_year: undefined,
            in_queue: false,
            has_mismatch: false,
            mismatch_type: undefined,
            scheduled_lines: undefined,
            due_date: null,  // Clear due date display
          };
          setPoolTickets(prev => [resetTicket, ...prev]);
        }
        
        // Save the new order to backend
        const newQueue = queueTickets.filter(t => t.key !== ticketKey);
        const newPool = ticketToMove 
          ? [{ ...ticketToMove, locked_week: undefined, locked_year: undefined, in_queue: false }, ...poolTickets]
          : poolTickets;
        await saveOrder(newQueue, newPool);
        
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to reset mismatched ticket:', err);
      return false;
    }
  }, [queueTickets, poolTickets, saveOrder]);

  const setWeekCapacity = useCallback((week: number, year: number, capacity: number) => {
    const key = `${year}-${week}`;
    setWeekCapacities(prev => {
      if (capacity === weeklyCapacity) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: capacity };
    });
  }, [weeklyCapacity]);

  const getWeekCapacity = useCallback((week: number, year: number): number => {
    const key = `${year}-${week}`;
    return weekCapacities[key] ?? weeklyCapacity;
  }, [weekCapacities, weeklyCapacity]);

  // Get the unlock state for a specific week
  const getWeekUnlocks = useCallback((week: number, year: number): WeekUnlocks => {
    const key = `${year}-${week}`;
    return weekReservations[key]?.unlocks ?? { small: false, medium: false };
  }, [weekReservations]);

  // Set unlock for a specific size in a specific week
  const setWeekUnlock = useCallback((week: number, year: number, size: 'small' | 'medium', unlocked: boolean) => {
    const key = `${year}-${week}`;
    setWeekReservations(prev => {
      const existing = prev[key];
      const currentUnlocks = existing?.unlocks ?? { small: false, medium: false };
      const newUnlocks = { ...currentUnlocks, [size]: unlocked };
      
      // If both are false, we can remove the entry
      if (!newUnlocks.small && !newUnlocks.medium) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      
      return {
        ...prev,
        [key]: {
          week,
          year,
          unlocks: newUnlocks,
        },
      };
    });
  }, []);

  // Update reservation defaults
  const setReservationDefaults = useCallback((defaults: ReservationDefaults) => {
    setReservationDefaultsState(defaults);
  }, []);

  // Count unlocked weeks (any size unlocked counts)
  const unlockedWeeksCount = Object.values(weekReservations).filter(
    r => r.unlocks.small || r.unlocks.medium
  ).length;

  // Silent refresh - doesn't show loading state, good for background updates
  const silentRefresh = useCallback(() => {
    return fetchData(true);
  }, [fetchData]);

  // Helper to find next available week for a ticket
  const findNextAvailableWeek = useCallback((
    ticket: Ticket,
    currentQueue: Ticket[],
    startWeekOffset: number = 0
  ): { week: number; year: number } | null => {
    const ticketSize = getTicketSize(ticket.lines);
    const { week: currentWeek, year: currentYear } = getCurrentWeekAndYear();
    
    // Start from the week after the current one (or provided offset)
    for (let offset = Math.max(1, startWeekOffset); offset < 52; offset++) {
      // Calculate target week
      let targetWeek = currentWeek + offset;
      let targetYear = currentYear;
      
      while (targetWeek > 52) {
        targetWeek -= 52;
        targetYear++;
      }
      
      // Calculate used capacity for this week
      const weekKey = `${targetYear}-${targetWeek}`;
      const capacity = weekCapacities[weekKey] ?? weeklyCapacity;
      const unlocks = weekReservations[weekKey]?.unlocks ?? { small: false, medium: false };
      
      // Calculate what's already scheduled in this week
      let usedSmall = 0, usedMedium = 0, usedLarge = 0;
      for (const t of currentQueue) {
        if (t.key === ticket.key) continue; // Exclude the ticket we're moving
        if (t.locked_week === targetWeek && t.locked_year === targetYear) {
          const size = getTicketSize(t.lines);
          if (size === 'small') usedSmall += t.lines;
          else if (size === 'medium') usedMedium += t.lines;
          else usedLarge += t.lines;
        }
      }
      
      const usedTotal = usedSmall + usedMedium + usedLarge;
      
      // Check if this ticket can fit based on its size
      const smallReserved = unlocks.small ? 0 : reservationDefaults.small;
      const mediumReserved = unlocks.medium ? 0 : reservationDefaults.medium;
      
      let canFit = false;
      if (ticketSize === 'small') {
        const available = unlocks.small 
          ? capacity - usedTotal 
          : smallReserved - usedSmall;
        canFit = ticket.lines <= available;
      } else if (ticketSize === 'medium') {
        const available = unlocks.medium 
          ? capacity - usedTotal 
          : mediumReserved - usedMedium;
        canFit = ticket.lines <= available;
      } else {
        // Large
        const largeAvailable = capacity - smallReserved - mediumReserved - usedLarge;
        canFit = ticket.lines <= largeAvailable;
      }
      
      if (canFit) {
        return { week: targetWeek, year: targetYear };
      }
    }
    
    return null; // No available slot found
  }, [weekCapacities, weeklyCapacity, weekReservations, reservationDefaults]);

  // Auto-queue: Move unapproved tickets whose scheduled week has started to next available slot
  const processAutoQueue = useCallback(async () => {
    if (autoQueueProcessedRef.current) return []; // Already processed this session
    
    const ticketsToMove: Ticket[] = [];
    
    // Find all unapproved tickets whose scheduled week has started
    for (const ticket of queueTickets) {
      if (
        !ticket.is_approved &&
        ticket.locked_week != null &&
        ticket.locked_year != null &&
        hasScheduledWeekStarted(ticket)
      ) {
        ticketsToMove.push(ticket);
      }
    }
    
    if (ticketsToMove.length === 0) {
      autoQueueProcessedRef.current = true;
      return [];
    }
    
    console.log(`[NoMAD] Auto-queue: Moving ${ticketsToMove.length} unapproved ticket(s) to next available slots`);
    
    let updatedQueue = [...queueTickets];
    const movedTicketKeys: string[] = [];
    
    for (const ticket of ticketsToMove) {
      const nextSlot = findNextAvailableWeek(ticket, updatedQueue);
      
      if (nextSlot) {
        console.log(`[NoMAD] Auto-queue: Moving ${ticket.key} from W${ticket.locked_week} to W${nextSlot.week}`);
        
        // Update the ticket in the queue
        updatedQueue = updatedQueue.map(t => 
          t.key === ticket.key 
            ? { ...t, locked_week: nextSlot.week, locked_year: nextSlot.year }
            : t
        );
        
        movedTicketKeys.push(ticket.key);
        
        // Update due date in Jira (fire and forget)
        updateDueDate(ticket.key, nextSlot.week, nextSlot.year, ticket.lines).catch(err => {
          console.error(`[NoMAD] Failed to update due date for ${ticket.key}:`, err);
        });
      } else {
        console.warn(`[NoMAD] Auto-queue: No available slot found for ${ticket.key}`);
      }
    }
    
    if (movedTicketKeys.length > 0) {
      setQueueTickets(updatedQueue);
      setAutoMovedTickets(movedTicketKeys);
      
      // Save the updated order to backend
      await saveOrder(updatedQueue, poolTickets);
    }
    
    autoQueueProcessedRef.current = true;
    return movedTicketKeys;
  }, [queueTickets, poolTickets, findNextAvailableWeek, updateDueDate, saveOrder]);

  // Clear auto-moved tickets notification
  const clearAutoMovedNotification = useCallback(() => {
    setAutoMovedTickets([]);
  }, []);

  // Process approved tickets that should be jumped (week has started)
  // Includes both locked tickets AND auto-scheduled tickets in the current week
  const processJumpedTickets = useCallback(async () => {
    if (jumpProcessedRef.current) return [];
    
    const ticketsToJump: Ticket[] = [];
    const { week: currentWeek, year: currentYear } = getCurrentWeekAndYear();
    
    // Calculate effective week for auto-scheduled tickets based on queue position
    // This is a simplified calculation - just checks if cumulative lines fit in current week
    let cumulativeLines = 0;
    
    for (const ticket of queueTickets) {
      if (ticket.is_approved && !ticket.is_jumped && ticket.status.toLowerCase() !== 'jumped') {
        // Check if ticket is LOCKED to current week
        const isLockedToCurrentWeek = 
          ticket.locked_week === currentWeek && 
          ticket.locked_year === currentYear &&
          hasScheduledWeekStarted(ticket);
        
        // Check if ticket is AUTO-SCHEDULED to current week (no lock, but position puts it in week 1)
        const isAutoScheduledToCurrentWeek = 
          ticket.locked_week == null && 
          ticket.locked_year == null &&
          cumulativeLines + ticket.lines <= weeklyCapacity;
        
        if (isLockedToCurrentWeek || isAutoScheduledToCurrentWeek) {
          ticketsToJump.push(ticket);
        }
      }
      
      // Track cumulative lines for auto-scheduled calculation (only unlocked tickets)
      if (ticket.locked_week == null) {
        cumulativeLines += ticket.lines;
      }
    }
    
    if (ticketsToJump.length === 0) {
      jumpProcessedRef.current = true;
      return [];
    }
    
    console.log(`[NoMAD] Jumping ${ticketsToJump.length} approved ticket(s) in current week (W${currentWeek})`);
    
    const jumpedResults: Array<{ key: string; fst_key: string }> = [];
    
    for (const ticket of ticketsToJump) {
      try {
        const response = await fetch(`${API_BASE}/tickets/jump`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ticket_key: ticket.key }),
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`[NoMAD] Jumped ${ticket.key} -> FST: ${result.fst_key}`);
          jumpedResults.push({ key: ticket.key, fst_key: result.fst_key });
          
          // Update the ticket in queue to mark as jumped
          setQueueTickets(prev => prev.map(t =>
            t.key === ticket.key
              ? { ...t, is_jumped: true, fst_key: result.fst_key, status: 'Jumped' }
              : t
          ));
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error(`[NoMAD] Failed to jump ${ticket.key}:`, errorData);
        }
      } catch (err) {
        console.error(`[NoMAD] Error jumping ${ticket.key}:`, err);
      }
    }
    
    if (jumpedResults.length > 0) {
      setJumpedTickets(jumpedResults);
    }
    
    jumpProcessedRef.current = true;
    return jumpedResults;
  }, [queueTickets, weeklyCapacity]);

  // Clear jumped tickets notification
  const clearJumpedNotification = useCallback(() => {
    setJumpedTickets([]);
  }, []);

  // Check for expired tickets and AUTO-RETURN them to queue (unlocked)
  const checkExpiredTickets = useCallback(async () => {
    if (expiredCheckProcessedRef.current) return;
    
    const expired: Ticket[] = [];
    
    for (const ticket of queueTickets) {
      if (
        ticket.locked_week != null &&
        ticket.locked_year != null &&
        hasScheduledWeekPassed(ticket) &&
        !isCompletedStatus(ticket) &&
        !ticket.was_auto_returned  // Don't re-process already returned tickets
      ) {
        expired.push(ticket);
      }
    }
    
    if (expired.length > 0) {
      console.log(`[NoMAD] Found ${expired.length} expired ticket(s) - auto-returning to queue`);
      
      // Update tickets in queue to be unlocked and marked as auto-returned
      const expiredKeys = new Set(expired.map(t => t.key));
      const updatedQueue = queueTickets.map(t => {
        if (expiredKeys.has(t.key)) {
          return {
            ...t,
            locked_week: undefined,
            locked_year: undefined,
            was_auto_returned: true,
          };
        }
        return t;
      });
      
      setQueueTickets(updatedQueue);
      setExpiredTickets(expired);  // Show notification
      
      // Call backend to persist the auto-return state and clear Jira due dates
      try {
        await fetch(`${API_BASE}/tickets/auto-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ticket_keys: expired.map(t => t.key) }),
        });
        console.log(`[NoMAD] Auto-returned ${expired.length} ticket(s) to queue`);
      } catch (err) {
        console.error('[NoMAD] Failed to persist auto-return state:', err);
      }
      
      // Save updated queue order
      await saveOrder(updatedQueue, poolTickets);
    }
    
    expiredCheckProcessedRef.current = true;
  }, [queueTickets, poolTickets, saveOrder]);

  // Dismiss expired tickets notification (one-time only)
  const dismissExpiredAlert = useCallback(() => {
    setExpiredTickets([]);
  }, []);

  return {
    queueTickets,
    setQueueTickets,
    poolTickets,
    setPoolTickets,
    lockedTickets,
    lockTicketToWeek,
    unlockTicket,
    unlockTicketApi,
    capacity,
    weeklyCapacity,
    setWeeklyCapacity,
    weekCapacities,
    setWeekCapacity,
    getWeekCapacity,
    weekReservations,
    getWeekUnlocks,
    setWeekUnlock,
    reservationDefaults,
    setReservationDefaults,
    unlockedWeeksCount,
    loading,
    error,
    refresh: fetchData,
    silentRefresh,
    saveOrder,
    updateDueDate,
    resetMismatch,
    // Auto-queue functionality
    autoMovedTickets,
    processAutoQueue,
    clearAutoMovedNotification,
    // Expired tickets functionality
    expiredTickets,
    checkExpiredTickets,
    dismissExpiredAlert,
    // Jumped tickets functionality
    jumpedTickets,
    processJumpedTickets,
    clearJumpedNotification,
  };
}
