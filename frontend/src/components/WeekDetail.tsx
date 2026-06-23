import type { Ticket, ReservationDefaults, WeekUnlocks } from '../types/ticket';
import { getTicketSize } from '../types/ticket';

// Overspill info from CapacityTimeline
interface OverspillInfo {
  lines: number;
  ticketKeys: string[];
  ticketSummaries: string[];
}

interface WeekDetailProps {
  week: number;
  year: number;
  dateRange: string;
  tickets: Ticket[];
  totalLines: number;
  capacity: number;
  reservationDefaults: ReservationDefaults;
  weekUnlocks: WeekUnlocks;
  onClose: () => void;
  onTicketClick: (ticket: Ticket) => void;
  onUnlockTicket: (ticketKey: string) => void;
  // Overspill data
  smallOverspill?: OverspillInfo;
  mediumOverspill?: OverspillInfo;
  largeOverspill?: OverspillInfo;
  // All queue tickets (for finding overspill ticket details)
  allQueueTickets?: Ticket[];
}

// Minimalist capacity row with overspill support
function CapacityRow({ 
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
  const overspillLines = overspill?.lines || 0;
  const directLines = Math.max(0, used - overspillLines);
  const directPercent = available > 0 ? Math.min(100, (directLines / available) * 100) : 0;
  const overspillPercent = available > 0 ? Math.min(100 - directPercent, (overspillLines / available) * 100) : 0;
  const isOver = used > available;
  const remaining = available - used;
  const hasOverspill = overspillLines > 0;
  
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
  
  const stripedClasses = {
    blue: 'bg-stripes-blue',
    amber: 'bg-stripes-amber',
    slate: 'bg-stripes-slate',
  };

  return (
    <div className="py-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 w-20">
          <span className={`w-2 h-2 rounded-full ${colorClasses[color]}`} />
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {unlocked && (
            <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
            </svg>
          )}
        </div>
        <div className={`flex-1 h-3 rounded-full ${bgClasses[color]} overflow-hidden flex`}>
          {/* Direct usage (solid) */}
          {directPercent > 0 && (
            <div 
              className={`h-full transition-all ${isOver ? 'bg-red-500' : colorClasses[color]}`}
              style={{ width: `${directPercent}%` }}
            />
          )}
          {/* Overspill usage (striped) */}
          {overspillPercent > 0 && (
            <div 
              className={`h-full transition-all ${stripedClasses[color]} border-l-2 border-white`}
              style={{ width: `${overspillPercent}%` }}
            />
          )}
        </div>
        {/* Overspill indicator */}
        {hasOverspill && (
          <span className="text-orange-500 font-bold animate-pulse" title="Includes overspill">
            ↩
          </span>
        )}
        <div className={`${hasOverspill ? 'w-28' : 'w-32'} text-right`}>
          <span className={`text-sm font-medium tabular-nums ${isOver ? 'text-red-600' : 'text-gray-900'}`}>
            {used.toLocaleString()}
          </span>
          <span className="text-sm text-gray-400"> / {available.toLocaleString()}</span>
        </div>
        <div className={`w-20 text-right text-sm font-medium ${
          isOver ? 'text-red-600' : remaining > 0 ? 'text-emerald-600' : 'text-gray-400'
        }`}>
          {isOver ? `+${(used - available).toLocaleString()}` : remaining.toLocaleString()} {isOver ? 'over' : 'free'}
        </div>
      </div>
      {/* Overspill detail */}
      {hasOverspill && (
        <div className="ml-24 mt-1 px-2 py-1 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
          <span className="font-medium">↩ {overspillLines.toLocaleString()} lines from overspill:</span>{' '}
          {overspill!.ticketKeys.join(', ')} (due in later weeks)
        </div>
      )}
    </div>
  );
}

export function WeekDetail({ 
  week, 
  year, 
  dateRange, 
  tickets, 
  totalLines, 
  capacity, 
  reservationDefaults,
  weekUnlocks,
  onClose, 
  onTicketClick,
  onUnlockTicket,
  smallOverspill,
  mediumOverspill,
  largeOverspill,
  allQueueTickets,
}: WeekDetailProps) {
  const isOver = totalLines > capacity;
  const totalFree = capacity - totalLines;

  // Calculate per-size usage (including overspill)
  const bySize = { small: 0, medium: 0, large: 0 };
  for (const ticket of tickets) {
    const size = getTicketSize(ticket.lines);
    bySize[size === 'big' ? 'large' : size] += ticket.lines;
  }
  // Add overspill lines
  bySize.small += smallOverspill?.lines || 0;
  bySize.medium += mediumOverspill?.lines || 0;
  bySize.large += largeOverspill?.lines || 0;

  // Calculate available capacity for each size
  const smallAvailable = weekUnlocks.small ? capacity : reservationDefaults.small;
  const mediumAvailable = weekUnlocks.medium ? capacity : reservationDefaults.medium;
  const largeAvailable = Math.max(0, capacity - 
    (weekUnlocks.small ? 0 : reservationDefaults.small) - 
    (weekUnlocks.medium ? 0 : reservationDefaults.medium)
  );
  
  // Get overspill tickets for display
  const overspillTickets: Ticket[] = [];
  const overspillKeys = new Set<string>();
  [smallOverspill, mediumOverspill, largeOverspill].forEach(o => {
    if (o) {
      o.ticketKeys.forEach(k => overspillKeys.add(k));
    }
  });
  if (allQueueTickets) {
    for (const t of allQueueTickets) {
      if (overspillKeys.has(t.key)) {
        overspillTickets.push(t);
      }
    }
  }

  const getSizeColor = (size: 'small' | 'medium' | 'large') => {
    if (size === 'small') return 'bg-blue-500';
    if (size === 'medium') return 'bg-amber-500';
    return 'bg-slate-500';
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-50 w-[560px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Week {week}, {year}</h2>
            <p className="text-sm text-gray-500">{dateRange}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Capacity Breakdown */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
          <div className="divide-y divide-gray-200">
            <CapacityRow 
              label="Small" 
              used={bySize.small} 
              available={smallAvailable}
              color="blue"
              unlocked={weekUnlocks.small}
              overspill={smallOverspill}
            />
            <CapacityRow 
              label="Medium" 
              used={bySize.medium} 
              available={mediumAvailable}
              color="amber"
              unlocked={weekUnlocks.medium}
              overspill={mediumOverspill}
            />
            <CapacityRow 
              label="Large" 
              used={bySize.large} 
              available={largeAvailable}
              color="slate"
              overspill={largeOverspill}
            />
          </div>
          
          {/* Total */}
          <div className="mt-3 pt-3 border-t border-gray-300 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Total</span>
            <div className="flex items-center gap-4">
              <span className={`text-lg font-bold tabular-nums ${isOver ? 'text-red-600' : 'text-gray-900'}`}>
                {totalLines.toLocaleString()} <span className="text-gray-400 font-normal">/ {capacity.toLocaleString()}</span>
              </span>
              <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                isOver ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {isOver ? `${(totalLines - capacity).toLocaleString()} over` : `${totalFree.toLocaleString()} free`}
              </span>
            </div>
          </div>
        </div>

        {/* Tickets List */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Tickets due this week */}
          {tickets.length === 0 && overspillTickets.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p>No tickets scheduled for this week</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Direct tickets - due this week */}
              {tickets.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Due this week ({tickets.length})
                  </h3>
                  <div className="space-y-2">
                    {tickets.map((ticket) => {
                      const size = getTicketSize(ticket.lines);
                      const isJumped = ticket.is_jumped || ticket.status.toLowerCase() === 'jumped';
                      return (
                        <div 
                          key={ticket.key}
                          className={`rounded-lg p-3 transition-shadow ${
                            isJumped 
                              ? 'bg-slate-100 border border-slate-300 opacity-70 cursor-not-allowed' 
                              : 'bg-white border border-gray-200 hover:shadow-md cursor-pointer'
                          }`}
                          onClick={() => !isJumped && onTicketClick(ticket)}
                          title={isJumped ? 'Ticket handed off, cannot be modified' : undefined}
                        >
                          <div className="flex items-start gap-3">
                            {/* Size indicator */}
                            <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium text-white ${isJumped ? 'bg-slate-400' : getSizeColor(size === 'big' ? 'large' : size)}`}>
                              {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                            </span>
                            
                            <div className="flex-1 min-w-0">
                              {/* Header */}
                              <div className="flex items-center gap-2 mb-1">
                                <a 
                                  href={`https://prewave.atlassian.net/browse/${ticket.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`font-semibold hover:underline text-sm ${isJumped ? 'text-slate-500' : 'text-blue-600'}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {ticket.key}
                                </a>
                                {/* Jumped badge with FST link */}
                                {isJumped && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded flex items-center gap-1">
                                    ✓ Handed off
                                    {ticket.fst_key && (
                                      <a
                                        href={`https://prewave.atlassian.net/browse/${ticket.fst_key}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-600 hover:underline font-medium"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        → {ticket.fst_key}
                                      </a>
                                    )}
                                  </span>
                                )}
                                {!isJumped && ticket.locked_week != null && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onUnlockTicket(ticket.key);
                                    }}
                                    className="text-gray-400 hover:text-amber-600 transition-colors p-0.5 rounded hover:bg-amber-50"
                                    title="Click to unlock from this week"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                                {ticket.assignee && (
                                  <span className={`text-xs ${isJumped ? 'text-slate-400' : 'text-gray-500'}`}>{ticket.assignee}</span>
                                )}
                              </div>
                              
                              {/* Summary */}
                              <p className={`text-sm line-clamp-2 ${isJumped ? 'text-slate-500' : 'text-gray-700'}`}>{ticket.summary}</p>
                            </div>
                            
                            {/* Lines count */}
                            <span className={`text-sm font-medium tabular-nums ${isJumped ? 'text-slate-400' : 'text-gray-600'}`}>
                              {ticket.lines.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Overspill tickets - due in later weeks but using this week's capacity */}
              {overspillTickets.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span className="animate-pulse">↩</span>
                    Overspill from later weeks ({overspillTickets.length})
                  </h3>
                  <p className="text-xs text-gray-500 mb-2">
                    These tickets are due in later weeks but use this week's capacity because they're too large to fit in a single week.
                  </p>
                  <div className="space-y-2">
                    {overspillTickets.map((ticket) => {
                      const size = getTicketSize(ticket.lines);
                      return (
                        <div 
                          key={ticket.key}
                          className="bg-orange-50 border border-orange-200 rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => onTicketClick(ticket)}
                        >
                          <div className="flex items-start gap-3">
                            {/* Size indicator with overspill badge */}
                            <div className="relative">
                              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium text-white ${getSizeColor(size === 'big' ? 'large' : size)}`}>
                                {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                              </span>
                              <span className="absolute -top-1 -right-1 text-[8px] bg-orange-500 text-white rounded-full w-3 h-3 flex items-center justify-center">↩</span>
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              {/* Header */}
                              <div className="flex items-center gap-2 mb-1">
                                <a 
                                  href={`https://prewave.atlassian.net/browse/${ticket.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-blue-600 hover:underline text-sm"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {ticket.key}
                                </a>
                                <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                                  Due W{ticket.locked_week}
                                </span>
                                {ticket.assignee && (
                                  <span className="text-xs text-gray-500">{ticket.assignee}</span>
                                )}
                              </div>
                              
                              {/* Summary */}
                              <p className="text-sm text-gray-700 line-clamp-2">{ticket.summary}</p>
                            </div>
                            
                            {/* Lines count */}
                            <span className="text-sm font-medium text-orange-600 tabular-nums">
                              {ticket.lines.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} · {totalLines.toLocaleString()} total lines
          {tickets.some(t => t.locked_week != null) && (
            <span className="ml-2 text-gray-400">· Click lock icon to unlock tickets</span>
          )}
        </div>
      </div>
    </>
  );
}
