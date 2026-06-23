import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Ticket, ReservationDefaults, WeekUnlocks } from '../types/ticket';
import { getTicketSize } from '../types/ticket';

// Overspill info - when capacity is used by tickets locked to a different week
interface OverspillInfo {
  lines: number;
  ticketKeys: string[];  // Which tickets are causing overspill
  ticketSummaries: string[];  // Summaries for tooltip
}

export interface WeekData {
  week: number;
  year: number;
  label: string;
  dateRange: string;
  lines: number;
  tickets: Ticket[];
  percent: number;
  droppableId: string;
  capacity: number;
  // Per-size breakdown
  smallLines: number;
  mediumLines: number;
  largeLines: number;
  // Overspill tracking - lines from tickets locked to OTHER weeks
  smallOverspill: OverspillInfo;
  mediumOverspill: OverspillInfo;
  largeOverspill: OverspillInfo;
}

/** Per-ticket week placement, computed once in App.tsx and shared here. */
export interface TicketPlacement {
  displayWeek: number;   // due/final week — the week that "owns" the ticket
  displayYear: number;
  startWeek: number;     // week work begins
  startYear: number;
  isLocked: boolean;
}

interface CapacityTimelineProps {
  queueTickets: Ticket[];
  queueSchedule: Map<string, TicketPlacement>;
  weeklyCapacity: number;
  weekCapacities: Record<string, number>;
  reservationDefaults: ReservationDefaults;
  getWeekUnlocks: (week: number, year: number) => WeekUnlocks;
  onWeekClick: (week: WeekData) => void;
  onWeekCapacityChange: (week: number, year: number, capacity: number) => void;
  onUnlockSize: (week: number, year: number, size: 'small' | 'medium', unlock: boolean) => void;
  onResetTicketsToBacklog?: (ticketKeys: string[]) => void;
  isAdmin: boolean;
}

function getWeekData(weekOffset: number, defaultCapacity: number, weekCapacities: Record<string, number>): { week: number; year: number; label: string; dateRange: string; droppableId: string; capacity: number } {
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
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = d.getUTCFullYear();
  
  const key = `${year}-${week}`;
  const capacity = weekCapacities[key] ?? defaultCapacity;
  
  // Always show ISO week number for consistency - include year if different from current
  const currentYear = new Date().getFullYear();
  const label = year !== currentYear ? `W${week}/${year.toString().slice(-2)}` : `W${week}`;
  
  return {
    week,
    year,
    label,
    dateRange: `${fmt(weekStart)} - ${fmt(weekEnd)}`,
    droppableId: `week-drop-${year}-${week}`,
    capacity,
  };
}

function DroppableWeek({ week, children, isOver: isOverProp }: { week: WeekData; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: isOverDroppable } = useDroppable({ 
    id: week.droppableId,
    data: { type: 'week', week: week.week, year: week.year }
  });
  
  const isActive = isOverProp ?? isOverDroppable;
  
  return (
    <div 
      ref={setNodeRef} 
      className={`transition-all duration-200 rounded-lg ${
        isActive 
          ? 'shadow-lg shadow-blue-200 -translate-y-1' 
          : ''
      }`}
    >
      {children}
    </div>
  );
}

