import type { Ticket } from '../types/ticket';

interface ExpiredTicketsDialogProps {
  tickets: Ticket[];
  onDismiss: () => void;
}

export function ExpiredTicketsDialog({ tickets, onDismiss }: ExpiredTicketsDialogProps) {
  if (tickets.length === 0) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onDismiss} />
      
      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-50 w-[500px] max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="bg-blue-50 px-5 py-4 border-b border-blue-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-full">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Tickets Auto-Returned</h3>
              <p className="text-sm text-gray-600">
                {tickets.length} ticket{tickets.length > 1 ? 's were' : ' was'} automatically moved back to the queue
              </p>
            </div>
          </div>
        </div>

        {/* Ticket list */}
        <div className="p-5 max-h-[400px] overflow-y-auto">
          <p className="text-xs text-gray-500 mb-3">
            These tickets were scheduled for weeks that have already passed, but their Jira status isn't "Jumped" or "Done". 
            They've been automatically unlocked and are now available in the queue for rescheduling.
          </p>
          
          <div className="space-y-2">
            {tickets.map(ticket => (
              <div 
                key={ticket.key}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex-shrink-0">
                  <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded ${
                    ticket.lines < 500 ? 'bg-blue-100 text-blue-700' :
                    ticket.lines <= 1500 ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-700'
                  }`}>
                    {ticket.lines < 500 ? 'S' : ticket.lines <= 1500 ? 'M' : 'L'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a 
                      href={`https://prewave.atlassian.net/browse/${ticket.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {ticket.key}
                    </a>
                    <span className="text-xs text-gray-400">
                      was W{ticket.locked_week}/{ticket.locked_year}
                    </span>
                    {/* Auto-returned indicator */}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      Returned
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{ticket.summary}</p>
                </div>
                <div className="flex-shrink-0 text-xs text-gray-500 tabular-nums">
                  {ticket.lines.toLocaleString()} lines
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="bg-gray-50 px-5 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
