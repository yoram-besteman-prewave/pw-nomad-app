import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useEffect, useMemo } from 'react';
import type { Ticket, WeekHeader } from '../types/ticket';
import { getTicketSize, isSchedulable, getTicketState, isApproachingDeadline, getWorkingDaysUntilDue, getCurrentWeekAndYear } from '../types/ticket';

interface QueueItemProps {
  ticket: Ticket;
  position: number;
  totalItems: number;
  onMoveClick: () => void;
  onDetailClick: () => void;
  onUnlock?: () => void;
  onLockedDrag?: () => void;
  onJumpedDragAttempt?: () => void;
  onResetMismatch?: () => Promise<void>;
  onCopyShareLink?: (ticketKey: string) => void;
  onMoveToBacklog?: () => void;
  onPositionChange?: (newPosition: number) => void;
  showWeekLabel?: string;
  weekHeader?: WeekHeader;
  maxLines?: number;
  dueDateUpdating?: boolean;
}

export function QueueItem({ 
  ticket, 
  position,
  totalItems,
  onMoveClick, 
  onDetailClick, 
  onUnlock, 
  onLockedDrag,
  onJumpedDragAttempt,
  onResetMismatch,
  onCopyShareLink,
  onMoveToBacklog,
  onPositionChange,
  showWeekLabel, 
  weekHeader,
  maxLines = 4000,
  dueDateUpdating = false
}: QueueItemProps) {
  const [isShaking, setIsShaking] = useState(false);
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [editPosition, setEditPosition] = useState(position.toString());
  const [showMismatchDialog, setShowMismatchDialog] = useState(false);
  
  // Memoize lock status to prevent flash during drag operations
  // Only re-renders when lock values actually change, not during every drag-induced re-render
  const lockStatus = useMemo(() => ({
    isLocked: ticket.locked_week != null && ticket.locked_year != null,
    lockedWeek: ticket.locked_week,
    lockedYear: ticket.locked_year,
  }), [ticket.locked_week, ticket.locked_year]);
  
  const isLocked = lockStatus.isLocked;
  const canSchedule = isSchedulable(ticket);
  const ticketSize = getTicketSize(ticket.lines);
  const hasMismatch = ticket.has_mismatch;
  const isJumped = ticket.is_jumped || ticket.status.toLowerCase() === 'jumped';
  
  // Scheduling state: ready (green), pending_approval (orange/red), missing_data (gray)
  const ticketState = getTicketState(ticket);
  const isPendingApproval = ticketState === 'pending_approval';
  const isUrgent = isApproachingDeadline(ticket); // Less than 10 working days and not approved
  const workingDaysLeft = getWorkingDaysUntilDue(ticket);
  
  // Check if ticket is scheduled for current week (either locked or auto-scheduled)
  const { week: currentWeek, year: currentYear } = getCurrentWeekAndYear();
  const ticketWeek = lockStatus.lockedWeek ?? ticket.effectiveWeek;
  const ticketYear = lockStatus.lockedYear ?? ticket.effectiveYear;
  const isCurrentWeek = ticketWeek === currentWeek && ticketYear === currentYear;
  
  // Ready to jump: approved AND due date within 10 working days
  const isReadyToJump = ticket.is_approved && workingDaysLeft !== null && workingDaysLeft <= 10 && !isJumped && !hasMismatch;
  
  // Approaching and not ready: NOT approved AND scheduled for current week
  const isApproachingNotReady = !ticket.is_approved && isCurrentWeek && !isJumped && !hasMismatch && ticket.has_total_count;

  // Sync edit position when position changes externally
  useEffect(() => {
    if (!isEditingPosition) {
      setEditPosition(position.toString());
    }
  }, [position, isEditingPosition]);

  // Handle position input commit
  const handlePositionCommit = () => {
    setIsEditingPosition(false);
    const newPos = parseInt(editPosition, 10);
    if (!isNaN(newPos) && newPos >= 1 && newPos <= totalItems && newPos !== position) {
      onPositionChange?.(newPos);
    } else {
      setEditPosition(position.toString()); // Reset to current
    }
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: ticket.key,
    disabled: isLocked || !canSchedule || isJumped || hasMismatch,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,  // Keep visible while dragging
  };

  const jiraUrl = `https://prewave.atlassian.net/browse/${ticket.key}`;
  
  const linePercent = Math.min((ticket.lines / maxLines) * 100, 100);
  // Colors match CapacityTimeline: blue=small, amber=medium, slate=large
  const getLineColor = () => {
    if (!canSchedule) return 'bg-gray-300';
    if (ticket.lines > 1500) return 'bg-slate-500';   // Large
    if (ticket.lines >= 500) return 'bg-amber-500';   // Medium
    return 'bg-blue-500';                              // Small
  };

  const getSizeBadge = () => {
    if (!ticket.has_total_count) return null;
    // Match CapacityTimeline colors: S=blue, M=amber, L=slate
    const colors = {
      small: 'bg-blue-100 text-blue-700',
      medium: 'bg-amber-100 text-amber-700',
      big: 'bg-slate-200 text-slate-700',
    };
    // Display labels: Small=S, Medium=M, Large=L (not Big=B)
    const labels = { small: 'S', medium: 'M', big: 'L' };
    return (
      <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${colors[ticketSize]} uppercase`}>
        {labels[ticketSize]}
      </span>
    );
  };

  const getIssueReason = () => {
    if (!ticket.has_total_count) return 'Missing Total Count';
    if (!ticket.has_screening_link) return 'No screening link';
    // Don't show "not approved" as blocking reason - these can now be scheduled
    return null;
  };
  
  // Get approval status message for tooltip
  const getApprovalStatusMessage = () => {
    if (!isPendingApproval) return null;
    if (isUrgent) {
      return `URGENT: Only ${workingDaysLeft} working day${workingDaysLeft !== 1 ? 's' : ''} until due date! Ticket will auto-move if not approved by week start.`;
    }
    return 'Pending approval - will auto-move to next slot if not approved by scheduled week start';
  };

  const getMismatchMessage = () => {
    if (!hasMismatch) return null;
    switch (ticket.mismatch_type) {
      case 'date':
        return 'Due date was changed in Jira';
      case 'lines':
        return `Lines changed (was ${ticket.scheduled_lines}, now ${ticket.lines})`;
      case 'both':
        return 'Due date and lines changed in Jira';
      default:
        return 'Data mismatch detected';
    }
  };

  const handleLockedDragAttempt = () => {
    if (isLocked || !canSchedule) {
      setIsShaking(true);
      if (isLocked) onLockedDrag?.();
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  const handleJumpedDragAttempt = () => {
    setIsShaking(true);
    onJumpedDragAttempt?.();
    setTimeout(() => setIsShaking(false), 500);
  };

  // Custom drag handle for locked items, jumped items, mismatch items, or items that can't be scheduled
  const dragHandleProps = isJumped
    ? {
        onMouseDown: handleJumpedDragAttempt,
        onTouchStart: handleJumpedDragAttempt,
      }
    : (isLocked || !canSchedule || hasMismatch)
    ? { 
        onMouseDown: handleLockedDragAttempt,
        onTouchStart: handleLockedDragAttempt,
      }
    : { ...attributes, ...listeners };

  // Format due date
  const formatDueDate = () => {
    if (!ticket.due_date) return null;
    const date = new Date(ticket.due_date);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const issueReason = getIssueReason();

  return (
    <>
      {weekHeader ? (
        (() => {
          const capPercent = weekHeader.capacity > 0
            ? (weekHeader.used / weekHeader.capacity) * 100
            : 0;
          const barColor = weekHeader.isOver
            ? 'bg-red-500'
            : capPercent >= 90
            ? 'bg-amber-500'
            : 'bg-emerald-500';
          return (
            <div className="flex items-center gap-2 mb-1 mt-3">
              {/* Week label + actual date range */}
              <span className={`week-divider inline-flex items-baseline gap-1.5 flex-shrink-0 ${weekHeader.isOver ? '!bg-red-600' : ''}`}>
                <span>{weekHeader.label}</span>
                <span className="font-normal opacity-70">{weekHeader.dateRange}</span>
              </span>

              {/* Capacity meter for the swimlane */}
              <div className="flex items-center gap-1.5 min-w-0 max-w-[280px] flex-1">
                <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(100, capPercent)}%` }}
                  />
                </div>
                <span className={`text-[9px] font-mono tabular-nums whitespace-nowrap ${weekHeader.isOver ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                  {weekHeader.used.toLocaleString()}/{weekHeader.capacity.toLocaleString()}
                </span>
                {weekHeader.isOver ? (
                  <span className="text-[9px] font-semibold text-red-600 whitespace-nowrap">
                    +{(weekHeader.used - weekHeader.capacity).toLocaleString()} over
                  </span>
                ) : (
                  <span className="text-[9px] text-gray-400 whitespace-nowrap">
                    {(weekHeader.capacity - weekHeader.used).toLocaleString()} free
                  </span>
                )}
              </div>
            </div>
          );
        })()
      ) : showWeekLabel ? (
        <div className="week-divider inline-block mb-1 mt-3">{showWeekLabel}</div>
      ) : null}
      
      {/* Mismatch warning - compact inline with ticket key */}
      
      {/* Mismatch reset confirmation dialog */}
      {showMismatchDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => !dueDateUpdating && setShowMismatchDialog(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Reset Mismatched Ticket?</h3>
            <p className="text-sm text-gray-600 mb-4">
              {getMismatchMessage()}. This ticket ({ticket.key}) was likely edited directly in Jira.
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Resetting will:
            </p>
            <ul className="text-sm text-gray-600 mb-4 list-disc list-inside">
              <li>Clear the due date in Jira</li>
              <li>Unschedule the ticket in NoMAD</li>
              <li>Move it back to the pool</li>
            </ul>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowMismatchDialog(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                disabled={dueDateUpdating}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onResetMismatch?.();
                  setShowMismatchDialog(false);
                }}
                disabled={dueDateUpdating}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {dueDateUpdating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Resetting...
                  </>
                ) : (
                  'Yes, Reset'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Pending approval / urgent warning banner - compact (only if NOT showing the "approaching not ready" banner) */}
      {isPendingApproval && !hasMismatch && !isJumped && !isApproachingNotReady && (
        <div className={`${isUrgent ? 'bg-red-100/80' : 'bg-orange-100/80'} rounded-t-md px-2 py-0.5 mb-0 flex items-center gap-1.5`}>
          <svg className={`w-3 h-3 flex-shrink-0 ${isUrgent ? 'text-red-500' : 'text-orange-500'}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className={`text-[10px] font-medium ${isUrgent ? 'text-red-700' : 'text-orange-700'}`}>
            {isUrgent 
              ? `⚠ ${workingDaysLeft} day${workingDaysLeft !== 1 ? 's' : ''} left – not approved`
              : `Pending approval (${ticket.status})`
            }
          </span>
        </div>
      )}

      {/* Ready to jump banner - for approved tickets with due date within 10 days */}
      {isReadyToJump && (
        <div className="bg-emerald-100/80 rounded-t-md px-2 py-0.5 mb-0 flex items-center gap-1.5">
          <svg className="w-3 h-3 flex-shrink-0 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="text-[10px] font-medium text-emerald-700">
            ✓ Ready to hand off ({workingDaysLeft} day{workingDaysLeft !== 1 ? 's' : ''} until due)
          </span>
        </div>
      )}
      
      {/* Approaching but not ready banner - for unapproved tickets scheduled for current week */}
      {isApproachingNotReady && (
        <div className="bg-red-100/80 rounded-t-md px-2 py-0.5 mb-0 flex items-center gap-1.5">
          <svg className="w-3 h-3 flex-shrink-0 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-[10px] font-medium text-red-700">
            Not approved – scheduled for W{ticketWeek} but missing approval
          </span>
        </div>
      )}
      
      {/* Auto-returned indicator banner */}
      {ticket.was_auto_returned && !isLocked && !isJumped && (
        <div className="bg-blue-100/80 rounded-t-md px-2 py-0.5 mb-0 flex items-center gap-1.5">
          <svg className="w-3 h-3 flex-shrink-0 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span className="text-[10px] font-medium text-blue-700">
            Auto-returned from expired schedule – reschedule to clear this indicator
          </span>
        </div>
      )}
      
      <div
        ref={setNodeRef}
        style={style}
        className={`
          ticket-row flex items-center gap-1.5 px-2 py-2 mb-1
          ${isDragging ? 'dragging' : ''}
          ${isJumped ? 'border-2 border-slate-300 bg-slate-100 opacity-60 cursor-not-allowed' : ''}
          ${hasMismatch && !isJumped ? 'border-2 border-red-500 bg-red-100' : ''}
          ${isApproachingNotReady ? 'border-2 border-red-500 bg-stripes-red-subtle rounded-t-none' : ''}
          ${isPendingApproval && !hasMismatch && isUrgent && !isJumped && !isApproachingNotReady ? 'border-2 border-red-500 bg-stripes-red-subtle rounded-t-none' : ''}
          ${isPendingApproval && !hasMismatch && !isUrgent && !isJumped && !isApproachingNotReady ? 'border-2 border-orange-400 bg-orange-50/70 rounded-t-none' : ''}
          ${isReadyToJump ? 'border-2 border-emerald-400 bg-ready-jump rounded-t-none' : ''}
          ${isLocked && !hasMismatch && !isPendingApproval && !isJumped && !ticket.is_approved && !isReadyToJump ? 'border-2 border-dashed border-gray-400 bg-gray-50' : ''}
          ${ticket.is_approved && !isReadyToJump && !isJumped && !hasMismatch && !isApproachingNotReady ? 'border-l-4 border-l-emerald-400 bg-emerald-50/30' : ''}
          ${!canSchedule && !isJumped ? 'border-2 border-gray-300 bg-gray-100 opacity-60' : ''}
          ${ticket.was_auto_returned && !isLocked && !isJumped && !isReadyToJump && !isApproachingNotReady ? 'border-2 border-blue-300 bg-blue-50/50 rounded-t-none' : ''}
          ${isShaking ? 'locked-shake' : ''}
        `}
        title={isJumped ? 'Ticket handed off, cannot be modified' : (getApprovalStatusMessage() || undefined)}
      >
        {/* Column 1: Drag handle + Position */}
        <div 
          className={`w-12 flex items-center gap-0.5 ${(isLocked || !canSchedule || isJumped || hasMismatch) ? 'cursor-not-allowed text-gray-300' : 'cursor-grab active:cursor-grabbing text-gray-400'}`}
          {...dragHandleProps}
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6-12a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
          </svg>
          {isJumped ? (
            <span className="w-7 text-center font-mono text-xs font-medium text-gray-300">-</span>
          ) : isEditingPosition ? (
            <input
              type="text"
              value={editPosition}
              onChange={(e) => setEditPosition(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onBlur={handlePositionCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePositionCommit();
                if (e.key === 'Escape') { setIsEditingPosition(false); setEditPosition(position.toString()); }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-7 text-center font-mono text-xs font-medium text-gray-700 bg-blue-50 border border-blue-300 rounded outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); if (!isLocked && canSchedule && !hasMismatch) setIsEditingPosition(true); }}
              className={`w-7 text-center font-mono text-xs font-medium rounded hover:bg-gray-100 transition-colors ${isLocked || !canSchedule || hasMismatch ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 cursor-text'}`}
              title={isLocked || !canSchedule || hasMismatch ? undefined : 'Click to change position'}
              disabled={isLocked || !canSchedule || hasMismatch}
            >
              {position}
            </button>
          )}
        </div>

        {/* Column 3: Status icons (lock, auto-return, approval, issue) - w-16 (64px) */}
        <div className="w-16 flex items-center justify-start gap-0.5">
          {/* Issue warning icon */}
          {issueReason ? (
            <div 
              className={`${!ticket.has_total_count ? 'text-red-500' : 'text-gray-400'}`}
              title={issueReason}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
          ) : null}
          
          {/* Lock icon */}
          {isLocked ? (
            <button
              onClick={(e) => { e.stopPropagation(); onUnlock?.(); }}
              className="text-amber-500 hover:text-amber-600 transition-colors"
              title={`Locked to W${lockStatus.lockedWeek}. Click to unlock.`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            </button>
          ) : null}
          
          {/* Auto-returned indicator icon */}
          {ticket.was_auto_returned && !isLocked && !isJumped ? (
            <span 
              className="text-blue-500"
              title="Auto-returned from expired schedule - reschedule to clear"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </span>
          ) : null}
          
          {/* Approval status indicator */}
          {ticket.is_approved && !isJumped ? (
            <span 
              className="text-emerald-500"
              title="Approved - ready to hand off when week starts"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </span>
          ) : !isJumped && ticket.has_total_count ? (
            <span 
              className="text-orange-400"
              title="Pending approval - needs EC approval before hand off"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
            </span>
          ) : null}
        </div>

        {/* Column 4: Size badge - w-6 (24px) */}
        <div className="w-6 flex items-center justify-center">
          {getSizeBadge()}
        </div>

        {/* Column 5: Ticket Key - w-[72px] */}
        <a 
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-[72px] font-medium hover:underline text-xs truncate ${isJumped ? 'text-slate-400' : canSchedule ? 'text-blue-600' : 'text-gray-500'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {ticket.key}
        </a>

        {/* Column 6: Badge column (mismatch/FST/Jumped) - w-44 (176px) */}
        <div className="w-44 flex items-center">
          {/* Mismatch indicator - only for non-jumped tickets */}
          {hasMismatch && !isJumped ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-red-600 truncate">
                Mismatch: {getMismatchMessage()}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMismatchDialog(true); }}
                className="text-[10px] bg-red-600 hover:bg-red-700 text-white px-1.5 py-0.5 rounded font-medium transition-colors flex-shrink-0"
              >
                Reset
              </button>
            </div>
          ) : isJumped && ticket.fst_key ? (
            <a
              href={`https://prewave.atlassian.net/browse/${ticket.fst_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
              onClick={(e) => e.stopPropagation()}
              title={`View FST ticket: ${ticket.fst_key}`}
            >
              → {ticket.fst_key}
            </a>
          ) : isJumped && !ticket.fst_key ? (
            <span className="text-[9px] px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded">
              Handed off
            </span>
          ) : null}
        </div>

        {/* Column 7: Summary - flex-1 (takes remaining space) */}
        <span 
          className={`flex-1 min-w-0 truncate cursor-pointer hover:text-gray-900 text-xs ${canSchedule ? 'text-gray-700' : 'text-gray-400'}`}
          onClick={onDetailClick}
          title={ticket.summary}
        >
          {ticket.summary}
        </span>

        {/* Column 8: Due date - w-[70px] (always rendered for alignment) */}
        <div className="w-[70px] flex items-center justify-end">
          {ticket.due_date ? (
            <span 
              className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                dueDateUpdating 
                  ? 'bg-green-100 text-green-700 animate-pulse border-2 border-green-400' 
                  : 'bg-gray-100 text-gray-600'
              } transition-all duration-500`}
              title={`Due: ${ticket.due_date}`}
            >
              📅 {formatDueDate()}
            </span>
          ) : null}
        </div>

        {/* Column 9: Assignee - w-6 (24px) */}
        <div className="w-6 flex items-center justify-center">
          {ticket.assignee ? (
            <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-medium text-gray-600" title={ticket.assignee}>
              {ticket.assignee.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </span>
          ) : (
            <span className="w-5 h-5 rounded-full bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-[8px] font-bold text-gray-400" title="Unassigned">
              ??
            </span>
          )}
        </div>

        {/* Column 10: Lines with visual bar - w-24 (96px) */}
        <div className="w-24 flex items-center gap-1">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${getLineColor()}`}
              style={{ width: ticket.has_total_count ? `${linePercent}%` : '0%' }}
            />
          </div>
          <span className="font-mono text-[10px] text-gray-600 w-9 text-right">
            {!ticket.has_total_count ? '—' : ticket.lines >= 1000 ? `${(ticket.lines / 1000).toFixed(1)}k` : ticket.lines}
          </span>
        </div>

        {/* Column 11: Week/Delivery - w-[72px] */}
        <span className={`w-[72px] text-right text-[10px] font-medium truncate ${isJumped ? 'text-slate-400' : isLocked ? 'text-amber-600' : 'text-emerald-600'}`} title={ticket.expected_delivery}>
          {isJumped && lockStatus.lockedWeek ? `W${lockStatus.lockedWeek} ✓` : isLocked ? `W${lockStatus.lockedWeek} 🔒` : ticket.expected_delivery}
        </span>

        {/* Column 12: Actions (remove, share, move) - w-[52px] */}
        <div className="w-[52px] flex items-center justify-end gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); if (!isJumped) onMoveToBacklog?.(); }}
            className={`p-1 rounded transition-colors ${isJumped ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
            title={isJumped ? "Cannot remove handed-off ticket" : "Remove from queue"}
            disabled={isJumped}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCopyShareLink?.(ticket.key); }}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
            title="Copy share link"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
          {!isJumped && !isLocked ? (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveClick(); }}
              className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="Move to position"
              disabled={!canSchedule}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          ) : (
            <div className="w-5" />
          )}
        </div>
      </div>
    </>
  );
}