// Minimalist progress bar component with overspill support
function SizeBar({ 
  label, 
  used, 
  available, 
  color, 
  unlocked,
  overspill,
}: { 
  label: string; 
  used: number; 
  available: number; 
  color: 'blue' | 'amber' | 'slate';
  unlocked?: boolean;
  overspill?: OverspillInfo;
}) {
  const overspillUsed = overspill?.lines || 0;
  const directUsed = Math.max(0, used - overspillUsed);
  const directPercent = available > 0 ? Math.min(100, (directUsed / available) * 100) : 0;
  const overspillPercent = available > 0 ? Math.min(100, (overspillUsed / available) * 100) : 0;
  const isOver = used > available;
  const hasOverspill = overspillUsed > 0;
  
  const colorClasses = {
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    slate: 'bg-slate-500',
  };
  
  const bgClasses = {
    blue: 'bg-blue-100',
    amber: 'bg-amber-100',
    slate: 'bg-slate-100',
  };
  
  // Striped pattern colors for overspill
  const stripedClasses = {
    blue: 'bg-stripes-blue',
    amber: 'bg-stripes-amber',
    slate: 'bg-stripes-slate',
  };
  
  // Generate tooltip for overspill
  const overspillTooltip = hasOverspill 
    ? `⚡ Overspill (${overspillUsed.toLocaleString()} lines) from: ${overspill!.ticketKeys.join(', ')}`
    : '';

  return (
    <div className="flex items-center gap-1.5 group relative">
      <span className={`w-1.5 h-1.5 rounded-full ${colorClasses[color]}`} />
      <span className="text-[9px] text-gray-500 w-6">{label}</span>
      <div className={`flex-1 h-2 rounded-full ${bgClasses[color]} overflow-hidden flex`}>
        {/* Direct usage (solid) - tickets whose due date IS this week */}
        {directPercent > 0 && (
          <div 
            className={`h-full transition-all ${isOver ? 'bg-red-500' : colorClasses[color]}`}
            style={{ width: `${directPercent}%` }}
          />
        )}
        {/* Overspill usage (striped) - tickets whose due date is a LATER week */}
        {overspillPercent > 0 && (
          <div 
            className={`h-full transition-all ${stripedClasses[color]} cursor-help border-l-2 border-white`}
            style={{ width: `${overspillPercent}%` }}
          />
        )}
      </div>
      {/* Overspill indicator icon */}
      {hasOverspill && (
        <span className="text-[10px] text-orange-500 font-bold animate-pulse" title={overspillTooltip}>
          ↩
        </span>
      )}
      <span className={`text-[9px] tabular-nums text-right ${hasOverspill ? 'w-12' : 'w-16'} ${isOver ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
        {used.toLocaleString()}/{available.toLocaleString()}
      </span>
      {unlocked && (
        <svg className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
        </svg>
      )}
      {/* Tooltip on hover */}
      {hasOverspill && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-[9px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {overspillTooltip}
        </div>
      )}
    </div>
  );
}

interface CapacityWarning {
  type: 'reservation' | 'overflow';
  message: string;
  affectedTickets?: string[];
  needsSmallUnlock?: boolean;
  needsMediumUnlock?: boolean;
}

interface WeekCardProps {
  week: WeekData;
  idx: number;
  reservationDefaults: ReservationDefaults;
  weekUnlocks: WeekUnlocks;
  onWeekClick: (week: WeekData) => void;
  onCapacityChange: (week: number, year: number, capacity: number) => void;
  onUnlockSize: (week: number, year: number, size: 'small' | 'medium', unlock: boolean) => void;
  onResetTicketsToBacklog?: (ticketKeys: string[]) => void;
  isAdmin: boolean;
}

interface PastWeekCardProps {
  week: WeekData;
  reservationDefaults: ReservationDefaults;
  weekUnlocks: WeekUnlocks;
  onWeekClick: (week: WeekData) => void;
}

// View-only card for past weeks
function PastWeekCard({ week, reservationDefaults, weekUnlocks, onWeekClick }: PastWeekCardProps) {
  // Calculate available capacity for each size
  const smallAvailable = weekUnlocks.small ? week.capacity : reservationDefaults.small;
  const mediumAvailable = weekUnlocks.medium ? week.capacity : reservationDefaults.medium;
  const largeAvailable = Math.max(0, week.capacity - 
    (weekUnlocks.small ? 0 : reservationDefaults.small) - 
    (weekUnlocks.medium ? 0 : reservationDefaults.medium)
  );

  const isOverCapacity = week.lines > week.capacity;
  const totalAvailable = week.capacity - week.lines;

  return (
    <div
      onClick={() => onWeekClick(week)}
      className={`
        flex-shrink-0 w-40 rounded-lg border-2 bg-slate-50 p-2.5 cursor-pointer transition-all hover:shadow-md
        border-slate-200
        ${isOverCapacity ? 'border-red-300 bg-red-50/50' : ''}
      `}
      title={`Click to see ${week.tickets.length} tickets (past week - view only)`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-xs font-semibold text-slate-500">
            {week.label}
          </span>
          <span className="text-[10px] text-slate-400 ml-1.5">
            {week.dateRange.split(' - ')[0]}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
          {week.tickets.length}
        </span>
      </div>
      
      {/* Per-size progress bars */}
      <div className="space-y-1 mb-2">
        <SizeBar 
          label="S" 
          used={week.smallLines} 
          available={smallAvailable}
          color="blue"
          unlocked={weekUnlocks.small}
        />
        <SizeBar 
          label="M" 
          used={week.mediumLines} 
          available={mediumAvailable}
          color="amber"
          unlocked={weekUnlocks.medium}
        />
        <SizeBar 
          label="L" 
          used={week.largeLines} 
          available={largeAvailable}
          color="slate"
        />
      </div>

      {/* Total summary */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">
          {week.capacity.toLocaleString()}
        </span>
        <div className={`text-[10px] font-medium ${
          isOverCapacity ? 'text-red-600' : 
          totalAvailable < 500 ? 'text-amber-600' : 'text-slate-500'
        }`}>
          {isOverCapacity ? (
            <span>+{(week.lines - week.capacity).toLocaleString()} over</span>
          ) : (
            <span>{totalAvailable.toLocaleString()} free</span>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekCard({ week, idx, reservationDefaults, weekUnlocks, onWeekClick, onCapacityChange, onUnlockSize, onResetTicketsToBacklog, isAdmin }: WeekCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(week.capacity));
  const [warning, setWarning] = useState<CapacityWarning | null>(null);
  const [pendingCapacity, setPendingCapacity] = useState<number | null>(null);

  // Calculate available capacity for each size
  const smallAvailable = weekUnlocks.small ? week.capacity : reservationDefaults.small;
  const mediumAvailable = weekUnlocks.medium ? week.capacity : reservationDefaults.medium;
  const largeAvailable = Math.max(0, week.capacity - 
    (weekUnlocks.small ? 0 : reservationDefaults.small) - 
    (weekUnlocks.medium ? 0 : reservationDefaults.medium)
  );

  const isOverCapacity = week.lines > week.capacity;
  const totalAvailable = week.capacity - week.lines;

  const checkCapacityChange = (newCapacity: number): CapacityWarning | null => {
    // Check if new capacity is less than small+medium reservations
    const smallReserved = weekUnlocks.small ? 0 : reservationDefaults.small;
    const mediumReserved = weekUnlocks.medium ? 0 : reservationDefaults.medium;
    const totalReserved = smallReserved + mediumReserved;
    
    const needsSmallUnlock = !weekUnlocks.small && newCapacity < reservationDefaults.small;
    const needsMediumUnlock = !weekUnlocks.medium && newCapacity < (reservationDefaults.small + reservationDefaults.medium);
    
    if (needsSmallUnlock || needsMediumUnlock) {
      let message = `Capacity ${newCapacity.toLocaleString()} is less than `;
      if (needsSmallUnlock && needsMediumUnlock) {
        message += `Small (${reservationDefaults.small}) + Medium (${reservationDefaults.medium}) reservations.`;
      } else if (needsSmallUnlock) {
        message += `Small reservation (${reservationDefaults.small}).`;
      } else {
        message += `Small + Medium reservations (${totalReserved}).`;
      }
      
      return {
        type: 'reservation',
        message,
        needsSmallUnlock,
        needsMediumUnlock,
      };
    }
    
    // Check if tickets will be over capacity
    if (week.lines > newCapacity) {
      const affectedTickets = week.tickets
        .filter(t => t.locked_week === week.week && t.locked_year === week.year)
        .map(t => t.key);
      
      return {
        type: 'overflow',
        message: `New capacity (${newCapacity.toLocaleString()}) is less than scheduled lines (${week.lines.toLocaleString()}). Some tickets may need to be moved to backlog.`,
        affectedTickets,
      };
    }
    
    return null;
  };

  const handleCapacitySubmit = () => {
    const newCapacity = parseInt(editValue, 10);
    if (isNaN(newCapacity) || newCapacity <= 0) {
      setIsEditing(false);
      return;
    }
    
    const capacityWarning = checkCapacityChange(newCapacity);
    if (capacityWarning) {
      setWarning(capacityWarning);
      setPendingCapacity(newCapacity);
      setIsEditing(false);
    } else {
      onCapacityChange(week.week, week.year, newCapacity);
      setIsEditing(false);
    }
  };

  const handleConfirmCapacityChange = (unlockSmall: boolean, unlockMedium: boolean, resetTickets: boolean) => {
    if (pendingCapacity === null) return;
    
    // Apply unlocks if requested
    if (unlockSmall) {
      onUnlockSize(week.week, week.year, 'small', true);
    }
    if (unlockMedium) {
      onUnlockSize(week.week, week.year, 'medium', true);
    }
    
    // Reset affected tickets to backlog if requested
    if (resetTickets && warning?.affectedTickets && onResetTicketsToBacklog) {
      onResetTicketsToBacklog(warning.affectedTickets);
    }
    
    // Apply the capacity change
    onCapacityChange(week.week, week.year, pendingCapacity);
    
    setWarning(null);
    setPendingCapacity(null);
  };

  const handleCancelCapacityChange = () => {
    setWarning(null);
    setPendingCapacity(null);
    setEditValue(String(week.capacity));
  };

  const handleCapacityKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCapacitySubmit();
    else if (e.key === 'Escape') {
      setEditValue(String(week.capacity));
      setIsEditing(false);
    }
  };

  return (
    <DroppableWeek week={week}>
      <div
        onClick={() => !isEditing && onWeekClick(week)}
        className={`
          flex-shrink-0 w-44 rounded-lg border-2 bg-white p-2.5 cursor-pointer transition-all hover:shadow-md
          ${idx === 0 ? 'border-blue-400 shadow-sm' : 'border-gray-200'}
          ${isOverCapacity ? 'border-red-300 bg-red-50' : ''}
        `}
        title={`Click to see ${week.tickets.length} tickets`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-xs font-semibold text-gray-800">
              {idx === 0 ? `This week (${week.label})` : week.label}
            </span>
            <span className="text-[10px] text-gray-400 ml-1.5">
              {week.dateRange.split(' - ')[0]}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {week.tickets.length}
          </span>
        </div>
        
        {/* Per-size progress bars */}
        <div className="space-y-1 mb-2">
          <SizeBar 
            label="S" 
            used={week.smallLines} 
            available={smallAvailable}
            color="blue"
            unlocked={weekUnlocks.small}
            overspill={week.smallOverspill}
          />
          <SizeBar 
            label="M" 
            used={week.mediumLines} 
            available={mediumAvailable}
            color="amber"
            unlocked={weekUnlocks.medium}
            overspill={week.mediumOverspill}
          />
          <SizeBar 
            label="L" 
            used={week.largeLines} 
            available={largeAvailable}
            color="slate"
            overspill={week.largeOverspill}
          />
        </div>

        {/* Total summary */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {isAdmin && isEditing ? (
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleCapacitySubmit}
                onKeyDown={handleCapacityKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="w-14 text-[10px] px-1 py-0.5 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                autoFocus
              />
            ) : isAdmin ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditValue(String(week.capacity));
                  setIsEditing(true);
                }}
                className="text-[10px] text-gray-500 hover:text-blue-600 flex items-center gap-0.5"
                title="Edit capacity (admin)"
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                {week.capacity.toLocaleString()}
              </button>
            ) : (
              <span className="text-[10px] text-gray-500">
                {week.capacity.toLocaleString()}
              </span>
            )}
          </div>
          <div className={`text-[10px] font-medium ${
            isOverCapacity ? 'text-red-600' : 
            totalAvailable < 500 ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {isOverCapacity ? (
              <span>+{(week.lines - week.capacity).toLocaleString()} over</span>
            ) : (
              <span>{totalAvailable.toLocaleString()} free</span>
            )}
          </div>
        </div>
      </div>
      
      {/* Capacity Change Warning Dialog */}
      {warning && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={handleCancelCapacityChange} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-50 w-[420px] p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Capacity Change Warning</h3>
                <p className="text-sm text-gray-600">{warning.message}</p>
              </div>
            </div>
            
            {warning.type === 'reservation' && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-gray-500 mb-2">To apply this capacity, you need to unlock:</p>
                <div className="space-y-2">
                  {warning.needsSmallUnlock && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" defaultChecked className="rounded border-gray-300" />
                      <span className="text-blue-600 font-medium">Small tickets</span>
                      <span className="text-gray-400">(removes {reservationDefaults.small} reservation)</span>
                    </label>
                  )}
                  {warning.needsMediumUnlock && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" defaultChecked className="rounded border-gray-300" />
                      <span className="text-amber-600 font-medium">Medium tickets</span>
                      <span className="text-gray-400">(removes {reservationDefaults.medium} reservation)</span>
                    </label>
                  )}
                </div>
              </div>
            )}
            
            {warning.type === 'overflow' && warning.affectedTickets && warning.affectedTickets.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-red-600 font-medium mb-2">
                  ⚠️ These tickets will be moved to backlog:
                </p>
                <div className="flex flex-wrap gap-1">
                  {warning.affectedTickets.map(key => (
                    <span key={key} className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelCapacityChange}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmCapacityChange(
                  warning.needsSmallUnlock || false,
                  warning.needsMediumUnlock || false,
                  warning.type === 'overflow'
                )}
                className="px-3 py-1.5 text-sm bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-colors font-medium"
              >
                {warning.type === 'reservation' ? 'Unlock & Apply' : 'Apply & Reset Tickets'}
              </button>
            </div>
          </div>
        </>
      )}
    </DroppableWeek>
  );
}

