import { useEffect } from 'react';
import type { Ticket } from '../types/ticket';

interface TicketDetailProps {
  ticket: Ticket;
  onClose: () => void;
}

// Log ticket inspection to audit system
async function logTicketInspection(ticket: Ticket) {
  try {
    await fetch('/api/tickets/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ticket_key: ticket.key,
        ticket_summary: ticket.summary,
        ticket_lines: ticket.lines,
        ticket_status: ticket.status,
      }),
    });
  } catch (e) {
    console.error('Failed to log ticket inspection:', e);
  }
}

export function TicketDetail({ ticket, onClose }: TicketDetailProps) {
  const jiraUrl = `https://prewave.atlassian.net/browse/${ticket.key}`;
  
  // Log inspection when component mounts
  useEffect(() => {
    logTicketInspection(ticket);
  }, [ticket]);
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="detail-panel fixed right-0 top-0 h-full w-96 bg-white shadow-xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 hover:underline">
              {ticket.key}
            </a>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{ticket.status}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Summary */}
          <div>
            <h2 className="font-semibold text-gray-900 text-sm leading-snug">{ticket.summary}</h2>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">Lines</div>
              <div className="font-bold text-gray-900">{ticket.lines.toLocaleString()}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">Created</div>
              <div className="font-medium text-gray-900">{formatDateShort(ticket.created)}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">Assignee</div>
              <div className="font-medium text-gray-900 truncate" title={ticket.assignee || 'Unassigned'}>
                {ticket.assignee || '-'}
              </div>
            </div>
          </div>

          {/* Expected Delivery */}
          {ticket.expected_delivery && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <div className="text-xs text-emerald-600 font-medium">Expected Delivery</div>
              <div className="font-bold text-emerald-700">{ticket.expected_delivery}</div>
              {ticket.queue_position && (
                <div className="text-xs text-emerald-600 mt-1">Queue position: #{ticket.queue_position}</div>
              )}
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Description</h3>
            {ticket.description ? (
              <div className="text-sm text-gray-700 bg-gray-50 rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {ticket.description}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No description</p>
            )}
          </div>

          {/* Comments */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Recent Comments {ticket.comments?.length > 0 && `(${ticket.comments.length})`}
            </h3>
            {ticket.comments && ticket.comments.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {ticket.comments.map((comment, idx) => (
                  <div key={idx} className="bg-gray-50 rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">{comment.author}</span>
                      <span className="text-gray-400">{formatDate(comment.created)}</span>
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap">{comment.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No comments</p>
            )}
          </div>

          {/* Actions */}
          <a
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full p-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
          >
            Open in Jira
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </>
  );
}
