import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { Ticket } from '../types/ticket';
import { isSchedulable } from '../types/ticket';

interface PoolItemProps {
  ticket: Ticket;
  onDetailClick: () => void;
  onNotSchedulableDrag?: () => void;
  onCopyShareLink?: (ticketKey: string) => void;
  maxLines?: number;
}

export function PoolItem({ ticket, onDetailClick, onNotSchedulableDrag, onCopyShareLink, maxLines = 4000 }: PoolItemProps) {
  const [isShaking, setIsShaking] = useState(false);
  const canSchedule = isSchedulable(ticket);
  
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: ticket.key,
    disabled: !canSchedule,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const jiraUrl = `https://prewave.atlassian.net/browse/${ticket.key}`;
  
  // Calculate line size for visual indicator
  const linePercent = Math.min((ticket.lines / maxLines) * 100, 100);
  void linePercent; // Used for future visual indicator

  const getBlockingReason = (): { icon: 'error' | 'warning' | 'info'; text: string } | null => {
    if (!ticket.has_total_count) {
      return { icon: 'error', text: 'Missing Total Count' };
    }
    if (!ticket.has_screening_link) {
      return { icon: 'error', text: 'No screening link' };
    }
    // Pending approval is not blocking anymore - show as info
    if (!ticket.is_approved) {
      return { icon: 'info', text: `Can schedule (${ticket.status})` };
    }
    return null;
  };

  const handleNotSchedulableDragAttempt = () => {
    if (!canSchedule) {
      setIsShaking(true);
      onNotSchedulableDrag?.();
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  const dragHandleProps = !canSchedule 
    ? { 
        onMouseDown: handleNotSchedulableDragAttempt,
        onTouchStart: handleNotSchedulableDragAttempt,
      }
    : { ...attributes, ...listeners };

  const blockingReason = getBlockingReason();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        bg-white rounded border border-gray-200 p-2 mb-1.5 transition-all
        ${isDragging ? 'shadow-lg border-blue-400' : 'hover:border-gray-300'}
        ${!canSchedule ? 'opacity-70' : ''}
        ${isShaking ? 'animate-shake' : ''}
      `}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-1">
        {/* Drag handle */}
        <div 
          className={`flex-shrink-0 ${!canSchedule ? 'cursor-not-allowed text-gray-300' : 'cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600'}`}
          {...dragHandleProps}
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6-12a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
          </svg>
        </div>

        {/* Key */}
        <a 
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`font-medium hover:underline text-xs ${canSchedule ? 'text-blue-600' : 'text-gray-500'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {ticket.key}
        </a>

        {/* Lines */}
        <span className="ml-auto text-[10px] font-medium text-gray-500 tabular-nums">
          {!ticket.has_total_count ? '—' : ticket.lines >= 1000 ? `${(ticket.lines / 1000).toFixed(1)}k` : ticket.lines}
        </span>

        {/* Share link button */}
        <button
          onClick={(e) => { e.stopPropagation(); onCopyShareLink?.(ticket.key); }}
          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
          title="Copy share link"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      </div>

      {/* Summary */}
      <p 
        className="text-[11px] text-gray-600 truncate cursor-pointer hover:text-gray-800 mb-1"
        onClick={onDetailClick}
        title={ticket.summary}
      >
        {ticket.summary}
      </p>

      {/* Status reason banner */}
      {blockingReason && (
        <div className={`
          flex items-center gap-1.5 text-[10px] px-1.5 py-1 rounded mt-1
          ${blockingReason.icon === 'error' ? 'bg-red-50 text-red-600' : ''}
          ${blockingReason.icon === 'warning' ? 'bg-amber-50 text-amber-600' : ''}
          ${blockingReason.icon === 'info' ? 'bg-orange-50 text-orange-600' : ''}
        `}>
          {blockingReason.icon === 'info' ? (
            <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
          <span className="truncate">{blockingReason.text}</span>
        </div>
      )}
    </div>
  );
}