export function CapacityTimeline({ 
  queueTickets,
  queueSchedule,
  weeklyCapacity, 
  weekCapacities, 
  reservationDefaults,
  getWeekUnlocks,
  onWeekClick, 
  onWeekCapacityChange,
  onUnlockSize,
  onResetTicketsToBacklog,
  isAdmin,
}: CapacityTimelineProps) {
  const [showPastWeeks, setShowPastWeeks] = useState(false);
  const PAST_WEEKS_COUNT = 24;
  
  const weeksMap = new Map<string, WeekData>();

  const totalLines = queueTickets.reduce((s, t) => s + t.lines, 0);

  // Extend horizon to cover every displayWeek in the shared schedule.
  // Tickets with 0 lines have no effect on totalLines but still need a visible week
  // card so the count badge agrees with the table divider.
  let maxScheduleOffset = 0;
  if (queueSchedule.size > 0) {
    const currentWeekData = getWeekData(0, weeklyCapacity, weekCapacities);
    const currentWeek = currentWeekData.week;
    const currentYear = currentWeekData.year;
    for (const placement of queueSchedule.values()) {
      // Approximate ISO-week offset: each year is ~52 weeks
      const yearDiff = placement.displayYear - currentYear;
      const weekDiff = placement.displayWeek - currentWeek;
      const offset = yearDiff * 52 + weekDiff;
      if (offset > maxScheduleOffset) maxScheduleOffset = offset;
    }
  }

  const numWeeks = Math.max(12, Math.ceil(totalLines / weeklyCapacity) + 4, maxScheduleOffset + 2);
  
  // Initialize weeks
  for (let i = 0; i < numWeeks; i++) {
    const wd = getWeekData(i, weeklyCapacity, weekCapacities);
    const key = `${wd.year}-${wd.week}`;
    weeksMap.set(key, {
      ...wd,
      lines: 0,
      tickets: [],
      percent: 0,
      smallLines: 0,
      mediumLines: 0,
      largeLines: 0,
      // Overspill tracking
      smallOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
      mediumOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
      largeOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
    });
  }
  
  // Assign tickets to weeks
  
  // Helper to get week key for BACKWARD offset from a target week/year
  const getWeekKeyForBackwardOffset = (targetWeek: number, targetYear: number, backwardOffset: number): string => {
    let week = targetWeek - backwardOffset;
    let year = targetYear;
    while (week < 1) {
      week += 52;
      year -= 1;
    }
    return `${year}-${week}`;
  };
  
  // Helper to calculate SIZE-SPECIFIC capacity for a week
  // Small tickets: use small reservation (or full capacity if unlocked)
  // Medium tickets: use medium reservation (or full capacity if unlocked)
  // Big/Large tickets: use remaining after small/medium reservations
  const getSizeCapacity = (weekCapacity: number, week: number, year: number, ticketSize: 'small' | 'medium' | 'big'): number => {
    const unlocks = getWeekUnlocks(week, year);
    
    if (ticketSize === 'small') {
      return unlocks.small ? weekCapacity : reservationDefaults.small;
    } else if (ticketSize === 'medium') {
      return unlocks.medium ? weekCapacity : reservationDefaults.medium;
    } else {
      // Big/Large: gets what's left after small/medium reservations
      const smallReserved = unlocks.small ? 0 : reservationDefaults.small;
      const mediumReserved = unlocks.medium ? 0 : reservationDefaults.medium;
      return Math.max(0, weekCapacity - smallReserved - mediumReserved);
    }
  };
  
  // Track per-size usage per week
  const weekSizeUsage = new Map<string, { small: number; medium: number; large: number }>();
  weeksMap.forEach((_, key) => {
    weekSizeUsage.set(key, { small: 0, medium: 0, large: 0 });
  });
  
  // PASS 1: locked tickets — backward fill from displayWeek (= locked_week = due week)
  // Ticket is listed on its displayWeek card (source of truth from shared schedule).
  for (const ticket of queueTickets) {
    if (ticket.locked_week == null || ticket.locked_year == null) continue;
    const placement = queueSchedule.get(ticket.key);
    if (!placement) continue;

    const ticketSize = getTicketSize(ticket.lines);
    let remainingLines = ticket.lines;
    let backwardOffset = 0;
    const weekAllocations: Array<{ key: string; lines: number }> = [];

    const maxIterations = 104;
    while (remainingLines > 0 && backwardOffset < maxIterations) {
      const weekKey = getWeekKeyForBackwardOffset(placement.displayWeek, placement.displayYear, backwardOffset);
      const weekData = weeksMap.get(weekKey);
      if (!weekData) break; // out of visible window

      const sizeCapacity = getSizeCapacity(weekData.capacity, weekData.week, weekData.year, ticketSize);

      if (sizeCapacity <= 0) {
        const fallbackCapacity = weekData.capacity || weeklyCapacity;
        const linesForThisWeek = Math.min(remainingLines, fallbackCapacity);
        remainingLines -= linesForThisWeek;
        weekAllocations.push({ key: weekKey, lines: linesForThisWeek });
        backwardOffset++;
        continue;
      }

      const usage = weekSizeUsage.get(weekKey) || { small: 0, medium: 0, large: 0 };
      const alreadyUsed = ticketSize === 'small' ? usage.small : ticketSize === 'medium' ? usage.medium : usage.large;
      const availableForSize = Math.max(0, sizeCapacity - alreadyUsed);
      const linesForThisWeek = Math.min(remainingLines, availableForSize);

      if (linesForThisWeek > 0) {
        remainingLines -= linesForThisWeek;
        weekAllocations.push({ key: weekKey, lines: linesForThisWeek });
        if (ticketSize === 'small') usage.small += linesForThisWeek;
        else if (ticketSize === 'medium') usage.medium += linesForThisWeek;
        else usage.large += linesForThisWeek;
      }

      backwardOffset++;
    }

    // Apply allocations — idx 0 is the displayWeek (due/target week)
    weekAllocations.forEach((alloc, idx) => {
      const week = weeksMap.get(alloc.key);
      if (!week) return;
      week.lines += alloc.lines;

      if (idx === 0) {
        // displayWeek owns this ticket
        week.tickets.push(ticket);
      }

      const isOverspill = idx > 0;
      if (ticketSize === 'small') {
        week.smallLines += alloc.lines;
        if (isOverspill) {
          week.smallOverspill.lines += alloc.lines;
          if (!week.smallOverspill.ticketKeys.includes(ticket.key)) {
            week.smallOverspill.ticketKeys.push(ticket.key);
            week.smallOverspill.ticketSummaries.push(ticket.summary);
          }
        }
      } else if (ticketSize === 'medium') {
        week.mediumLines += alloc.lines;
        if (isOverspill) {
          week.mediumOverspill.lines += alloc.lines;
          if (!week.mediumOverspill.ticketKeys.includes(ticket.key)) {
            week.mediumOverspill.ticketKeys.push(ticket.key);
            week.mediumOverspill.ticketSummaries.push(ticket.summary);
          }
        }
      } else {
        week.largeLines += alloc.lines;
        if (isOverspill) {
          week.largeOverspill.lines += alloc.lines;
          if (!week.largeOverspill.ticketKeys.includes(ticket.key)) {
            week.largeOverspill.ticketKeys.push(ticket.key);
            week.largeOverspill.ticketSummaries.push(ticket.summary);
          }
        }
      }
      week.percent = Math.round((week.lines / week.capacity) * 100);
    });
  }

  // Generate past weeks data for view-only display
  const pastWeeksMap = new Map<string, WeekData>();
  if (showPastWeeks) {
    for (let i = -PAST_WEEKS_COUNT; i < 0; i++) {
      const wd = getWeekData(i, weeklyCapacity, weekCapacities);
      const key = `${wd.year}-${wd.week}`;
      pastWeeksMap.set(key, {
        ...wd,
        lines: 0,
        tickets: [],
        percent: 0,
        smallLines: 0,
        mediumLines: 0,
        largeLines: 0,
        smallOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
        mediumOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
        largeOverspill: { lines: 0, ticketKeys: [], ticketSummaries: [] },
      });
    }

    // Assign tickets to past weeks using displayWeek (consistent with table)
    for (const ticket of queueTickets) {
      const placement = queueSchedule.get(ticket.key);
      if (!placement) continue;
      const key = `${placement.displayYear}-${placement.displayWeek}`;
      const pastWeek = pastWeeksMap.get(key);
      if (pastWeek) {
        const ticketSize = getTicketSize(ticket.lines);
        pastWeek.lines += ticket.lines;
        pastWeek.tickets.push(ticket);
        if (ticketSize === 'small') pastWeek.smallLines += ticket.lines;
        else if (ticketSize === 'medium') pastWeek.mediumLines += ticket.lines;
        else pastWeek.largeLines += ticket.lines;
        pastWeek.percent = Math.round((pastWeek.lines / pastWeek.capacity) * 100);
      }
    }
  }

  // PASS 2: unlocked tickets — forward fill starting from placement.startWeek
  // Ticket is listed on its displayWeek card (= final/due week, same as table).
  for (const ticket of queueTickets) {
    if (ticket.locked_week != null) continue;
    const placement = queueSchedule.get(ticket.key);
    if (!placement) continue;

    const ticketSize = getTicketSize(ticket.lines);
    let remainingLines = ticket.lines;
    let currentWeek = placement.startWeek;
    let currentYear = placement.startYear;
    const maxIterations = 104;
    let iterations = 0;

    while (remainingLines > 0 && iterations < maxIterations) {
      const weekKey = `${currentYear}-${currentWeek}`;
      const weekData = weeksMap.get(weekKey);

      if (!weekData) {
        currentWeek++;
        if (currentWeek > 52) { currentWeek = 1; currentYear++; }
        iterations++;
        continue;
      }

      const sizeCapacity = getSizeCapacity(weekData.capacity, weekData.week, weekData.year, ticketSize);
      const effectiveCap = sizeCapacity > 0 ? sizeCapacity : (weekData.capacity || weeklyCapacity);
      const usage = weekSizeUsage.get(weekKey) || { small: 0, medium: 0, large: 0 };
      const alreadyUsed = ticketSize === 'small' ? usage.small : ticketSize === 'medium' ? usage.medium : usage.large;
      const availableForSize = Math.max(0, effectiveCap - alreadyUsed);

      if (availableForSize <= 0) {
        currentWeek++;
        if (currentWeek > 52) { currentWeek = 1; currentYear++; }
        iterations++;
        continue;
      }

      const linesForThisWeek = Math.min(remainingLines, availableForSize);
      remainingLines -= linesForThisWeek;

      if (ticketSize === 'small') usage.small += linesForThisWeek;
      else if (ticketSize === 'medium') usage.medium += linesForThisWeek;
      else usage.large += linesForThisWeek;

      weekData.lines += linesForThisWeek;
      if (ticketSize === 'small') weekData.smallLines += linesForThisWeek;
      else if (ticketSize === 'medium') weekData.mediumLines += linesForThisWeek;
      else weekData.largeLines += linesForThisWeek;
      weekData.percent = Math.round((weekData.lines / weekData.capacity) * 100);

      if (remainingLines > 0) {
        currentWeek++;
        if (currentWeek > 52) { currentWeek = 1; currentYear++; }
      }
      iterations++;
    }

    // Push ticket to week.tickets at displayWeek (= final/due week, matches table)
    const displayKey = `${placement.displayYear}-${placement.displayWeek}`;
    const displayWeekData = weeksMap.get(displayKey);
    if (displayWeekData && !displayWeekData.tickets.some(t => t.key === ticket.key)) {
      displayWeekData.tickets.push(ticket);
    }
  }
  
  const weeks = Array.from(weeksMap.values());
  const pastWeeks = Array.from(pastWeeksMap.values());

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-end mb-3">
        {/* Past weeks toggle button */}
        <button
          onClick={() => setShowPastWeeks(!showPastWeeks)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-full transition-all ${
            showPastWeeks 
              ? 'bg-slate-600 text-white' 
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
          title={showPastWeeks ? 'Hide past weeks' : 'Show past 24 weeks (view-only)'}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {showPastWeeks ? 'Hide Past' : 'Past Weeks'}
        </button>
      </div>
      
      {/* Past weeks view (view-only) */}
      {showPastWeeks && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Past 24 Weeks</span>
            <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">View only</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 timeline-scroll opacity-75">
            {pastWeeks.map((week) => (
              <PastWeekCard
                key={`past-${week.year}-${week.week}`}
                week={week}
                reservationDefaults={reservationDefaults}
                weekUnlocks={getWeekUnlocks(week.week, week.year)}
                onWeekClick={onWeekClick}
              />
            ))}
          </div>
        </div>
      )}
      
      <div className="flex gap-2 overflow-x-auto pb-2 timeline-scroll">
        {weeks.map((week, idx) => (
          <WeekCard
            key={`${week.year}-${week.week}`}
            week={week}
            idx={idx}
            reservationDefaults={reservationDefaults}
            weekUnlocks={getWeekUnlocks(week.week, week.year)}
            onWeekClick={onWeekClick}
            onCapacityChange={onWeekCapacityChange}
            onUnlockSize={onUnlockSize}
            onResetTicketsToBacklog={onResetTicketsToBacklog}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </div>
  );
}
