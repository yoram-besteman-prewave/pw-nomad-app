import { useState } from 'react';
import type { Ticket } from '../types/ticket';

interface MoveDialogProps {
  ticket: Ticket;
  maxPosition: number;
  onMove: (position: number) => void;
  onClose: () => void;
}

export function MoveDialog({ ticket, maxPosition, onMove, onClose }: MoveDialogProps) {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pos = Math.max(1, Math.min(parseInt(inputValue) || 1, maxPosition + 1));
    onMove(pos);
    onClose();
  };

  return (
    <div className="modal-overlay fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onClose}>
      <div 
        className="modal-content bg-white rounded-lg shadow-xl w-72 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-900 mb-1">Move {ticket.key}</h3>
        <p className="text-xs text-gray-500 mb-3">Enter queue position (1-{maxPosition + 1})</p>
        
        <form onSubmit={handleSubmit}>
          <input
            type="number"
            min={1}
            max={maxPosition + 1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter position"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            autoFocus
          />
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
            >
              Move
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

