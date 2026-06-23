import { useState } from 'react';
import type { ReservationDefaults, WeekUnlocks } from '../types/ticket';
import type { WeekReservation } from '../hooks/useJiraTickets';

// Nuclear Reset API call
async function performNuclearReset(): Promise<{ success: boolean; message: string; tickets_cleared?: number }> {
  const response = await fetch('/api/admin/nuclear-reset', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Nuclear reset failed');
  }
  return response.json();
}

interface SettingsProps {
  weeklyCapacity: number;
  onCapacityChange: (capacity: number) => void;
  reservationDefaults: ReservationDefaults;
  onReservationDefaultsChange: (defaults: ReservationDefaults) => void;
  weekReservations: Record<string, WeekReservation>;
  onWeekUnlockChange: (week: number, year: number, size: 'small' | 'medium', unlocked: boolean) => void;
  onClose: () => void;
  isAdmin: boolean;
}

function getUpcomingWeeks(count: number): { week: number; year: number; label: string }[] {
  const weeks = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const target = new Date(now);
    target.setDate(target.getDate() + i * 7);
    
    const d = new Date(Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const year = d.getUTCFullYear();
    
    const weekStart = new Date(target);
    weekStart.setDate(target.getDate() - target.getDay() + 1);
    
    weeks.push({
      week,
      year,
      label: `W${week} · ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    });
  }
  
  return weeks;
}

// Log reservation toggle to audit system
async function logReservationToggle(week: number, year: number, size: 'small' | 'medium', unlocked: boolean) {
  try {
    await fetch('/api/reservation/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type: `${size}_ticket`,
        week,
        year,
        unlocked,
      }),
    });
  } catch (e) {
    console.error('Failed to log reservation toggle:', e);
  }
}

export function Settings({ 
  weeklyCapacity, 
  onCapacityChange, 
  reservationDefaults,
  onReservationDefaultsChange,
  weekReservations, 
  onWeekUnlockChange, 
  onClose,
  isAdmin,
}: SettingsProps) {
  const [capacity, setCapacity] = useState(String(weeklyCapacity));
  const [smallReservation, setSmallReservation] = useState(String(reservationDefaults.small));
  const [mediumReservation, setMediumReservation] = useState(String(reservationDefaults.medium));
  const upcomingWeeks = getUpcomingWeeks(12);
  
  // Nuclear reset state
  const [nuclearStep, setNuclearStep] = useState<0 | 1 | 2>(0); // 0 = not started, 1 = first confirm, 2 = second confirm
  const [nuclearLoading, setNuclearLoading] = useState(false);
  const [nuclearResult, setNuclearResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const handleNuclearReset = async () => {
    if (nuclearStep === 0) {
      setNuclearStep(1);
    } else if (nuclearStep === 1) {
      setNuclearStep(2);
    } else if (nuclearStep === 2) {
      setNuclearLoading(true);
      try {
        const result = await performNuclearReset();
        setNuclearResult({ success: true, message: result.message });
        // Reload the page after 2 seconds to refresh all data
        setTimeout(() => window.location.reload(), 2000);
      } catch (e) {
        setNuclearResult({ success: false, message: 'Nuclear reset failed. Check console.' });
      }
      setNuclearLoading(false);
      setNuclearStep(0);
    }
  };
  
  const cancelNuclear = () => {
    setNuclearStep(0);
  };

  const handleCapacitySubmit = () => {
    const newCapacity = parseInt(capacity, 10);
    if (!isNaN(newCapacity) && newCapacity > 0) {
      onCapacityChange(newCapacity);
    }
  };

  const handleSmallReservationSubmit = async () => {
    const newValue = parseInt(smallReservation, 10);
    // Allow 0, but validate total reservations don't exceed capacity
    if (!isNaN(newValue) && newValue >= 0) {
      const totalReservations = newValue + reservationDefaults.medium;
      if (totalReservations > weeklyCapacity) {
        alert(`Total reservations (${totalReservations}) cannot exceed weekly capacity (${weeklyCapacity})`);
        setSmallReservation(String(reservationDefaults.small));
        return;
      }
      onReservationDefaultsChange({ ...reservationDefaults, small: newValue });
      // Persist to backend
      try {
        await fetch('/api/settings/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ small: newValue }),
        });
      } catch (e) {
        console.error('Failed to save small reservation:', e);
      }
    }
  };

  const handleMediumReservationSubmit = async () => {
    const newValue = parseInt(mediumReservation, 10);
    // Allow 0, but validate total reservations don't exceed capacity
    if (!isNaN(newValue) && newValue >= 0) {
      const totalReservations = reservationDefaults.small + newValue;
      if (totalReservations > weeklyCapacity) {
        alert(`Total reservations (${totalReservations}) cannot exceed weekly capacity (${weeklyCapacity})`);
        setMediumReservation(String(reservationDefaults.medium));
        return;
      }
      onReservationDefaultsChange({ ...reservationDefaults, medium: newValue });
      // Persist to backend
      try {
        await fetch('/api/settings/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ medium: newValue }),
        });
      } catch (e) {
        console.error('Failed to save medium reservation:', e);
      }
    }
  };

  const getWeekUnlocks = (week: number, year: number): WeekUnlocks => {
    const key = `${year}-${week}`;
    return weekReservations[key]?.unlocks ?? { small: false, medium: false };
  };

  const toggleWeekUnlock = (week: number, year: number, size: 'small' | 'medium') => {
    if (!isAdmin) return;
    
    const unlocks = getWeekUnlocks(week, year);
    const newUnlocked = !unlocks[size];
    
    // Log to audit system
    logReservationToggle(week, year, size, newUnlocked);
    
    onWeekUnlockChange(week, year, size, newUnlocked);
  };

  const largeCapacity = weeklyCapacity - reservationDefaults.small - reservationDefaults.medium;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative bg-white rounded-xl shadow-xl w-96 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Settings</h2>
            {isAdmin && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                Admin
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Capacity Summary */}
          <div className="bg-gray-50 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-700 mb-2">Weekly Capacity Breakdown</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-blue-600">Small tickets ({"<"}500 lines)</span>
                <span className="font-medium">{reservationDefaults.small.toLocaleString()} lines</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-amber-600">Medium tickets (500-1.5k)</span>
                <span className="font-medium">{reservationDefaults.medium.toLocaleString()} lines</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">Large tickets ({">"}1.5k)</span>
                <span className="font-medium">{Math.max(0, largeCapacity).toLocaleString()} lines</span>
              </div>
              <div className="border-t border-gray-200 pt-1.5 flex justify-between text-xs font-medium">
                <span className="text-gray-700">Total capacity</span>
                <span>{weeklyCapacity.toLocaleString()} lines</span>
              </div>
            </div>
          </div>

          {/* Admin-only settings */}
          {isAdmin ? (
            <>
              {/* Default Weekly Capacity */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Default Weekly Capacity
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    onBlur={handleCapacitySubmit}
                    onKeyDown={(e) => e.key === 'Enter' && handleCapacitySubmit()}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <span className="flex items-center text-xs text-gray-500">lines/week</span>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">
                  You can also edit capacity per-week in the timeline
                </p>
              </div>

              {/* Default Reservations */}
              <div>
                <h3 className="text-xs font-medium text-gray-700 mb-2">Default Size Reservations</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">
                      Small ticket reservation ({"<"}500 lines)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={smallReservation}
                        onChange={(e) => setSmallReservation(e.target.value)}
                        onBlur={handleSmallReservationSubmit}
                        onKeyDown={(e) => e.key === 'Enter' && handleSmallReservationSubmit()}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <span className="flex items-center text-xs text-gray-500">lines</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">
                      Medium ticket reservation (500-1.5k lines)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={mediumReservation}
                        onChange={(e) => setMediumReservation(e.target.value)}
                        onBlur={handleMediumReservationSubmit}
                        onKeyDown={(e) => e.key === 'Enter' && handleMediumReservationSubmit()}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <span className="flex items-center text-xs text-gray-500">lines</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-Week Unlock Toggles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">
                    Per-Week Reservation Unlocks
                  </label>
                </div>
                <p className="text-[10px] text-gray-500 mb-3">
                  Unlocking a reservation for a week allows those reserved lines to be used by any ticket size.
                </p>
                
                {/* Week toggles */}
                <div className="space-y-1.5">
                  {upcomingWeeks.map(({ week, year, label }, idx) => {
                    const unlocks = getWeekUnlocks(week, year);
                    const hasUnlock = unlocks.small || unlocks.medium;
                    
                    return (
                      <div
                        key={`${year}-${week}`}
                        className={`
                          rounded-lg border-2 transition-colors
                          ${hasUnlock 
                            ? 'bg-amber-50 border-amber-200' 
                            : 'bg-gray-50 border-gray-200'
                          }
                          ${idx === 0 ? 'border-blue-400' : ''}
                        `}
                      >
                        <div className="px-3 py-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs ${idx === 0 ? 'font-medium' : ''} ${hasUnlock ? 'text-amber-700' : 'text-gray-700'}`}>
                              {idx === 0 ? 'This week' : label}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleWeekUnlock(week, year, 'small')}
                              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                                unlocks.small
                                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                            >
                              Small {unlocks.small ? '✓' : ''}
                            </button>
                            <button
                              onClick={() => toggleWeekUnlock(week, year, 'medium')}
                              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                                unlocks.medium
                                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                            >
                              Medium {unlocks.medium ? '✓' : ''}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Nuclear Reset - Testing Only */}
              <div className="mt-6 pt-4 border-t border-red-200">
                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <div className="flex items-center gap-2 mb-2">
                    {/* Nuclear icon */}
                    <svg className="w-5 h-5 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                    </svg>
                    <h3 className="text-sm font-medium text-red-700">Nuclear Reset</h3>
                    <span className="px-1.5 py-0.5 bg-red-200 text-red-800 rounded text-[8px] font-bold uppercase">
                      Testing Only
                    </span>
                  </div>
                  
                  {nuclearResult && (
                    <div className={`mb-3 p-2 rounded text-xs ${
                      nuclearResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {nuclearResult.message}
                    </div>
                  )}
                  
                  {nuclearStep === 0 && (
                    <>
                      <p className="text-xs text-red-600 mb-3">
                        This resets the board and all associated tickets. Clears all due dates, unlocks, and moves everything to backlog.
                      </p>
                      <button
                        onClick={handleNuclearReset}
                        className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                        </svg>
                        Reset Everything
                      </button>
                    </>
                  )}
                  
                  {nuclearStep === 1 && (
                    <>
                      <p className="text-sm text-red-700 font-medium mb-3">
                        ⚠️ Are you sure? This will reset ALL scheduled tickets!
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelNuclear}
                          className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNuclearReset}
                          className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Yes, I'm sure
                        </button>
                      </div>
                    </>
                  )}
                  
                  {nuclearStep === 2 && (
                    <>
                      <p className="text-sm text-red-700 font-bold mb-3">
                        🚨 Like... are you REALLY sure? This is irreversible!
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelNuclear}
                          disabled={nuclearLoading}
                          className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          No, abort!
                        </button>
                        <button
                          onClick={handleNuclearReset}
                          disabled={nuclearLoading}
                          className="flex-1 py-2 px-4 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {nuclearLoading ? (
                            <>
                              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Nuking...
                            </>
                          ) : (
                            '☢️ NUKE IT'
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Non-admin view */
            <div className="text-center py-6">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-sm text-gray-600 font-medium mb-1">Admin Access Required</p>
              <p className="text-xs text-gray-400">
                Only members of the nomad-admins group can modify capacity and reservation settings.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-[10px] text-gray-400 text-center">
            {isAdmin ? 'Changes are saved automatically' : 'View-only mode'}
          </p>
        </div>
      </div>
    </div>
  );
}
