import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type Modifier,
  type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';

import { useAuth } from './hooks/useAuth';
import { usePresence } from './hooks/usePresence';
import { useJiraTickets } from './hooks/useJiraTickets';
import { LoginScreen } from './components/LoginScreen';
import { SessionWarning } from './components/SessionWarning';
import { UserPresence } from './components/UserPresence';
import { CursorOverlay } from './components/CursorOverlay';
import { QueueItem } from './components/QueueItem';
import { PoolItem } from './components/PoolItem';
import { TicketDetail } from './components/TicketDetail';
import { MoveDialog } from './components/MoveDialog';
import { Settings } from './components/Settings';
import { CapacityTimeline, type WeekData, type TicketPlacement } from './components/CapacityTimeline';
import { WeekDetail } from './components/WeekDetail';
import { Toast } from './components/Toast';
import { AdminPortal } from './components/AdminPortal';
import { ECPanel } from './components/ECPanel';
import { ExpiredTicketsDialog } from './components/ExpiredTicketsDialog';
import type { Ticket } from './types/ticket';

// App version - keep in sync with backend
const APP_VERSION = 'v0.2.0';
import { getTicketSize, isSchedulable, getScheduleBlockReason, getScheduledBySize, canScheduleTicket, getCurrentWeekAndYear } from './types/ticket';

// Custom modifier to snap drag overlay center to cursor for consistent feel
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (activatorEvent && draggingNodeRect) {
    const activatorCoordinates = {
      x: (activatorEvent as MouseEvent).clientX ?? (activatorEvent as TouchEvent).touches?.[0]?.clientX ?? 0,
      y: (activatorEvent as MouseEvent).clientY ?? (activatorEvent as TouchEvent).touches?.[0]?.clientY ?? 0,
    };

    const offsetX = activatorCoordinates.x - draggingNodeRect.left - draggingNodeRect.width / 2;
    const offsetY = activatorCoordinates.y - draggingNodeRect.top - draggingNodeRect.height / 2;

    return {
      ...transform,
      x: transform.x + offsetX,
      y: transform.y + offsetY,
    };
  }
  return transform;
};

// Note: customCollisionDetection is defined inside AuthenticatedApp component
// to access queueTicketKeys for smart reorder vs week-drop prioritization

// Helper to get week info from offset
function getWeekInfo(weekOffset: number): { week: number; year: number; label: string } {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + weekOffset * 7);
  
  const d = new Date(Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  
  const weekStart = new Date(target);
  weekStart.setDate(target.getDate() - target.getDay() + 1);
  
  return {
    week,
    year: d.getUTCFullYear(),
    label: `W${week} · ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
  };
}



function DroppableQueue({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'queue' });
  return (
    <div 
      ref={setNodeRef} 
      className={`min-h-[400px] h-full p-3 rounded-xl transition-all duration-200 ${
        isOver 
          ? 'bg-blue-50 border-2 border-blue-300 shadow-lg' 
          : 'bg-gray-50/50 border-2 border-dashed border-gray-300'
      }`}
    >
      <div className="mb-2 pb-1.5 text-center text-[10px] text-gray-400 border-b border-dashed border-gray-200">
        Tickets dropped here are scheduled automatically by capacity
      </div>
      {isOver && (
        <div className="mb-2 py-2 text-center bg-blue-100 rounded-lg border-2 border-dashed border-blue-300 text-blue-600 text-sm font-medium animate-pulse">
          ↓ Drop here to add to queue ↓
        </div>
      )}
      {children}
    </div>
  );
}

interface DroppableLaneProps {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}

function DroppableLane({ id, title, subtitle, count, children }: DroppableLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className={`mb-3 transition-all rounded-lg ${isOver ? 'border-2 border-amber-400 bg-amber-50 shadow-md' : 'border-2 border-transparent'}`}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-gray-700">{title}</span>
          <span className="text-[10px] text-gray-400">{subtitle}</span>
        </div>
        <span className="text-[10px] text-gray-400">{count}</span>
      </div>
      {isOver && (
        <div className="mx-2 mb-1 py-1 text-center bg-amber-100 rounded border border-dashed border-amber-300 text-amber-600 text-xs font-medium">
          ↓ Drop here ↓
        </div>
      )}
      <div 
        ref={setNodeRef} 
        className="min-h-[60px] px-1"
      >
        {children}
      </div>
    </div>
  );
}

// Large droppable wrapper for entire backlog panel
function DroppableBacklog({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog' });
  
    return (
    <div 
      ref={setNodeRef}
      className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar transition-all duration-200 rounded-lg mx-1 ${
        isOver 
          ? 'bg-amber-50 border-2 border-amber-400 shadow-inner' 
          : 'border-2 border-transparent'
      }`}
    >
      {isOver && (
        <div className="sticky top-0 z-10 mx-2 mb-2 py-2 text-center bg-amber-100 rounded-lg border-2 border-dashed border-amber-400 text-amber-700 text-sm font-medium animate-pulse shadow-sm">
          ↓ Drop here to move to backlog ↓
        </div>
      )}
      {children}
    </div>
  );
}

// NoMAD Compass Logo Component
function CompassLogo({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" fill="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        {/* Compass ring */}
        <circle cx="100" cy="100" r="60" fill="none"/>
        {/* Cardinal ticks */}
        <path d="M100 40 L100 55 M100 160 L100 145 M160 100 L145 100 M40 100 L55 100" strokeWidth="4"/>
        {/* North needle (filled) - points up */}
        <path d="M100 60 L118 100 L82 100 Z" stroke="none"/>
        {/* South needle (outline) */}
        <path d="M82 100 L100 140 L118 100" fill="none" strokeWidth="3"/>
        {/* Center dot */}
        <circle cx="100" cy="100" r="6" fill="currentColor" stroke="none"/>
      </g>
    </svg>
  );
}

// Mini compass for loading animation
function MiniCompass({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" fill="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="100" cy="100" r="55" fill="none"/>
        <path d="M100 60 L115 100 L85 100 Z" stroke="none"/>
        <path d="M85 100 L100 140 L115 100" fill="none" strokeWidth="4"/>
        <circle cx="100" cy="100" r="5" fill="currentColor" stroke="none"/>
      </g>
    </svg>
  );
}

// Creative Loading Screen - Compass navigating between tickets
function LoadingScreen({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center overflow-hidden">
      {/* Ticket visualization area */}
      <div className="relative w-[500px] h-[280px] mb-8">
        {/* Animated compass navigating between tickets */}
        <div className="compass-navigator absolute z-10">
          <MiniCompass className="w-8 h-8 text-slate-800 drop-shadow-md" />
        </div>
        
        {/* Ticket placeholders - pop in sequentially */}
        <div className="ticket-placeholder ticket-pop-in absolute left-8 top-2 w-48 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '0.1s' }}>
          <div className="w-6 h-6 rounded bg-blue-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-20" />
            <div className="h-1.5 bg-gray-100 rounded w-28" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute right-12 top-2 w-44 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '0.3s' }}>
          <div className="w-6 h-6 rounded bg-amber-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-16" />
            <div className="h-1.5 bg-gray-100 rounded w-24" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute left-20 top-16 w-52 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '0.5s' }}>
          <div className="w-6 h-6 rounded bg-emerald-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-24" />
            <div className="h-1.5 bg-gray-100 rounded w-32" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute right-8 top-[70px] w-40 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '0.7s' }}>
          <div className="w-6 h-6 rounded bg-red-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-14" />
            <div className="h-1.5 bg-gray-100 rounded w-20" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute left-6 top-[130px] w-56 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '0.9s' }}>
          <div className="w-6 h-6 rounded bg-purple-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-28" />
            <div className="h-1.5 bg-gray-100 rounded w-36" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute right-16 top-[135px] w-48 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '1.1s' }}>
          <div className="w-6 h-6 rounded bg-cyan-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-20" />
            <div className="h-1.5 bg-gray-100 rounded w-28" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute left-24 top-[200px] w-44 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '1.3s' }}>
          <div className="w-6 h-6 rounded bg-orange-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-18" />
            <div className="h-1.5 bg-gray-100 rounded w-24" />
          </div>
        </div>
        
        <div className="ticket-placeholder ticket-pop-in absolute right-20 top-[205px] w-52 h-12 bg-gray-50 border border-gray-200 rounded-lg shadow-sm flex items-center px-3 gap-2" style={{ animationDelay: '1.5s' }}>
          <div className="w-6 h-6 rounded bg-pink-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-gray-200 rounded w-24" />
            <div className="h-1.5 bg-gray-100 rounded w-32" />
          </div>
        </div>
      </div>
      
      {/* Brand */}
        <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-800 tracking-wide">NoMAD</h1>
        <p className="mt-2 text-slate-400 text-sm">{message}</p>
        </div>
      </div>
    );
}

