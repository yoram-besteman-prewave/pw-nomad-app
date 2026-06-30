import { useCallback, useState } from 'react';
import type { Ticket, CapacityConfig } from '../types/ticket';
import { useJiraTickets } from './useJiraTickets';

type BoardData = ReturnType<typeof useJiraTickets>;

const DEFAULT_WEEKLY_CAPACITY = 4000;
const DEFAULT_RESERVATION_DEFAULTS: BoardData['reservationDefaults'] = {
  small: 500,
  medium: 1500,
};

const DEFAULT_UNLOCKS: ReturnType<BoardData['getWeekUnlocks']> = {
  small: false,
  medium: false,
};

export function useEmptyBoard(): BoardData {
  const [queueTickets, setQueueTickets] = useState<Ticket[]>([]);
  const [poolTickets, setPoolTickets] = useState<Ticket[]>([]);
  const [lockedTickets, setLockedTickets] = useState<BoardData['lockedTickets']>(new Map());
  const [weeklyCapacity, setWeeklyCapacity] = useState(DEFAULT_WEEKLY_CAPACITY);
  const [weekCapacities, setWeekCapacities] = useState<BoardData['weekCapacities']>({});
  const [weekReservations, setWeekReservations] = useState<BoardData['weekReservations']>({});
  const [reservationDefaults, setReservationDefaults] = useState<BoardData['reservationDefaults']>(DEFAULT_RESERVATION_DEFAULTS);

  const capacity: CapacityConfig = {
    weekly_capacity: weeklyCapacity,
    small_ticket_reservation: reservationDefaults.small,
    current_week: 0,
    current_year: 0,
  };

  const lockTicketToWeek = useCallback((ticketKey: string, week: number, year: number) => {
    setLockedTickets(prev => {
      const next = new Map(prev);
      next.set(ticketKey, { week, year });
      return next;
    });
    setQueueTickets(prev => prev.map(ticket =>
      ticket.key === ticketKey ? { ...ticket, locked_week: week, locked_year: year } : ticket
    ));
  }, []);

  const unlockTicket = useCallback((ticketKey: string) => {
    setLockedTickets(prev => {
      const next = new Map(prev);
      next.delete(ticketKey);
      return next;
    });
    setQueueTickets(prev => prev.map(ticket =>
      ticket.key === ticketKey ? { ...ticket, locked_week: undefined, locked_year: undefined } : ticket
    ));
  }, []);

  const setWeekCapacity = useCallback((week: number, year: number, capacityValue: number) => {
    const key = `${year}-${week}`;
    setWeekCapacities(prev => {
      if (capacityValue === weeklyCapacity) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: capacityValue };
    });
  }, [weeklyCapacity]);

  const getWeekCapacity = useCallback((week: number, year: number) => {
    const key = `${year}-${week}`;
    return weekCapacities[key] ?? weeklyCapacity;
  }, [weekCapacities, weeklyCapacity]);

  const getWeekUnlocks = useCallback((week: number, year: number) => {
    const key = `${year}-${week}`;
    return weekReservations[key]?.unlocks ?? DEFAULT_UNLOCKS;
  }, [weekReservations]);

  const setWeekUnlock = useCallback((week: number, year: number, size: 'small' | 'medium', unlocked: boolean) => {
    const key = `${year}-${week}`;
    setWeekReservations(prev => {
      const existing = prev[key];
      const currentUnlocks = existing?.unlocks ?? DEFAULT_UNLOCKS;
      const newUnlocks = { ...currentUnlocks, [size]: unlocked };

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

  const refresh = useCallback(async () => undefined, []);
  const silentRefresh = useCallback(async () => undefined, []);
  const saveOrder = useCallback(async () => undefined, []);
  const updateDueDate = useCallback(async () => null, []);
  const unlockTicketApi = useCallback(async (ticketKey: string) => {
    unlockTicket(ticketKey);
    return true;
  }, [unlockTicket]);
  const resetMismatch = useCallback(async () => false, []);
  const processAutoQueue = useCallback(async () => [], []);
  const clearAutoMovedNotification = useCallback(() => undefined, []);
  const checkExpiredTickets = useCallback(async () => undefined, []);
  const dismissExpiredAlert = useCallback(() => undefined, []);
  const processJumpedTickets = useCallback(async () => [], []);
  const clearJumpedNotification = useCallback(() => undefined, []);

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
    unlockedWeeksCount: Object.values(weekReservations).filter(
      reservation => reservation.unlocks.small || reservation.unlocks.medium
    ).length,
    loading: false,
    error: null,
    refresh,
    silentRefresh,
    saveOrder,
    updateDueDate,
    resetMismatch,
    autoMovedTickets: [],
    processAutoQueue,
    clearAutoMovedNotification,
    expiredTickets: [],
    checkExpiredTickets,
    dismissExpiredAlert,
    jumpedTickets: [],
    processJumpedTickets,
    clearJumpedNotification,
  };
}
