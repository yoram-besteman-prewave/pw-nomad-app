import { useState, useCallback } from 'react';
import type { Ticket } from '../types/ticket';

interface ECPanelProps {
  onClose: () => void;
  tickets: Ticket[];
  onApprove: (ticketKey: string) => Promise<boolean>;
  onRefresh: () => void;
}

interface CompletedApproval {
  ticketKey: string;
  success: boolean;
  message: string;
  timestamp: number;
}

export function ECPanel({ onClose, tickets, onApprove, onRefresh }: ECPanelProps) {
  // Track tickets that have been clicked for approval (optimistic removal)
  const [dismissedTickets, setDismissedTickets] = useState<Set<string>>(new Set());
  
  // Track tickets currently being processed (for counter display)
  const [processingTickets, setProcessingTickets] = useState<Set<string>>(new Set());
  
  // Track completed approvals for toast-like feedback
  const [completedApprovals, setCompletedApprovals] = useState<CompletedApproval[]>([]);

  // Filter tickets that are eligible for approval (excluding dismissed ones)
  const pendingApprovalTickets = tickets.filter(t => 
    t.in_queue && 
    t.has_total_count && 
    !t.is_approved && 
    !t.is_jumped &&
    t.status.toLowerCase() !== 'jumped' &&
    !dismissedTickets.has(t.key)
  );

  // Helper to add a completed approval toast
  const addCompletedApproval = useCallback((ticketKey: string, success: boolean) => {
    const approval: CompletedApproval = {
      ticketKey,
      success,
      message: success ? `${ticketKey} approved!` : `Failed: ${ticketKey}`,
      timestamp: Date.now(),
    };
    setCompletedApprovals(prev => [...prev, approval]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setCompletedApprovals(prev => prev.filter(a => a.timestamp !== approval.timestamp));
    }, 3000);
  }, []);

  // Helper to restore a ticket to the visible list (on failure)
  const restoreTicket = useCallback((ticketKey: string) => {
    setDismissedTickets(prev => {
      const next = new Set(prev);
      next.delete(ticketKey);
      return next;
    });
  }, []);

  // Process a single approval - runs independently (fire-and-forget)
  const processApproval = useCallback(async (ticketKey: string) => {
    // Track as processing
    setProcessingTickets(prev => new Set(prev).add(ticketKey));
    
    try {
      const success = await onApprove(ticketKey);
      addCompletedApproval(ticketKey, success);
      
      if (!success) {
        // Re-add to visible list on failure after delay
        setTimeout(() => restoreTicket(ticketKey), 2000);
      }
    } catch (error) {
      console.error(`Error approving ${ticketKey}:`, error);
      addCompletedApproval(ticketKey, false);
      // Re-add to visible list on error
      setTimeout(() => restoreTicket(ticketKey), 2000);
    } finally {
      // Remove from processing set
      setProcessingTickets(prev => {
        const next = new Set(prev);
        next.delete(ticketKey);
        return next;
      });
    }
  }, [onApprove, addCompletedApproval, restoreTicket]);

  // Handle approve click - INSTANT feedback, parallel processing
  const handleApprove = useCallback((ticketKey: string) => {
    // 1. Immediately dismiss from UI (optimistic)
    setDismissedTickets(prev => new Set(prev).add(ticketKey));
    
    // 2. Fire API call immediately (no queue, no waiting)
    processApproval(ticketKey);
  }, [processApproval]);

  // Count of tickets currently processing
  const processingCount = processingTickets.size;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      
      {/* Panel */}
      <div className="fixed top-4 right-4 bottom-4 w-[480px] bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-violet-600 via-purple-600 to-pink-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Pixel art avatar */}
            <div className="w-10 h-10 rounded-full p-0.5 bg-white/30 shadow-lg">
              <div className="w-full h-full rounded-full overflow-hidden bg-white">
                <img 
                  src="/eszter-avatar.png" 
                  alt="Eszter"
                  className="w-full h-full object-cover"
                  style={{ imageRendering: 'pixelated' }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    target.parentElement!.innerHTML = '<div class="w-full h-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs">ES</div>';
                  }}
                />
              </div>
            </div>
            <div>
              <h2 className="font-semibold text-white">Eszter's Space</h2>
              <p className="text-xs text-white/70">Ticket Approval Panel</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats bar with processing indicator */}
        <div className="px-4 py-2 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-violet-700">
              <span className="font-semibold">{pendingApprovalTickets.length}</span> pending
            </span>
            {processingCount > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-amber-600">
                <span className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-500 rounded-full animate-spin" />
                {processingCount} processing...
              </span>
            )}
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Completion toasts */}
        {completedApprovals.length > 0 && (
          <div className="px-4 py-2 space-y-1 border-b border-gray-100 bg-gray-50">
            {completedApprovals.map((approval, idx) => (
              <div
                key={`${approval.ticketKey}-${approval.timestamp}-${idx}`}
                className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200 ${
                  approval.success
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {approval.success ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                {approval.message}
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {pendingApprovalTickets.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-violet-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-1">All caught up!</h3>
              <p className="text-sm text-gray-500">
                {processingCount > 0 
                  ? `Processing ${processingCount} approval${processingCount > 1 ? 's' : ''}...`
                  : 'No tickets pending approval.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingApprovalTickets.map((ticket) => (
                <div
                  key={ticket.key}
                  className="bg-white border border-gray-200 rounded-lg p-3 hover:border-violet-300 transition-all duration-150"
                >
                  <div className="flex items-start gap-3">
                    {/* Lines badge */}
                    <div className="flex-shrink-0 w-14 h-14 bg-gradient-to-br from-violet-100 to-purple-100 rounded-lg flex flex-col items-center justify-center">
                      <span className="text-xs text-violet-500 font-medium">Lines</span>
                      <span className="text-sm font-bold text-violet-700">{ticket.lines.toLocaleString()}</span>
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
                        <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">
                          {ticket.status}
                        </span>
                      </div>
                      
                      {/* Summary */}
                      <p className="text-sm text-gray-700 line-clamp-2 mb-2">{ticket.summary}</p>
                      
                      {/* Assignee & Scheduled info */}
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        {ticket.assignee && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {ticket.assignee}
                          </span>
                        )}
                        {ticket.locked_week && (
                          <span className="flex items-center gap-1 text-amber-600">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                            W{ticket.locked_week}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* Approve button - always clickable, instant response */}
                    <button
                      onClick={() => handleApprove(ticket.key)}
                      className="flex-shrink-0 px-3 py-2 rounded-lg font-medium text-sm transition-all duration-150 flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 hover:scale-105 active:scale-95 text-white shadow-sm hover:shadow"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-[10px] text-gray-500 text-center">
            Click to approve instantly • All approvals process in parallel
            <br />
            Approved tickets are ready to hand off when their scheduled week begins.
          </p>
        </div>
      </div>
    </>
  );
}