// Minimalist Session Invalidated Screen - White background, professional
function SessionInvalidatedModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-gray-100 flex items-center justify-center p-4">
      {/* Centered notification card */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full max-w-sm p-8 text-center">
        {/* Logo with animated question marks */}
        <div className="relative inline-block mb-6">
          <CompassLogo className="w-20 h-20 text-slate-300" />
          {/* Question marks with staggered fade-bounce */}
          <span className="absolute -top-2 -right-4 text-3xl font-bold question-pop" style={{ animationDelay: '0s' }}>
            <span className="text-amber-500">?</span>
          </span>
          <span className="absolute top-1/2 -right-6 text-xl font-bold question-pop" style={{ animationDelay: '0.2s' }}>
            <span className="text-amber-400">?</span>
          </span>
          <span className="absolute -bottom-1 -left-4 text-2xl font-bold question-pop" style={{ animationDelay: '0.4s' }}>
            <span className="text-amber-500">?</span>
          </span>
          <span className="absolute top-0 -left-5 text-lg font-bold question-pop" style={{ animationDelay: '0.6s' }}>
            <span className="text-amber-400">?</span>
          </span>
        </div>
        
        {/* Title */}
        <h2 className="text-xl font-semibold text-slate-800 mb-3">
          Session Ended
        </h2>
        
        {/* Message */}
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          {message}
        </p>
        
        {/* Action button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-6 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg"
        >
          Sign In Again
        </button>
      </div>
    </div>
  );
}

interface CapacityOverflowDialogProps {
  ticketKey: string;
  ticketLines: number;
  targetWeek: number;
  weeksNeeded: number;
  startWeek: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function CapacityOverflowDialog({ 
  ticketKey, 
  ticketLines, 
  targetWeek, 
  weeksNeeded, 
  startWeek, 
  onConfirm, 
  onCancel 
}: CapacityOverflowDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Exceeds Week Capacity</h3>
        </div>
        <p className="text-gray-600 mb-2">
          <strong>{ticketKey}</strong> ({ticketLines.toLocaleString()} lines) exceeds W{targetWeek} capacity.
        </p>
        <p className="text-gray-600 mb-4">
          Schedule across <strong>W{startWeek}-W{targetWeek}</strong> ({weeksNeeded} weeks) with due date end of W{targetWeek}?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  // Auth state
  const auth = useAuth();
  
  // Session invalidation handling - at App level BEFORE AuthenticatedApp renders
  const [sessionInvalidatedMessage, setSessionInvalidatedMessage] = useState<string | null>(null);
  
  const handleSessionInvalidated = useCallback((message: string) => {
    setSessionInvalidatedMessage(message);
  }, []);
  
  // Real-time data sync - store pending update flag, refresh handled in AuthenticatedApp
  // Database is single source of truth - sync immediately when other users make changes
  const [pendingDataUpdate, setPendingDataUpdate] = useState(false);
  const lastSyncRef = useRef<number>(0);
  const handleDataUpdated = useCallback((changeType: string, details: Record<string, unknown>) => {
    // Light debounce: don't trigger more than once every 500ms (was 5000ms)
    // This ensures all users see the same data quickly
    const now = Date.now();
    if (now - lastSyncRef.current < 500) {
      console.log('[Sync] Skipping - debounce');
      return;
    }
    lastSyncRef.current = now;
    
    // Skip if this change was made by the current user (their UI is already updated)
    const changedBy = details?.user_email as string | undefined;
    if (changedBy && auth.user?.email && changedBy === auth.user.email) {
      console.log('[Sync] Skipping - change was made by current user');
      return;
    }
    
    console.log('[Sync] Data updated by another user:', changeType, details);
    setPendingDataUpdate(true);
  }, [auth.user?.email]);
  
  // Presence hook at App level for session handling
  const { users: presenceUsers, cursors, connected: presenceConnected } = usePresence(
    auth.authenticated,
    handleSessionInvalidated,
    handleDataUpdated
  );
  
  // Clear localStorage helper for clean logout
  const clearLocalStorage = useCallback(() => {
    localStorage.removeItem('pres-scheduler-queue');
    localStorage.removeItem('pres-scheduler-pool');
    localStorage.removeItem('pres-scheduler-locks');
    localStorage.removeItem('pres-scheduler-week-capacities');
    localStorage.removeItem('pres-scheduler-week-reservations-v2');
    localStorage.removeItem('pres-scheduler-reservation-defaults');
  }, []);
  
  // Show session invalidated modal BEFORE rendering AuthenticatedApp
  if (sessionInvalidatedMessage) {
    return (
      <>
        <div className="min-h-screen bg-slate-900" />
        <SessionInvalidatedModal 
          message={sessionInvalidatedMessage} 
          onClose={() => {
            clearLocalStorage();
            setSessionInvalidatedMessage(null);
            auth.logout();
          }} 
        />
      </>
    );
  }

  // Show login screen if not authenticated
  if (auth.loading) {
    return <LoadingScreen message="Authenticating" />;
  }

  if (!auth.authenticated) {
    return <LoginScreen onLogin={auth.login} error={auth.error} />;
  }

  return (
    <AuthenticatedApp 
      auth={auth} 
      presenceUsers={presenceUsers} 
      cursors={cursors}
      presenceConnected={presenceConnected}
      pendingDataUpdate={pendingDataUpdate}
      onDataUpdateHandled={() => setPendingDataUpdate(false)}
    />
  );
}

interface AuthenticatedAppProps {
  auth: ReturnType<typeof useAuth>;
  presenceUsers: Array<{ email: string; name: string; picture: string }>;
  cursors: Map<string, { x: number; y: number }>;
  presenceConnected: boolean;
  pendingDataUpdate: boolean;
  onDataUpdateHandled: () => void;
}

function AuthenticatedApp({ auth, presenceUsers, cursors, presenceConnected, pendingDataUpdate, onDataUpdateHandled }: AuthenticatedAppProps) {
  const {
    queueTickets, setQueueTickets,
    poolTickets, setPoolTickets,
    lockTicketToWeek, unlockTicket, unlockTicketApi,
    weeklyCapacity, setWeeklyCapacity,
    weekCapacities, setWeekCapacity,
    getWeekCapacity,
    weekReservations,
    getWeekUnlocks,
    setWeekUnlock,
    reservationDefaults,
    setReservationDefaults,
    unlockedWeeksCount,
    loading, error, refresh, silentRefresh, saveOrder,
    updateDueDate,
    resetMismatch,
    autoMovedTickets,
    processAutoQueue,
    clearAutoMovedNotification,
    // Expired tickets
    expiredTickets,
    checkExpiredTickets,
    dismissExpiredAlert,
    // Jumped tickets
    jumpedTickets,
    processJumpedTickets,
    clearJumpedNotification,
  } = useJiraTickets();

  // Handle pending data updates from other users (triggered via WebSocket)
  useEffect(() => {
    if (pendingDataUpdate) {
      console.log('[Sync] Performing silent refresh due to data update from another user');
      silentRefresh();
      onDataUpdateHandled();
    }
  }, [pendingDataUpdate, silentRefresh, onDataUpdateHandled]);

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [moveTicket, setMoveTicket] = useState<Ticket | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeekData | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminPortal, setShowAdminPortal] = useState(false);
  const [showECPanel, setShowECPanel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'warning' | 'error' } | null>(null);
  const [dueDateUpdatingTicket, setDueDateUpdatingTicket] = useState<string | null>(null);
  
  // State for capacity overflow confirmation dialog
  const [overflowDialog, setOverflowDialog] = useState<{
    ticket: Ticket;
    targetWeek: number;
    targetYear: number;
    weeksNeeded: number;
    startWeek: number;
    startYear: number;
    fromPool: boolean;
  } | null>(null);
  
  // State for immediate jump confirmation (locking to current week)
  const [immediateJumpDialog, setImmediateJumpDialog] = useState<{
    ticket: Ticket;
    targetWeek: number;
    targetYear: number;
    fromPool: boolean;
  } | null>(null);
  
  // State for shareable ticket links
  const [highlightedTicket, setHighlightedTicket] = useState<string | null>(null);
  const ticketRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Track save operation version to prevent stale saves from overwriting newer state
  const saveVersionRef = useRef(0);
  
  // Debounced silent refresh to prevent overlapping refreshes during rapid operations
  const silentRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSilentRefresh = useCallback(() => {
    // Clear any pending refresh
    if (silentRefreshTimeoutRef.current) {
      clearTimeout(silentRefreshTimeoutRef.current);
    }
    // Schedule a new refresh after 1.5 seconds of inactivity (allow time for save to complete)
    silentRefreshTimeoutRef.current = setTimeout(() => {
      silentRefresh();
      silentRefreshTimeoutRef.current = null;
    }, 1500);
  }, [silentRefresh]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Hide jumped tickets toggle
  const [hideJumpedTickets, setHideJumpedTickets] = useState(false);
  
  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { 
      activationConstraint: { 
        distance: 8,  // Increased to prevent accidental drags
      } 
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      }
    })
  );

  // Set of queue ticket keys for fast lookup in collision detection
  const queueTicketKeys = useMemo(() => 
    new Set(queueTickets.map(t => t.key)), 
    [queueTickets]
  );

  // Custom collision detection with correct priority:
  // 1. Week drops (locking) - FIRST priority when pointer over timeline
  // 2. Queue reordering (closestCenter) - for smooth sortable behavior
  // 3. Other containers (queue, backlog, pool lanes)
  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    const activeId = args.active.id as string;
    const isDraggingFromQueue = queueTicketKeys.has(activeId);
    
    // FIRST: Check if pointer is over a week drop zone (for locking)
    // Week drops ALWAYS take priority - user explicitly dragging to timeline
    const pointerCollisions = pointerWithin(args);
    const weekCollision = pointerCollisions.find(c => String(c.id).startsWith('week-drop-'));
    if (weekCollision) {
      return [weekCollision]; // Lock to week takes priority
    }
    
    // SECOND: For queue reordering (only if NOT over a week)
    // Use closestCenter for smooth sortable list behavior
    if (isDraggingFromQueue) {
      const centerCollisions = closestCenter(args);
      const queueItemCollision = centerCollisions.find(c => 
        queueTicketKeys.has(String(c.id)) && c.id !== activeId
      );
      if (queueItemCollision) {
        return [queueItemCollision]; // Reorder within queue
      }
    }
    
    // THIRD: Other drop zones (queue container, backlog, pool lanes)
    if (pointerCollisions.length > 0) {
      const queueCollision = pointerCollisions.find(c => c.id === 'queue');
      if (queueCollision) return [queueCollision];
      
      const backlogCollision = pointerCollisions.find(c => c.id === 'backlog');
      if (backlogCollision) return [backlogCollision];
      
      const poolLaneCollision = pointerCollisions.find(c => String(c.id).startsWith('pool-'));
      if (poolLaneCollision) return [poolLaneCollision];
      
      return pointerCollisions;
    }
    
    // Fallback to rect intersection only if pointer isn't over any droppable
    return rectIntersection(args);
  }, [queueTicketKeys]);

  const showToast = useCallback((message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    setToast({ message, type });
  }, []);
  
  // Process auto-queue on load (move unapproved tickets whose week has started)
  // Also check for expired tickets (scheduled in past but not completed)
  // And process jumping for approved tickets whose week has started
  useEffect(() => {
    if (!loading && queueTickets.length > 0) {
      processAutoQueue();
      checkExpiredTickets();
      processJumpedTickets();
    }
  }, [loading, queueTickets.length, processAutoQueue, checkExpiredTickets, processJumpedTickets]);
  
  // Show toast when tickets are auto-moved
  useEffect(() => {
    if (autoMovedTickets.length > 0) {
      const count = autoMovedTickets.length;
      showToast(
        `${count} ticket${count > 1 ? 's' : ''} auto-moved to next available slot (pending approval)`,
        'warning'
      );
      clearAutoMovedNotification();
    }
  }, [autoMovedTickets, showToast, clearAutoMovedNotification]);

  // Show toast when tickets are jumped
  useEffect(() => {
    if (jumpedTickets.length > 0) {
      const count = jumpedTickets.length;
      showToast(
        `${count} ticket${count > 1 ? 's' : ''} handed off! FST ticket${count > 1 ? 's' : ''} created.`,
        'info'
      );
      clearJumpedNotification();
    }
  }, [jumpedTickets, showToast, clearJumpedNotification]);
  
  // Check for ?ticket= URL param on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ticketParam = urlParams.get('ticket');
    
    if (ticketParam) {
      // Store in localStorage so it persists through login
      localStorage.setItem('nomad_highlight_ticket', ticketParam);
      // Clear URL param without reload
      window.history.replaceState({}, '', window.location.pathname);
    }
    
    // Check localStorage for pending highlight
    const pendingTicket = localStorage.getItem('nomad_highlight_ticket');
    if (pendingTicket) {
      setHighlightedTicket(pendingTicket);
    }
  }, []);
  
  // Scroll to and highlight ticket when data loads
  useEffect(() => {
    if (!highlightedTicket || loading) return;
    
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const ticketElement = ticketRefs.current.get(highlightedTicket);
      if (ticketElement) {
        ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ticketElement.classList.add('highlight-ticket');
        
        // Remove highlight after animation
        setTimeout(() => {
          ticketElement.classList.remove('highlight-ticket');
          setHighlightedTicket(null);
          localStorage.removeItem('nomad_highlight_ticket');
        }, 2000);
      } else {
        // Ticket not found in queue, check pool or show message
        const allTickets = [...queueTickets, ...poolTickets];
        const found = allTickets.find(t => t.key === highlightedTicket);
        if (!found) {
          showToast(`Ticket ${highlightedTicket} not found`, 'warning');
        }
        localStorage.removeItem('nomad_highlight_ticket');
        setHighlightedTicket(null);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [highlightedTicket, loading, queueTickets, poolTickets, showToast]);
  
  // Copy share link to clipboard
  const copyShareLink = useCallback((ticketKey: string) => {
    const url = `${window.location.origin}?ticket=${ticketKey}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast(`Link copied: ${ticketKey}`, 'info');
    }).catch(() => {
      showToast('Failed to copy link', 'error');
    });
  }, [showToast]);

  // Handler for confirming multi-week overflow scheduling
  // BACKWARD SPANNING: Lock to TARGET week, capacity distributed backward from there
  const confirmOverflowSchedule = useCallback(async () => {
    if (!overflowDialog) return;
    
    const { ticket, targetWeek, targetYear, weeksNeeded, startWeek, fromPool } = overflowDialog;
    setOverflowDialog(null);
    
    let newQueue = [...queueTickets];
    let newPool = [...poolTickets];
    
    // Lock to TARGET week - this is where the due date will be (end of target week)
    // Capacity is consumed BACKWARD from target week
    if (fromPool) {
      newPool = poolTickets.filter(t => t.key !== ticket.key);
      const lockedTicket = { ...ticket, locked_week: targetWeek, locked_year: targetYear };
      newQueue = [...queueTickets, lockedTicket];
    } else {
      newQueue = queueTickets.map(t => 
        t.key === ticket.key ? { ...t, locked_week: targetWeek, locked_year: targetYear } : t
      );
    }
    
    setQueueTickets(newQueue);
    setPoolTickets(newPool);
    lockTicketToWeek(ticket.key, targetWeek, targetYear);
    
    setDueDateUpdatingTicket(ticket.key);
    setIsSaving(true);
    
    try {
      // Update due date to end of TARGET week (no multi-week forward calc needed on backend)
      const [, dueDateResult] = await Promise.all([
        saveOrder(newQueue, newPool),
        updateDueDate(ticket.key, targetWeek, targetYear, 0), // Pass 0 for lines - due date is just end of target week
      ]);
      
      if (dueDateResult) {
        const friday = getFridayOfWeek(targetWeek, targetYear);
        setQueueTickets(prev => prev.map(t => 
          t.key === ticket.key ? { ...t, due_date: friday.toISOString() } : t
        ));
        
        showToast(
          `${ticket.key} scheduled W${startWeek}-W${targetWeek} (${weeksNeeded}w), due ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 
          'info'
        );
      }
      
        debouncedSilentRefresh();
      } catch (err) {
        showToast('Failed to update due date', 'error');
      }
      
      setTimeout(() => setDueDateUpdatingTicket(null), 2000);
      setIsSaving(false);
  }, [overflowDialog, queueTickets, poolTickets, setQueueTickets, setPoolTickets, lockTicketToWeek, saveOrder, updateDueDate, debouncedSilentRefresh, showToast]);

  // Handler for confirming immediate jump (locking to current week)
  const confirmImmediateJump = useCallback(async () => {
    if (!immediateJumpDialog) return;
    
    const { ticket, targetWeek, targetYear, fromPool } = immediateJumpDialog;
    setImmediateJumpDialog(null);
    
    let newQueue = [...queueTickets];
    let newPool = [...poolTickets];
    
    if (fromPool) {
      newPool = poolTickets.filter(t => t.key !== ticket.key);
      const lockedTicket = { ...ticket, locked_week: targetWeek, locked_year: targetYear };
      newQueue = [...queueTickets, lockedTicket];
    } else {
      newQueue = queueTickets.map(t => 
        t.key === ticket.key ? { ...t, locked_week: targetWeek, locked_year: targetYear } : t
      );
    }
    
    setQueueTickets(newQueue);
    setPoolTickets(newPool);
    lockTicketToWeek(ticket.key, targetWeek, targetYear);
    
    setDueDateUpdatingTicket(ticket.key);
    setIsSaving(true);
    
    try {
      const [, dueDateResult] = await Promise.all([
        saveOrder(newQueue, newPool),
        updateDueDate(ticket.key, targetWeek, targetYear, ticket.lines),
      ]);
      
      if (dueDateResult) {
        const friday = getFridayOfWeek(targetWeek, targetYear);
        setQueueTickets(prev => prev.map(t => 
          t.key === ticket.key ? { ...t, due_date: friday.toISOString() } : t
        ));
        
        showToast(`${ticket.key} locked to current week - ready to hand off!`, 'info');
      }
      
      debouncedSilentRefresh();
    } catch (err) {
      showToast('Failed to update due date', 'error');
    }
    
    setTimeout(() => setDueDateUpdatingTicket(null), 2000);
    setIsSaving(false);
  }, [immediateJumpDialog, queueTickets, poolTickets, setQueueTickets, setPoolTickets, lockTicketToWeek, saveOrder, updateDueDate, debouncedSilentRefresh, showToast]);

  // Categorize pool tickets by size
  const poolBySize = useMemo(() => {
    const small: Ticket[] = [];
    const medium: Ticket[] = [];
    const big: Ticket[] = [];
    
    for (const ticket of poolTickets) {
      const size = getTicketSize(ticket.lines);
      if (size === 'small') small.push(ticket);
      else if (size === 'medium') medium.push(ticket);
      else big.push(ticket);
    }
    
    return { small, medium, big };
  }, [poolTickets]);

  // Enrich queue tickets with delivery info, respecting reservation limits
  const enrichedQueue = useMemo(() => {
    // Build a map of weekly usage per size for auto-scheduled tickets
    // We need to consider reservation limits when determining which week a ticket lands in
    const weeklyUsage = new Map<string, { small: number; medium: number; large: number; total: number }>();
    
    // Helper to get or create week usage
    const getWeekUsage = (week: number, year: number) => {
      const key = `${year}-${week}`;
      if (!weeklyUsage.has(key)) {
        // Start with locked tickets for this week
        const lockedUsage = getScheduledBySize(
          queueTickets.filter(t => t.locked_week === week && t.locked_year === year),
          week,
          year
        );
        weeklyUsage.set(key, { ...lockedUsage });
      }
      return weeklyUsage.get(key)!;
    };
    
    // Helper to check if a ticket can be auto-scheduled to a week
    const canAutoScheduleToWeek = (ticket: Ticket, week: number, year: number): boolean => {
      const usage = getWeekUsage(week, year);
      const capacity = getWeekCapacity(week, year);
      const unlocks = getWeekUnlocks(week, year);
      
      const result = canScheduleTicket(ticket, usage, capacity, reservationDefaults, unlocks);
      return result.allowed;
    };
    
    // Helper to add ticket usage to a week
    const addToWeek = (ticket: Ticket, week: number, year: number) => {
      const usage = getWeekUsage(week, year);
      const size = getTicketSize(ticket.lines);
      if (size === 'small') usage.small += ticket.lines;
      else if (size === 'medium') usage.medium += ticket.lines;
      else usage.large += ticket.lines;
      usage.total += ticket.lines;
    };
    
    // Helper to get SIZE-SPECIFIC capacity for a week
    // Small: uses small reservation (or full capacity if unlocked)
    // Medium: uses medium reservation (or full capacity if unlocked)
    // Big/Large: uses remaining after small/medium reservations
    const getSizeCapacity = (week: number, year: number, ticketSize: 'small' | 'medium' | 'big'): number => {
      const totalCapacity = getWeekCapacity(week, year);
      const unlocks = getWeekUnlocks(week, year);
      
      if (ticketSize === 'small') {
        return unlocks.small ? totalCapacity : reservationDefaults.small;
      } else if (ticketSize === 'medium') {
        return unlocks.medium ? totalCapacity : reservationDefaults.medium;
      } else {
        // Big/Large: gets what's left after small/medium reservations
        const smallReserved = unlocks.small ? 0 : reservationDefaults.small;
        const mediumReserved = unlocks.medium ? 0 : reservationDefaults.medium;
        return Math.max(0, totalCapacity - smallReserved - mediumReserved);
      }
    };
    
    // Helper to calculate START week for backward spanning (locked tickets)
    // locked_week is TARGET (due date week), we calculate backwards using SIZE-SPECIFIC capacity
    const getBackwardStartWeek = (targetWeek: number, targetYear: number, lines: number, ticketSize: 'small' | 'medium' | 'big'): { week: number; year: number; weeksNeeded: number } => {
      let remaining = lines;
      let currentWeek = targetWeek;
      let currentYear = targetYear;
      let weeksNeeded = 0;
      const maxIterations = 104; // Safety: max ~2 years
      
      while (remaining > 0 && weeksNeeded < maxIterations) {
        const capacity = getSizeCapacity(currentWeek, currentYear, ticketSize);
        
        // Safety check: if capacity is 0, we can't make progress - use default capacity
        if (capacity <= 0) {
          remaining -= weeklyCapacity || 4000;
        } else {
          remaining -= capacity;
        }
        weeksNeeded++;
        
        // Move to previous week
        currentWeek--;
        if (currentWeek < 1) {
          currentWeek = 52;
          currentYear--;
        }
      }
      
      // currentWeek is now one before start, so adjust
      let startWeek = currentWeek + 1;
      let startYear = currentYear;
      if (startWeek > 52) {
        startWeek = 1;
        startYear++;
      }
      
      return { week: startWeek, year: startYear, weeksNeeded: Math.min(weeksNeeded, 52) };
    };
    
    // Helper to calculate final week for FORWARD spanning (unlocked tickets)
    const getForwardFinalWeek = (startWeek: number, startYear: number, lines: number, ticketSize: 'small' | 'medium' | 'big'): { week: number; year: number; weeksNeeded: number } => {
      let remaining = lines;
      let currentWeek = startWeek;
      let currentYear = startYear;
      let weeksNeeded = 0;
      const maxIterations = 104; // Safety: max ~2 years
      
      while (remaining > 0 && weeksNeeded < maxIterations) {
        const capacity = getSizeCapacity(currentWeek, currentYear, ticketSize);
        
        // Safety check: if capacity is 0, we can't make progress - use default capacity
        if (capacity <= 0) {
          remaining -= weeklyCapacity || 4000;
        } else {
          remaining -= capacity;
        }
        weeksNeeded++;
        
        if (remaining > 0) {
          // Move to next week
          currentWeek++;
          if (currentWeek > 52) {
            currentWeek = 1;
            currentYear++;
          }
        }
      }
      
      return { week: currentWeek, year: currentYear, weeksNeeded: Math.min(weeksNeeded, 52) };
    };
    
    // STEP 1: Calculate effective week for each ticket (locked or auto-scheduled)
    // Also calculate the week label for display
    interface TicketWithWeek extends Ticket {
      effectiveWeek: number;
      effectiveYear: number;
      startWeek: number;
      startYear: number;
      weekLabel: string;
      isLocked: boolean;
      originalIndex: number;
    }
    
    const ticketsWithWeeks: TicketWithWeek[] = queueTickets.map((ticket, index) => {
      const ticketSize = getTicketSize(ticket.lines);
      
      if (ticket.locked_week != null && ticket.locked_year != null) {
        // LOCKED: target week is the due date week
        const { week: startWeek, year: startYear, weeksNeeded } = getBackwardStartWeek(
          ticket.locked_week, 
          ticket.locked_year, 
          ticket.lines,
          ticketSize
        );
        
        const weekLabel = weeksNeeded > 1 
          ? `W${startWeek}-W${ticket.locked_week} 🔒 (${weeksNeeded}w)`
          : `W${ticket.locked_week} 🔒`;
      
      return {
        ...ticket,
          effectiveWeek: ticket.locked_week,
          effectiveYear: ticket.locked_year,
          startWeek,
          startYear,
          weekLabel,
          isLocked: true,
          originalIndex: index,
        };
      } else {
        // AUTO-SCHEDULED: Find first available week (start from next week, not current)
        let weekOffset = 1;
        
        for (let i = 1; i < 53; i++) {
          const weekInfo = getWeekInfo(i);
          if (canAutoScheduleToWeek(ticket, weekInfo.week, weekInfo.year)) {
            weekOffset = i;
            addToWeek(ticket, weekInfo.week, weekInfo.year);
            break;
          }
        }
        
        const startWeekInfo = getWeekInfo(weekOffset);
        const { week: finalWeek, weeksNeeded } = getForwardFinalWeek(
          startWeekInfo.week, 
          startWeekInfo.year, 
          ticket.lines,
          ticketSize
        );
        
        // For auto-scheduled, the effective week is the FINAL week (due date)
        const weekLabel = weeksNeeded > 1 
          ? `W${startWeekInfo.week}-W${finalWeek} (${weeksNeeded}w)`
          : `W${startWeekInfo.week}`;
        
        const effectiveYear = startWeekInfo.year + (finalWeek < startWeekInfo.week ? 1 : 0);
        
        return {
          ...ticket,
          effectiveWeek: finalWeek,
          effectiveYear,
          startWeek: startWeekInfo.week,
          startYear: startWeekInfo.year,
          weekLabel,
          isLocked: false,
          originalIndex: index,
          // Only use backend mismatch flags (for locked tickets)
          has_mismatch: ticket.has_mismatch,
          mismatch_type: ticket.mismatch_type,
        };
      }
    });
    
    // STEP 2: Group by (year, week)
    const weekGroups = new Map<string, TicketWithWeek[]>();
    ticketsWithWeeks.forEach(t => {
      const key = `${t.effectiveYear}-${String(t.effectiveWeek).padStart(2, '0')}`;
      if (!weekGroups.has(key)) weekGroups.set(key, []);
      weekGroups.get(key)!.push(t);
    });
    
    // STEP 3: Sort week keys chronologically from current week
    const sortedWeekKeys = [...weekGroups.keys()].sort((a, b) => {
      // Parse year-week from keys
      const [yearA, weekA] = a.split('-').map(Number);
      const [yearB, weekB] = b.split('-').map(Number);
      
      // Convert to comparable value (year * 100 + week), but handle year boundary
      // If we're in week 52, week 1 of next year should come after week 52
      const valA = yearA * 100 + weekA;
      const valB = yearB * 100 + weekB;
      
      return valA - valB;
    });
    
    // STEP 4: Sort tickets within each group by original priority (originalIndex)
    sortedWeekKeys.forEach(key => {
      const tickets = weekGroups.get(key)!;
      tickets.sort((a, b) => a.originalIndex - b.originalIndex);
    });
    
    // STEP 5: Flatten with single divider per week
    let globalPosition = 0;
    const enriched: Array<Ticket & { queue_position: number; expected_delivery: string; _showWeekLabel?: string }> = [];
    
    sortedWeekKeys.forEach(weekKey => {
      const tickets = weekGroups.get(weekKey)!;
      tickets.forEach((t, idx) => {
        globalPosition++;
        enriched.push({
          ...t,
          queue_position: globalPosition,
          expected_delivery: t.weekLabel,
          // Only show week divider for first ticket in each week group
          _showWeekLabel: idx === 0 ? `W${t.effectiveWeek}` : undefined,
        });
      });
    });
    
    return enriched;
  }, [queueTickets, weeklyCapacity, getWeekCapacity, getWeekUnlocks, reservationDefaults]);

  // Shared per-ticket week placement — consumed by CapacityTimeline so both views
  // use identical week ownership (displayWeek = due/final week for every ticket).
  const queueScheduleByKey = useMemo<Map<string, TicketPlacement>>(() => {
    const map = new Map<string, TicketPlacement>();
    for (const t of enrichedQueue) {
      const tw = t as typeof t & { effectiveWeek: number; effectiveYear: number; startWeek: number; startYear: number; isLocked: boolean };
      map.set(t.key, {
        displayWeek: tw.effectiveWeek,
        displayYear: tw.effectiveYear,
        startWeek: tw.startWeek ?? tw.effectiveWeek,
        startYear: tw.startYear ?? tw.effectiveYear,
        isLocked: tw.isLocked ?? (t.locked_week != null),
      });
    }
    return map;
  }, [enrichedQueue]);

  // Filter function for search
  const matchesSearch = useCallback((ticket: Ticket) => {
    if (!debouncedSearch) return true;
    const query = debouncedSearch.toLowerCase();
    return (
      ticket.key.toLowerCase().includes(query) ||
      ticket.summary.toLowerCase().includes(query)
    );
  }, [debouncedSearch]);

  // Filtered versions of the ticket lists - recalculate week labels after filtering
  const filteredQueue = useMemo(() => {
    let result = enrichedQueue.filter(matchesSearch);
    if (hideJumpedTickets) {
      result = result.filter(t => !t.is_jumped && t.status.toLowerCase() !== 'jumped');
    }
    
    // Recalculate week labels for first visible ticket in each week
    const seenWeeks = new Set<string>();
    return result.map(ticket => {
      const weekKey = `${ticket.effectiveYear}-${ticket.effectiveWeek}`;
      if (!seenWeeks.has(weekKey)) {
        seenWeeks.add(weekKey);
        return { ...ticket, _showWeekLabel: `W${ticket.effectiveWeek}` };
      }
      return { ...ticket, _showWeekLabel: undefined };
    });
  }, [enrichedQueue, matchesSearch, hideJumpedTickets]);

  const filteredPoolBySize = useMemo(() => {
    return {
      small: poolBySize.small.filter(matchesSearch),
      medium: poolBySize.medium.filter(matchesSearch),
      big: poolBySize.big.filter(matchesSearch),
    };
  }, [poolBySize, matchesSearch]);

  // Search result counts
  const searchResultCount = useMemo(() => {
    if (!debouncedSearch) return null;
    const queueCount = filteredQueue.length;
    const poolCount = filteredPoolBySize.small.length + filteredPoolBySize.medium.length + filteredPoolBySize.big.length;
    return { queue: queueCount, pool: poolCount, total: queueCount + poolCount };
  }, [debouncedSearch, filteredQueue, filteredPoolBySize]);

  const totalQueueLines = queueTickets.reduce((s, t) => s + t.lines, 0);
  const estimatedWeeks = Math.ceil(totalQueueLines / weeklyCapacity);

  // Helper: Update due dates for all unlocked queue tickets in background
  // This runs after queue changes to sync Jira due dates with calculated positions
  const updateDueDatesInBackground = useCallback((queue: Ticket[]) => {
    // Fire and forget - don't block UI
    (async () => {
      try {
        // Track weekly usage by size for scheduling calculations
        const weeklyUsage = new Map<string, { small: number; medium: number; large: number; total: number }>();
        
        const getWeekUsage = (week: number, year: number) => {
          const key = `${year}-${week}`;
          if (!weeklyUsage.has(key)) {
            const lockedUsage = getScheduledBySize(
              queue.filter(t => t.locked_week === week && t.locked_year === year),
              week, year
            );
            weeklyUsage.set(key, { ...lockedUsage });
          }
          return weeklyUsage.get(key)!;
        };
        
        const getSizeCap = (week: number, year: number, size: 'small' | 'medium' | 'large'): number => {
          const wUnlocks = getWeekUnlocks(week, year);
          const wTotalCap = getWeekCapacity(week, year);
          if (size === 'small') return wUnlocks.small ? wTotalCap : reservationDefaults.small;
          if (size === 'medium') return wUnlocks.medium ? wTotalCap : reservationDefaults.medium;
          const sr = wUnlocks.small ? 0 : reservationDefaults.small;
          const mr = wUnlocks.medium ? 0 : reservationDefaults.medium;
          return Math.max(0, wTotalCap - sr - mr);
        };
        
        const canSchedule = (t: Ticket, week: number, year: number): boolean => {
          const usage = getWeekUsage(week, year);
          const size = getTicketSize(t.lines);
          const sizeKey = size === 'big' ? 'large' : size;
          const sizeCap = getSizeCap(week, year, sizeKey);
          return usage[sizeKey] + t.lines <= sizeCap;
        };
        
        const addToWeek = (t: Ticket, week: number, year: number) => {
          const usage = getWeekUsage(week, year);
          const size = getTicketSize(t.lines);
          const sizeKey = size === 'big' ? 'large' : size;
          usage[sizeKey] += t.lines;
          usage.total += t.lines;
        };
        
        // Calculate and fire due date updates for each unlocked ticket
        for (const t of queue) {
          if (t.locked_week != null && t.locked_year != null) continue;
          
          // Find first available week (start from next week, not current)
          let weekOffset = 1;
          for (let i = 1; i < 53; i++) {
            const weekInfo = getWeekInfo(i);
            if (canSchedule(t, weekInfo.week, weekInfo.year)) {
              weekOffset = i;
              addToWeek(t, weekInfo.week, weekInfo.year);
              break;
            }
          }
          
          const startWeekInfo = getWeekInfo(weekOffset);
          let remainingLines = t.lines;
          let finalWeek = startWeekInfo.week;
          let finalYear = startWeekInfo.year;
          let tempOffset = weekOffset;
          
          while (remainingLines > 0) {
            const tempWeekInfo = getWeekInfo(tempOffset);
            const tempCap = getWeekCapacity(tempWeekInfo.week, tempWeekInfo.year);
            remainingLines -= tempCap;
            if (remainingLines > 0) {
              tempOffset++;
              finalWeek = getWeekInfo(tempOffset).week;
              finalYear = getWeekInfo(tempOffset).year;
            } else {
              finalWeek = tempWeekInfo.week;
              finalYear = tempWeekInfo.year;
            }
          }
          
          // Fire due date update (don't await - fire and forget)
          updateDueDate(t.key, finalWeek, finalYear, t.lines).catch(() => {});
        }
      } catch (err) {
        console.error('Background due date update failed:', err);
      }
    })();
  }, [getWeekCapacity, getWeekUnlocks, reservationDefaults, updateDueDate]);

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    const fromQueue = queueTickets.find(t => t.key === id);
    const fromPool = poolTickets.find(t => t.key === id);
    const ticket = fromQueue || fromPool || null;
    
    if (ticket) {
      const blockReason = getScheduleBlockReason(ticket);
      if (blockReason) {
        showToast(blockReason, 'error');
        return;
      }
    }
    
    // Show info toast for unapproved tickets being scheduled
    if (ticket && !ticket.is_approved) {
      showToast('Scheduling unapproved ticket - will show as orange until approved', 'info');
    }
    
    setActiveTicket(ticket);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTicket(null);
    
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const fromQueue = queueTickets.find(t => t.key === activeId);
    const fromPool = poolTickets.find(t => t.key === activeId);
    const ticket = fromQueue || fromPool;
    if (!ticket) return;

    if (!isSchedulable(ticket)) {
      return;
    }

    // Check if dropped on a week in the timeline
    if (overId.startsWith('week-drop-')) {
      const parts = overId.split('-');
      const targetYear = parseInt(parts[2]);
      const targetWeek = parseInt(parts[3]);
      
      // Check if dropping to current week
      const { week: nowWeek, year: nowYear } = getCurrentWeekAndYear();
      const isCurrentWeekDrop = targetWeek === nowWeek && targetYear === nowYear;
      
      if (isCurrentWeekDrop) {
        // Current week is special - only approved tickets can be locked to it
        if (!ticket.is_approved) {
          showToast('Only approved tickets can be scheduled for the current week', 'error');
          return;
        }
        // Show confirmation dialog for immediate jump
        setImmediateJumpDialog({ ticket, targetWeek, targetYear, fromPool: !!fromPool });
        return;
      }
      
      // Get SIZE-SPECIFIC capacity for this ticket type
      const ticketSize = getTicketSize(ticket.lines);
      
      // Helper to calculate size capacity for a week
      const getSizeCapacityForWeek = (w: number, y: number, size: 'small' | 'medium' | 'big'): number => {
        const wUnlocks = getWeekUnlocks(w, y);
        const wTotalCap = getWeekCapacity(w, y);
        if (size === 'small') return wUnlocks.small ? wTotalCap : reservationDefaults.small;
        if (size === 'medium') return wUnlocks.medium ? wTotalCap : reservationDefaults.medium;
        const sr = wUnlocks.small ? 0 : reservationDefaults.small;
        const mr = wUnlocks.medium ? 0 : reservationDefaults.medium;
        return Math.max(0, wTotalCap - sr - mr);
      };
      
      // Helper to calculate ALREADY USED size capacity in a week (including multi-week spanning)
      const getUsedCapacityForWeek = (w: number, y: number, size: 'small' | 'medium' | 'big'): number => {
        let used = 0;
        // For each ticket in queue (excluding the one being dragged)
        for (const t of queueTickets) {
          if (t.key === activeId) continue;
          if (t.locked_week == null || t.locked_year == null) continue;
          
          const tSize = getTicketSize(t.lines);
          if (tSize !== size) continue;
          
          // Calculate how much of this ticket's lines fall in week w/y
          // The ticket fills backward from its locked_week
          let remainingLines = t.lines;
          let currentW = t.locked_week;
          let currentY = t.locked_year;
          let iterations = 0;
          const maxIterations = 104; // Safety: max ~2 years
          
          while (remainingLines > 0 && iterations < maxIterations) {
            const weekCap = getSizeCapacityForWeek(currentW, currentY, tSize);
            // Prevent infinite loop: if capacity is 0, use fallback
            const effectiveCap = weekCap > 0 ? weekCap : (weeklyCapacity || 4000);
            const linesInThisWeek = Math.min(remainingLines, effectiveCap);
            
            if (currentW === w && currentY === y) {
              used += linesInThisWeek;
            }
            
            remainingLines -= linesInThisWeek;
            currentW--;
            if (currentW < 1) {
              currentW = 52;
              currentY--;
            }
            iterations++;
          }
        }
        return used;
      };
      
      // Calculate AVAILABLE size capacity going backward from target week
      let remaining = ticket.lines;
      let currentWeek = targetWeek;
      let currentYear = targetYear;
      let weeksNeeded = 0;
      const maxWeeksBack = 104; // Safety: max ~2 years
      
      while (remaining > 0 && weeksNeeded < maxWeeksBack) {
        const weekSizeCap = getSizeCapacityForWeek(currentWeek, currentYear, ticketSize);
        const usedInWeek = getUsedCapacityForWeek(currentWeek, currentYear, ticketSize);
        // Use fallback capacity if size capacity is 0 to prevent infinite loop
        const effectiveCap = weekSizeCap > 0 ? weekSizeCap : (weeklyCapacity || 4000);
        const availableInWeek = Math.max(0, effectiveCap - usedInWeek);
        
        if (availableInWeek > 0) {
          remaining -= availableInWeek;
        } else {
          // Even if no capacity, consume some to make progress
          remaining -= Math.min(remaining, weeklyCapacity || 4000);
        }
        weeksNeeded++;
        
        currentWeek--;
        if (currentWeek < 1) {
          currentWeek = 52;
          currentYear--;
        }
      }
      
      // Calculate start week (currentWeek is one before start, adjust)
      let startWeek = currentWeek + 1;
      let startYear = currentYear;
      if (startWeek > 52) {
        startWeek = 1;
        startYear++;
      }
      
      // If more than 1 week needed, show overflow dialog
      if (weeksNeeded > 1) {
        setOverflowDialog({
          ticket,
          targetWeek,
          targetYear,
          weeksNeeded,
          startWeek,
          startYear,
          fromPool: !!fromPool,
        });
        return;
      }
      
      // Single week fits - but double check with canScheduleTicket for consistency
      const totalCapacity = getWeekCapacity(targetWeek, targetYear);
      const unlocks = getWeekUnlocks(targetWeek, targetYear);
      
      // Calculate actual used capacity including spanning tickets
      const usedSmall = getUsedCapacityForWeek(targetWeek, targetYear, 'small');
      const usedMedium = getUsedCapacityForWeek(targetWeek, targetYear, 'medium');
      const usedLarge = getUsedCapacityForWeek(targetWeek, targetYear, 'big');
      
      const actualScheduledBySize = {
        small: usedSmall,
        medium: usedMedium,
        large: usedLarge,
        total: usedSmall + usedMedium + usedLarge,
      };
      
      const scheduleCheck = canScheduleTicket(
        ticket,
        actualScheduledBySize,
        totalCapacity,
        reservationDefaults,
        unlocks
      );
      
      if (!scheduleCheck.allowed) {
        showToast(scheduleCheck.reason || 'Cannot schedule to this week', 'error');
        return;
      }
      
      let newQueue = [...queueTickets];
      let newPool = [...poolTickets];
      
      if (fromPool) {
        newPool = poolTickets.filter(t => t.key !== activeId);
        const lockedTicket = { ...ticket, locked_week: targetWeek, locked_year: targetYear };
        newQueue = [...queueTickets, lockedTicket];
      } else {
        newQueue = queueTickets.map(t => 
          t.key === activeId ? { ...t, locked_week: targetWeek, locked_year: targetYear } : t
        );
      }
      
      setQueueTickets(newQueue);
      setPoolTickets(newPool);
      lockTicketToWeek(activeId, targetWeek, targetYear);
      
      // Increment version to invalidate any pending background saves
      saveVersionRef.current++;
      
      setDueDateUpdatingTicket(activeId);
      setIsSaving(true);
      
      try {
        // For single week, pass ticket lines (backend handles any spanning)
        const [, dueDateResult] = await Promise.all([
          saveOrder(newQueue, newPool),
          updateDueDate(activeId, targetWeek, targetYear, ticket.lines),
        ]);
        
        if (dueDateResult) {
          const friday = getFridayOfWeek(dueDateResult.final_week, dueDateResult.final_year);
        setQueueTickets(prev => prev.map(t => 
          t.key === activeId ? { ...t, due_date: friday.toISOString() } : t
        ));
        
        showToast(`Due date set to ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'info');
        }
        
        // Refresh data from Jira to ensure UI shows actual state (silent - no loading screen)
        debouncedSilentRefresh();
      } catch (err) {
        showToast('Failed to update due date', 'error');
      }
      
      setTimeout(() => setDueDateUpdatingTicket(null), 2000);
      setIsSaving(false);
      return;
    }

    let newQueue = [...queueTickets];
    let newPool = [...poolTickets];

    const isOverSmallLane = overId === 'pool-small' || poolBySize.small.some(t => t.key === overId);
    const isOverMediumLane = overId === 'pool-medium' || poolBySize.medium.some(t => t.key === overId);
    const isOverBigLane = overId === 'pool-big' || poolBySize.big.some(t => t.key === overId);
    const isOverBacklog = overId === 'backlog';
    const isOverPool = overId === 'pool' || isOverBacklog || isOverSmallLane || isOverMediumLane || isOverBigLane || poolTickets.some(t => t.key === overId);

    const isOverQueue = overId === 'queue' || queueTickets.some(t => t.key === overId);

    if (fromQueue && isOverQueue) {
      const oldIdx = queueTickets.findIndex(t => t.key === activeId);
      const newIdx = overId === 'queue' ? queueTickets.length - 1 : queueTickets.findIndex(t => t.key === overId);
      if (oldIdx !== newIdx && newIdx !== -1) {
        // Save original state for rollback on error
        const originalQueue = [...queueTickets];
        
        // INSTANT: Update UI immediately (optimistic)
        newQueue = arrayMove(queueTickets, oldIdx, newIdx);
        setQueueTickets(newQueue);
        setPoolTickets(newPool);
        showToast('Queue reordered', 'info');
        
        // Increment version and capture it for this operation
        const currentVersion = ++saveVersionRef.current;
        
        // BACKGROUND: Save and update due dates without blocking
        (async () => {
          try {
            await saveOrder(newQueue, newPool);
            // Only update due dates if this is still the latest version
            if (saveVersionRef.current === currentVersion) {
              updateDueDatesInBackground(newQueue);
              debouncedSilentRefresh();
            }
          } catch (err) {
            console.error('Background save failed:', err);
            // Revert to original state on error
            if (saveVersionRef.current === currentVersion) {
              setQueueTickets(originalQueue);
              showToast('Failed to save - changes reverted', 'error');
            }
          }
        })();
        return;
      }
    } else if (fromQueue && isOverPool) {
      // Save original state for rollback on error
      const originalQueue = [...queueTickets];
      const originalPool = [...poolTickets];
      
      // INSTANT: Update UI immediately (optimistic)
      newQueue = queueTickets.filter(t => t.key !== activeId);
      const unlockedTicket = { ...ticket, locked_week: undefined, locked_year: undefined, due_date: null };
      newPool = [...poolTickets, unlockedTicket];
      unlockTicket(activeId);
      
      setQueueTickets(newQueue);
      setPoolTickets(newPool);
      showToast(`${ticket.key} moved to backlog`, 'info');
      
      // Increment version and capture it for this operation
      const currentVersion = ++saveVersionRef.current;
      
      // BACKGROUND: Clear due date, save, and update remaining due dates
      (async () => {
        try {
          await Promise.all([
            unlockTicketApi(activeId),
            saveOrder(newQueue, newPool),
          ]);
          // Only update due dates if this is still the latest version
          if (saveVersionRef.current === currentVersion) {
            updateDueDatesInBackground(newQueue);
            debouncedSilentRefresh();
          }
        } catch (err) {
          console.error('Background save failed:', err);
          // Revert to original state on error
          if (saveVersionRef.current === currentVersion) {
            setQueueTickets(originalQueue);
            setPoolTickets(originalPool);
            showToast('Failed to save - changes reverted', 'error');
          }
        }
      })();
      return;
    } else if (fromPool && isOverQueue) {
      // Save original state for rollback on error
      const originalQueue = [...queueTickets];
      const originalPool = [...poolTickets];
      
      // INSTANT: Update UI immediately (optimistic)
      newPool = poolTickets.filter(t => t.key !== activeId);
      const insertIdx = overId === 'queue' ? queueTickets.length : queueTickets.findIndex(t => t.key === overId);
      newQueue = [...queueTickets];
      // Mark ticket as in_queue when adding to queue
      const ticketWithQueue = { ...ticket, in_queue: true };
      newQueue.splice(insertIdx === -1 ? queueTickets.length : insertIdx, 0, ticketWithQueue);
      
      setQueueTickets(newQueue);
      setPoolTickets(newPool);
      showToast(`${ticket.key} added to queue`, 'info');
      
      // Increment version and capture it for this operation
      const currentVersion = ++saveVersionRef.current;
      
      // BACKGROUND: Save and update due dates without blocking
      (async () => {
        try {
          await saveOrder(newQueue, newPool);
          // Only update due dates if this is still the latest version
          if (saveVersionRef.current === currentVersion) {
            updateDueDatesInBackground(newQueue);
            debouncedSilentRefresh();
          }
        } catch (err) {
          console.error('Background save failed:', err);
          // Revert to original state on error
          if (saveVersionRef.current === currentVersion) {
            setQueueTickets(originalQueue);
            setPoolTickets(originalPool);
            showToast('Failed to save - changes reverted', 'error');
          }
        }
      })();
      return;
    } else if (fromPool && isOverPool) {
      const oldIdx = poolTickets.findIndex(t => t.key === activeId);
      const targetTicket = poolTickets.find(t => t.key === overId);
      if (targetTicket) {
        const newIdx = poolTickets.findIndex(t => t.key === overId);
        if (oldIdx !== newIdx && newIdx !== -1) {
          newPool = arrayMove(poolTickets, oldIdx, newIdx);
        }
      }
    }

    setQueueTickets(newQueue);
    setPoolTickets(newPool);

    // Increment version to invalidate any pending background saves
    saveVersionRef.current++;
    
    setIsSaving(true);
    await saveOrder(newQueue, newPool);
    setIsSaving(false);
  };

  const handleMoveToPosition = async (position: number) => {
    if (!moveTicket) return;
    
    const blockReason = getScheduleBlockReason(moveTicket);
    if (blockReason) {
      showToast(blockReason, 'error');
      setMoveTicket(null);
      return;
    }
    
    let newQueue = [...queueTickets];
    let newPool = [...poolTickets];
    
    const inQueue = queueTickets.find(t => t.key === moveTicket.key);
    const inPool = poolTickets.find(t => t.key === moveTicket.key);
    
    if (inQueue) {
      newQueue = queueTickets.filter(t => t.key !== moveTicket.key);
    } else if (inPool) {
      newPool = poolTickets.filter(t => t.key !== moveTicket.key);
    }
    
    const idx = Math.max(0, Math.min(position - 1, newQueue.length));
    newQueue.splice(idx, 0, moveTicket);
    
    setQueueTickets(newQueue);
    setPoolTickets(newPool);
    setMoveTicket(null);
    
    setIsSaving(true);
    await saveOrder(newQueue, newPool);
    setIsSaving(false);
  };

  // Approve a ticket (EC Panel) - transitions to 'Approved' status in Jira
  const handleApproveTicket = async (ticketKey: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/tickets/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket_key: ticketKey }),
      });
      
      if (response.ok) {
        console.log(`[EC] Approved ${ticketKey}`);
        
        // Update the ticket in queue to mark as approved
        setQueueTickets(prev => prev.map(t =>
          t.key === ticketKey
            ? { ...t, is_approved: true, status: 'Approved' }
            : t
        ));
        
        showToast(`${ticketKey} approved!`, 'info');
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[EC] Failed to approve ${ticketKey}:`, errorData);
        showToast(`Failed to approve ${ticketKey}: ${errorData.detail || 'Unknown error'}`, 'error');
        return false;
      }
    } catch (err) {
      console.error(`[EC] Error approving ${ticketKey}:`, err);
      showToast(`Error approving ${ticketKey}`, 'error');
      return false;
    }
  };

  const handleUnlock = async (ticketKey: string) => {
    setIsSaving(true);
    const success = await unlockTicketApi(ticketKey);
    
    if (success) {
      // After unlocking, recalculate and update due dates for all unlocked queue tickets
      // The unlocked ticket now needs a due date based on its queue position
      const currentQueue = queueTickets.map(t => 
      t.key === ticketKey ? { ...t, locked_week: undefined, locked_year: undefined } : t
    );
      
      const ticketsToUpdate: Array<{ key: string; week: number; year: number; lines: number }> = [];
      let currentWeekOffset = 1; // Start from next week, not current
      let weekCapacityUsed = 0;
      
      for (const t of currentQueue) {
        if (t.locked_week != null && t.locked_year != null) continue;
        
        let weekInfo = getWeekInfo(currentWeekOffset);
        let weekCap = getWeekCapacity(weekInfo.week, weekInfo.year);
        
        while (weekCapacityUsed + t.lines > weekCap && currentWeekOffset < 53) {
          currentWeekOffset++;
          weekCapacityUsed = 0;
          weekInfo = getWeekInfo(currentWeekOffset);
          weekCap = getWeekCapacity(weekInfo.week, weekInfo.year);
        }
        
        // Calculate final week for multi-week tickets
        let remainingLines = t.lines;
        let finalWeek = weekInfo.week;
        let finalYear = weekInfo.year;
        let tempOffset = currentWeekOffset;
        
        while (remainingLines > 0) {
          const tempWeekInfo = getWeekInfo(tempOffset);
          const tempCap = getWeekCapacity(tempWeekInfo.week, tempWeekInfo.year);
          remainingLines -= tempCap;
          if (remainingLines > 0) {
            tempOffset++;
            finalWeek = getWeekInfo(tempOffset).week;
            finalYear = getWeekInfo(tempOffset).year;
          } else {
            finalWeek = tempWeekInfo.week;
            finalYear = tempWeekInfo.year;
          }
        }
        
        ticketsToUpdate.push({ key: t.key, week: finalWeek, year: finalYear, lines: t.lines });
        weekCapacityUsed += t.lines;
      }
      
      // Update due dates in Jira for all unlocked tickets
      for (const t of ticketsToUpdate) {
        updateDueDate(t.key, t.week, t.year, t.lines).catch(() => {});
      }
      
      showToast(`${ticketKey} unlocked, updating due dates...`, 'info');
      debouncedSilentRefresh();
    } else {
      showToast(`Failed to unlock ${ticketKey}`, 'error');
    }
    setIsSaving(false);
  };

  const handleLockedDrag = useCallback(() => {
    showToast('Unlock the ticket first to move it', 'warning');
  }, [showToast]);

  const handleJumpedDrag = useCallback(() => {
    showToast('This ticket has already been handed off and cannot be modified', 'warning');
  }, [showToast]);

  const handleNotSchedulableDrag = useCallback(() => {
    showToast('Check the blocking reason below the ticket', 'warning');
  }, [showToast]);

  if (loading) {
    return <LoadingScreen message="Loading tickets" />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white rounded-lg shadow-sm border p-6 max-w-sm text-center">
          <p className="text-red-600 mb-3 text-sm">{error}</p>
          <button onClick={() => refresh()} className="px-4 py-2 bg-gray-900 text-white rounded text-sm hover:bg-gray-800">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Cursor overlay for other users */}
      <CursorOverlay cursors={cursors} users={presenceUsers} />

      {/* Session warning dialog - only show if user is INACTIVE */}
      {auth.shouldShowWarning && auth.session && (
        <SessionWarning
          expiresInSeconds={auth.session.expires_in_seconds}
          onExtend={async () => {
            const result = await auth.extendSession();
            auth.resetActivity(); // Reset activity tracker after extending
            return result;
          }}
          onExpired={auth.logout}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-[#222]" viewBox="0 0 200 200" fill="none">
              <g stroke="currentColor" fill="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
                <g transform="translate(0, -10)">
                  <circle cx="100" cy="100" r="50" fill="none"/>
                  <path d="M100 50 L100 62 M100 150 L100 138 M150 100 L138 100 M50 100 L62 100" strokeWidth="5"/>
                  <path d="M100 70 L115 100 L85 100 Z" stroke="none"/>
                  <path d="M85 100 L100 130 L115 100" fill="none" strokeWidth="4"/>
                </g>
              </g>
            </svg>
            <h1 className="font-bold text-[#222]">NoMAD</h1>
          </div>
          <span className="text-xs text-gray-500">
            {queueTickets.length} queued · {totalQueueLines.toLocaleString()} lines · ~{estimatedWeeks}w
          </span>
          {isSaving && <span className="text-xs text-gray-400">Saving...</span>}
          {/* Connection status indicator */}
          <span className="flex items-center gap-1 text-[10px] text-gray-400" title={presenceConnected ? 'Real-time sync active' : 'Reconnecting...'}>
            <span className={`w-1.5 h-1.5 rounded-full ${presenceConnected ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}`} />
            {presenceConnected ? 'Live' : 'Sync...'}
          </span>
        </div>
        
        {/* Search Bar */}
        <div className="flex-1 max-w-md mx-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by key or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchResultCount && (
            <div className="absolute mt-1 text-[10px] text-gray-500">
              Found {searchResultCount.total} ticket{searchResultCount.total !== 1 ? 's' : ''} 
              ({searchResultCount.queue} in queue, {searchResultCount.pool} in backlog)
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Eszter's Space - EC Panel button - only for admins */}
          {auth.user?.is_admin && (
            <button
              onClick={() => setShowECPanel(true)}
              className="relative group"
              title="Eszter's Space - Ticket Approval"
            >
              {/* Stylized pixel art avatar in circle with gradient ring */}
              <div className="w-10 h-10 rounded-full p-0.5 bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500 shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-200">
                <div className="w-full h-full rounded-full overflow-hidden bg-white">
                  <img 
                    src="/eszter-avatar.png" 
                    alt="Eszter's Space"
                    className="w-full h-full object-cover"
                    style={{ imageRendering: 'pixelated' }}
                    onError={(e) => {
                      // Fallback to initials if image not found
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.parentElement!.innerHTML = '<div class="w-full h-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">ES</div>';
                    }}
                  />
                </div>
              </div>
              {/* Pending count badge */}
              {(() => {
                const pendingCount = queueTickets.filter(t => 
                  t.in_queue && t.has_total_count && !t.is_approved && !t.is_jumped && t.status.toLowerCase() !== 'jumped'
                ).length;
                return pendingCount > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[10px] font-bold min-w-[16px] text-center shadow-md border-2 border-white">
                    {pendingCount}
                  </span>
                ) : null;
              })()}
            </button>
          )}

          {/* Admin Portal button - only for admins - icon only */}
          {auth.user?.is_admin && (
            <button
              onClick={() => setShowAdminPortal(true)}
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200"
              title="Admin Portal"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
          )}

          {/* Settings button - icon only */}
          <button
            onClick={() => setShowSettings(true)}
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {unlockedWeeksCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1 py-0.5 bg-amber-500 text-white rounded-full text-[8px] font-bold min-w-[14px] text-center">
                {unlockedWeeksCount}
              </span>
            )}
          </button>
          
          {/* Refresh button - icon only */}
          <button
            onClick={() => refresh()}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            title="Refresh tickets"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* User presence */}
          {auth.user && (
            <UserPresence
              currentUser={auth.user}
              otherUsers={presenceUsers}
              onLogout={auth.logout}
            />
          )}
        </div>
      </header>

      {/* Quick Reference Legend */}
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
        <div className="flex items-center justify-center gap-16 max-w-[1800px] mx-auto">
          {/* Size Categories */}
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Size</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-500"></span>
                <span className="text-xs text-slate-600">S <span className="text-slate-400">&lt;500</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-500"></span>
                <span className="text-xs text-slate-600">M <span className="text-slate-400">500-1.5k</span></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-500"></span>
                <span className="text-xs text-slate-600">L <span className="text-slate-400">&gt;1.5k</span></span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Actions</span>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span><kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px]">Drag</kbd> to reorder</span>
              <span><kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px]">#</kbd> type position</span>
              <span>Drop on <span className="text-blue-600">week</span> to lock</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main with DnD context */}
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Capacity Timeline */}
        <CapacityTimeline 
          queueTickets={queueTickets}
          queueSchedule={queueScheduleByKey}
          weeklyCapacity={weeklyCapacity}
          weekCapacities={weekCapacities}
          reservationDefaults={reservationDefaults}
          getWeekUnlocks={getWeekUnlocks}
          onWeekClick={setSelectedWeek}
          onWeekCapacityChange={setWeekCapacity}
          onUnlockSize={(week, year, size, unlock) => {
            setWeekUnlock(week, year, size, unlock);
          }}
          onResetTicketsToBacklog={async (ticketKeys) => {
            // Clear Jira due dates for all moved tickets
            for (const key of ticketKeys) {
              await unlockTicketApi(key);
            }
            
            // Update local state
            const keysSet = new Set(ticketKeys);
            const newQueue = queueTickets.filter(t => !keysSet.has(t.key));
            const movedToPool = queueTickets
              .filter(t => keysSet.has(t.key))
              .map(t => ({ ...t, locked_week: undefined, locked_year: undefined, in_queue: false }));
            const newPool = [...poolTickets, ...movedToPool];
            setQueueTickets(newQueue);
            setPoolTickets(newPool);
            await saveOrder(newQueue, newPool);
            
            // Recalculate due dates for remaining unlocked queue items
            const ticketsToUpdate: Array<{ key: string; week: number; year: number; lines: number }> = [];
            let currentWeekOffset = 1; // Start from next week, not current
            let weekCapacityUsed = 0;
            
            for (const t of newQueue) {
              if (t.locked_week != null && t.locked_year != null) continue;
              
              let weekInfo = getWeekInfo(currentWeekOffset);
              let weekCap = getWeekCapacity(weekInfo.week, weekInfo.year);
              
              while (weekCapacityUsed + t.lines > weekCap && currentWeekOffset < 53) {
                currentWeekOffset++;
                weekCapacityUsed = 0;
                weekInfo = getWeekInfo(currentWeekOffset);
                weekCap = getWeekCapacity(weekInfo.week, weekInfo.year);
              }
              
              let remainingLines = t.lines;
              let finalWeek = weekInfo.week;
              let finalYear = weekInfo.year;
              let tempOffset = currentWeekOffset;
              
              while (remainingLines > 0) {
                const tempWeekInfo = getWeekInfo(tempOffset);
                const tempCap = getWeekCapacity(tempWeekInfo.week, tempWeekInfo.year);
                remainingLines -= tempCap;
                if (remainingLines > 0) {
                  tempOffset++;
                  finalWeek = getWeekInfo(tempOffset).week;
                  finalYear = getWeekInfo(tempOffset).year;
                } else {
                  finalWeek = tempWeekInfo.week;
                  finalYear = tempWeekInfo.year;
                }
              }
              
              ticketsToUpdate.push({ key: t.key, week: finalWeek, year: finalYear, lines: t.lines });
              weekCapacityUsed += t.lines;
            }
            
            // Update due dates for remaining queue items
            for (const t of ticketsToUpdate) {
              updateDueDate(t.key, t.week, t.year, t.lines).catch(() => {});
            }
            
            showToast(`Moved ${ticketKeys.length} ticket(s) to backlog, due dates updating...`, 'info');
            debouncedSilentRefresh();
          }}
          isAdmin={auth.user?.is_admin ?? false}
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Queue Panel */}
          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-gray-700">Automatic ticket queue</h2>
                {/* Hide jumped tickets toggle */}
                <button
                  onClick={() => setHideJumpedTickets(!hideJumpedTickets)}
                  className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
                    hideJumpedTickets 
                      ? 'bg-slate-600 text-white' 
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                  title={hideJumpedTickets ? 'Show handed-off tickets' : 'Hide handed-off tickets'}
                >
                  {hideJumpedTickets ? 'Show Handed Off' : 'Hide Handed Off'}
                </button>
              </div>
              <span className="text-[10px] text-gray-400">Drag to reorder · Drop on week to lock</span>
            </div>
            
            <SortableContext items={enrichedQueue.map(t => t.key)} strategy={verticalListSortingStrategy}>
              <DroppableQueue>
                {filteredQueue.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-16 border border-dashed border-gray-300 rounded-lg bg-white">
                    <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <p className="text-gray-500">{debouncedSearch ? 'No matching tickets in queue' : "Drop tickets here — they'll be scheduled automatically"}</p>
                    <p className="text-xs mt-1 text-gray-400">{debouncedSearch ? 'Try a different search' : 'Capacity is assigned week-by-week as the queue fills'}</p>
                  </div>
                ) : (
                  filteredQueue.map((ticket, idx) => (
                    <div 
                      key={ticket.key}
                      ref={(el) => { if (el) ticketRefs.current.set(ticket.key, el); }}
                      className={highlightedTicket === ticket.key ? 'highlight-ticket' : ''}
                    >
                      <QueueItem
                      ticket={ticket}
                      position={idx + 1}
                      totalItems={enrichedQueue.length}
                      maxLines={weeklyCapacity}
                      onMoveClick={() => setMoveTicket(ticket)}
                      onDetailClick={() => setSelectedTicket(ticket)}
                      onUnlock={() => handleUnlock(ticket.key)}
                      onLockedDrag={handleLockedDrag}
                        onJumpedDragAttempt={handleJumpedDrag}
                        onResetMismatch={async () => {
                          setDueDateUpdatingTicket(ticket.key);
                          const success = await resetMismatch(ticket.key);
                          setDueDateUpdatingTicket(null);
                          if (success) {
                            showToast(`${ticket.key} reset and moved to backlog`, 'info');
                          } else {
                            showToast(`Failed to reset ${ticket.key}`, 'error');
                          }
                        }}
                        onCopyShareLink={copyShareLink}
                        onPositionChange={(newPos) => {
                          // Reorder queue: move ticket from current position to newPos
                          const currentIdx = idx;
                          const targetIdx = newPos - 1;
                          if (currentIdx === targetIdx) return;
                          
                          // Save original state for rollback on error
                          const originalQueue = [...queueTickets];
                          
                          const newQueue = [...queueTickets];
                          const [moved] = newQueue.splice(currentIdx, 1);
                          newQueue.splice(targetIdx, 0, moved);
                          setQueueTickets(newQueue);
                          
                          // Increment version and capture it for this operation
                          const currentVersion = ++saveVersionRef.current;
                          
                          // Save and update due dates in background
                          (async () => {
                            try {
                              await saveOrder(newQueue, poolTickets);
                              // Only run follow-up actions if this is still the latest version
                              if (saveVersionRef.current === currentVersion) {
                                updateDueDatesInBackground(newQueue);
                                debouncedSilentRefresh();
                              }
                            } catch (err) {
                              console.error('Background save failed:', err);
                              // Revert to original state on error
                              if (saveVersionRef.current === currentVersion) {
                                setQueueTickets(originalQueue);
                                showToast('Failed to save - changes reverted', 'error');
                              }
                            }
                          })();
                        }}
                        onMoveToBacklog={() => {
                          // Save original state for rollback on error
                          const originalQueue = [...queueTickets];
                          const originalPool = [...poolTickets];
                          
                          // INSTANT: Update UI immediately (optimistic)
                          const newQueue = queueTickets.filter(t => t.key !== ticket.key);
                          const movedTicket = { ...ticket, locked_week: undefined, locked_year: undefined, in_queue: false };
                          const newPool = [...poolTickets, movedTicket];
                          setQueueTickets(newQueue);
                          setPoolTickets(newPool);
                          showToast(`${ticket.key} moved to backlog`, 'info');
                          
                          // Increment version and capture it for this operation
                          const currentVersion = ++saveVersionRef.current;
                          
                          // BACKGROUND: Clear due date, save, and update remaining due dates
                          (async () => {
                            try {
                              await Promise.all([
                                unlockTicketApi(ticket.key),
                                saveOrder(newQueue, newPool),
                              ]);
                              // Only run follow-up actions if this is still the latest version
                              if (saveVersionRef.current === currentVersion) {
                                updateDueDatesInBackground(newQueue);
                                debouncedSilentRefresh();
                              }
                            } catch (err) {
                              console.error('Background save failed:', err);
                              // Revert to original state on error
                              if (saveVersionRef.current === currentVersion) {
                                setQueueTickets(originalQueue);
                                setPoolTickets(originalPool);
                                showToast('Failed to save - changes reverted', 'error');
                              }
                            }
                          })();
                        }}
                      showWeekLabel={ticket._showWeekLabel}
                      dueDateUpdating={dueDateUpdatingTicket === ticket.key}
                    />
                    </div>
                  ))
                )}
              </DroppableQueue>
            </SortableContext>
          </div>

          {/* Pool Panel with Lanes - entire panel is a drop zone */}
          <div className="w-64 bg-white border-l border-gray-200 p-3 flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h2 className="text-sm font-medium text-gray-700">Backlog</h2>
              <span className="text-[10px] text-gray-400">{poolTickets.length} tickets</span>
            </div>
            
            <DroppableBacklog>
            {/* Small Tickets Lane */}
            <SortableContext items={poolBySize.small.map(t => t.key)} strategy={verticalListSortingStrategy}>
                <DroppableLane id="pool-small" title="Small" subtitle="< 500" count={filteredPoolBySize.small.length}>
                  {filteredPoolBySize.small.length === 0 ? (
                    <p className="text-[10px] text-gray-300 text-center py-3">{debouncedSearch ? 'No matches' : 'No tickets'}</p>
                  ) : (
                    filteredPoolBySize.small.map((ticket) => (
                      <div 
                      key={ticket.key}
                        ref={(el) => { if (el) ticketRefs.current.set(ticket.key, el); }}
                        className={highlightedTicket === ticket.key ? 'highlight-ticket' : ''}
                      >
                        <PoolItem
                      ticket={ticket}
                      maxLines={weeklyCapacity}
                      onDetailClick={() => setSelectedTicket(ticket)}
                      onNotSchedulableDrag={handleNotSchedulableDrag}
                          onCopyShareLink={copyShareLink}
                    />
                      </div>
                  ))
                )}
              </DroppableLane>
            </SortableContext>

            {/* Medium Tickets Lane */}
            <SortableContext items={poolBySize.medium.map(t => t.key)} strategy={verticalListSortingStrategy}>
                <DroppableLane id="pool-medium" title="Medium" subtitle="500–1.5k" count={filteredPoolBySize.medium.length}>
                  {filteredPoolBySize.medium.length === 0 ? (
                    <p className="text-[10px] text-gray-300 text-center py-3">{debouncedSearch ? 'No matches' : 'No tickets'}</p>
                  ) : (
                    filteredPoolBySize.medium.map((ticket) => (
                      <div 
                      key={ticket.key}
                        ref={(el) => { if (el) ticketRefs.current.set(ticket.key, el); }}
                        className={highlightedTicket === ticket.key ? 'highlight-ticket' : ''}
                      >
                        <PoolItem
                      ticket={ticket}
                      maxLines={weeklyCapacity}
                      onDetailClick={() => setSelectedTicket(ticket)}
                      onNotSchedulableDrag={handleNotSchedulableDrag}
                          onCopyShareLink={copyShareLink}
                    />
                      </div>
                  ))
                )}
              </DroppableLane>
            </SortableContext>

            {/* Large Tickets Lane */}
            <SortableContext items={poolBySize.big.map(t => t.key)} strategy={verticalListSortingStrategy}>
                <DroppableLane id="pool-big" title="Large" subtitle="> 1.5k" count={filteredPoolBySize.big.length}>
                  {filteredPoolBySize.big.length === 0 ? (
                    <p className="text-[10px] text-gray-300 text-center py-3">{debouncedSearch ? 'No matches' : 'No tickets'}</p>
                  ) : (
                    filteredPoolBySize.big.map((ticket) => (
                      <div 
                      key={ticket.key}
                        ref={(el) => { if (el) ticketRefs.current.set(ticket.key, el); }}
                        className={highlightedTicket === ticket.key ? 'highlight-ticket' : ''}
                      >
                        <PoolItem
                      ticket={ticket}
                      maxLines={weeklyCapacity}
                      onDetailClick={() => setSelectedTicket(ticket)}
                      onNotSchedulableDrag={handleNotSchedulableDrag}
                          onCopyShareLink={copyShareLink}
                    />
                      </div>
                  ))
                )}
              </DroppableLane>
            </SortableContext>
            </DroppableBacklog>
          </div>
        </div>

        <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
          {activeTicket && (
            <div className="bg-white border border-gray-300 rounded px-3 py-2 shadow-lg text-sm pointer-events-none">
              <span className="font-medium text-gray-700">{activeTicket.key}</span>
              <span className="ml-2 text-gray-400">{activeTicket.lines.toLocaleString()} lines</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      {selectedTicket && (
        <TicketDetail ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      )}
      
      {moveTicket && (
        <MoveDialog
          ticket={moveTicket}
          maxPosition={queueTickets.length}
          onMove={handleMoveToPosition}
          onClose={() => setMoveTicket(null)}
        />
      )}
      
      {selectedWeek && (
        <WeekDetail
          week={selectedWeek.week}
          year={selectedWeek.year}
          dateRange={selectedWeek.dateRange}
          tickets={selectedWeek.tickets}
          totalLines={selectedWeek.lines}
          capacity={selectedWeek.capacity}
          reservationDefaults={reservationDefaults}
          weekUnlocks={getWeekUnlocks(selectedWeek.week, selectedWeek.year)}
          onClose={() => setSelectedWeek(null)}
          onTicketClick={(ticket) => {
            setSelectedWeek(null);
            setSelectedTicket(ticket);
          }}
          onUnlockTicket={(ticketKey) => {
            handleUnlock(ticketKey);
            // Refresh selected week data after unlock
            setSelectedWeek(prev => prev ? {
              ...prev,
              tickets: prev.tickets.map(t => 
                t.key === ticketKey ? { ...t, locked_week: undefined, locked_year: undefined } : t
              ),
            } : null);
          }}
          smallOverspill={selectedWeek.smallOverspill}
          mediumOverspill={selectedWeek.mediumOverspill}
          largeOverspill={selectedWeek.largeOverspill}
          allQueueTickets={queueTickets}
        />
      )}
      
      {showSettings && (
        <Settings
          weeklyCapacity={weeklyCapacity}
          onCapacityChange={setWeeklyCapacity}
          reservationDefaults={reservationDefaults}
          onReservationDefaultsChange={setReservationDefaults}
          weekReservations={weekReservations}
          onWeekUnlockChange={setWeekUnlock}
          onClose={() => setShowSettings(false)}
          isAdmin={auth.user?.is_admin ?? false}
        />
      )}

      {/* Admin Portal */}
      {showAdminPortal && (
        <AdminPortal onClose={() => setShowAdminPortal(false)} />
      )}

      {/* EC Panel (Eszter Control) - Ticket Approval */}
      {showECPanel && (
        <ECPanel
          onClose={() => setShowECPanel(false)}
          tickets={queueTickets}
          onApprove={handleApproveTicket}
          onRefresh={refresh}
        />
      )}

      {/* Expired Tickets Alert Dialog */}
      <ExpiredTicketsDialog
        tickets={expiredTickets}
        onDismiss={dismissExpiredAlert}
      />

      {/* Capacity Overflow Confirmation Dialog */}
      {overflowDialog && (
        <CapacityOverflowDialog
          ticketKey={overflowDialog.ticket.key}
          ticketLines={overflowDialog.ticket.lines}
          targetWeek={overflowDialog.targetWeek}
          weeksNeeded={overflowDialog.weeksNeeded}
          startWeek={overflowDialog.startWeek}
          onConfirm={confirmOverflowSchedule}
          onCancel={() => setOverflowDialog(null)}
        />
      )}

      {/* Immediate Jump Confirmation Dialog (locking to current week) */}
      {immediateJumpDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Schedule for Current Week?</h3>
                <p className="text-sm text-gray-500">This ticket will be handed off immediately</p>
              </div>
            </div>
            
            <p className="text-sm text-gray-600 mb-6">
              <strong>{immediateJumpDialog.ticket.key}</strong> will be locked to <strong>W{immediateJumpDialog.targetWeek}</strong> (current week). 
              Since this is the current week, the ticket will be ready to hand off immediately.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setImmediateJumpDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmImmediateJump}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
              >
                Yes, Schedule for Current Week
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Footer with version */}
      <footer className="bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between text-[10px] text-gray-400">
        <span>Prewave · {new Date().getFullYear()}</span>
        <span>{APP_VERSION}</span>
      </footer>
    </div>
  );
}

function getFridayOfWeek(week: number, year: number): Date {
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

export default App;
