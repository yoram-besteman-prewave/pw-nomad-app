import { useState, useEffect, useCallback } from 'react';

interface User {
  id: number;
  email: string;
  name: string;
  picture: string | null;
  is_admin: boolean;
  created_at: string | null;
  last_login: string | null;
}

interface Activity {
  id: number;
  user_id: number | null;
  user_email: string;
  action: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string | null;
}

interface AdminPortalProps {
  onClose: () => void;
}

const API_BASE = '/api';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

function formatDetails(_action: string, details: Record<string, unknown> | null): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  
  // Format based on action type - ticket actions
  if (details.ticket_key) {
    const parts: string[] = [String(details.ticket_key)];
    if (details.week_label) parts.push(`→ ${details.week_label}`);
    if (details.ticket_lines) parts.push(`(${Number(details.ticket_lines).toLocaleString()} lines)`);
    if (details.due_date) parts.push(`due ${details.due_date}`);
    if (details.from_position !== undefined && details.to_position !== undefined) {
      parts.push(`pos ${details.from_position} → ${details.to_position}`);
    }
    return parts.join(' ');
  }
  
  // Capacity changes
  if (details.week !== undefined && details.year !== undefined) {
    const parts: string[] = [`W${details.week}/${details.year}`];
    if (details.old_capacity !== undefined && details.new_capacity !== undefined) {
      parts.push(`${Number(details.old_capacity).toLocaleString()} → ${Number(details.new_capacity).toLocaleString()} lines`);
    }
    return parts.join(': ');
  }
  
  // Default capacity changes
  if (details.old_capacity !== undefined && details.new_capacity !== undefined) {
    return `${Number(details.old_capacity).toLocaleString()} → ${Number(details.new_capacity).toLocaleString()} lines`;
  }
  
  // Fallback: key=value pairs, but format nicely
  return Object.entries(details)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(', ');
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    // Security events
    login: 'bg-emerald-100 text-emerald-700',
    login_success: 'bg-emerald-100 text-emerald-700',
    logout: 'bg-slate-100 text-slate-700',
    force_logout: 'bg-orange-100 text-orange-700',
    session_invalidated_other_tab: 'bg-amber-100 text-amber-700',
    session_expired: 'bg-slate-100 text-slate-700',
    unauthorized_access: 'bg-red-100 text-red-700',
    // Ticket events
    ticket_scheduled: 'bg-blue-100 text-blue-700',
    ticket_unscheduled: 'bg-purple-100 text-purple-700',
    ticket_locked: 'bg-blue-100 text-blue-700',
    ticket_unlocked: 'bg-purple-100 text-purple-700',
    ticket_moved_to_backlog: 'bg-slate-100 text-slate-700',
    ticket_added_to_queue: 'bg-emerald-100 text-emerald-700',
    ticket_due_date_set: 'bg-blue-100 text-blue-700',
    ticket_inspected: 'bg-gray-100 text-gray-700',
    ticket_moved: 'bg-cyan-100 text-cyan-700',
    ticket_priority_changed: 'bg-cyan-100 text-cyan-700',
    ticket_mismatch_reset: 'bg-orange-100 text-orange-700',
    // System events
    capacity_changed: 'bg-amber-100 text-amber-700',
    capacity_week_changed: 'bg-amber-100 text-amber-700',
    capacity_default_changed: 'bg-amber-100 text-amber-700',
    reservation_unlocked: 'bg-emerald-100 text-emerald-700',
    reservation_locked: 'bg-red-100 text-red-700',
    nuclear_reset: 'bg-red-200 text-red-800',
  };
  
  // Create a more readable label
  const labels: Record<string, string> = {
    login_success: 'Login',
    logout: 'Logout',
    session_invalidated_other_tab: 'Session Ended (New Tab)',
    ticket_scheduled: 'Ticket Scheduled',
    ticket_unscheduled: 'Ticket Unscheduled',
    ticket_locked: 'Ticket Locked',
    ticket_unlocked: 'Ticket Unlocked',
    ticket_moved_to_backlog: 'Moved to Backlog',
    ticket_added_to_queue: 'Added to Queue',
    ticket_due_date_set: 'Due Date Set',
    ticket_inspected: 'Ticket Viewed',
    ticket_moved: 'Ticket Moved',
    ticket_priority_changed: 'Priority Changed',
    ticket_mismatch_reset: 'Mismatch Reset',
    capacity_week_changed: 'Week Capacity Changed',
    capacity_default_changed: 'Default Capacity Changed',
    reservation_unlocked: 'Reservation Unlocked',
    reservation_locked: 'Reservation Locked',
    force_logout: 'Force Logout',
    unauthorized_access: 'Unauthorized',
    nuclear_reset: '☢️ NUCLEAR RESET',
  };
  
  const label = labels[action] || action.replace(/_/g, ' ');
  
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${colors[action] || 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

export function AdminPortal({ onClose }: AdminPortalProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'activity'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Activity filters
  const [activitySearch, setActivitySearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/activity`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch activity');
      const data = await res.json();
      setActivity(data.activity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch activity');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchUsers(), fetchActivity()])
      .finally(() => setLoading(false));
  }, [fetchUsers, fetchActivity]);

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter activity by actor and date range
  const filteredActivity = activity.filter(item => {
    const matchesActor = !activitySearch || 
      item.user_email.toLowerCase().includes(activitySearch.toLowerCase()) ||
      item.action.toLowerCase().includes(activitySearch.toLowerCase());
    const matchesDateFrom = !dateFrom || 
      (item.created_at && new Date(item.created_at) >= new Date(dateFrom));
    const matchesDateTo = !dateTo || 
      (item.created_at && new Date(item.created_at) <= new Date(dateTo + 'T23:59:59'));
    return matchesActor && matchesDateFrom && matchesDateTo;
  });

  // Download activity as CSV
  const downloadCSV = () => {
    const headers = ['Date', 'Actor', 'Action', 'Details', 'IP Address'];
    const rows = filteredActivity.map(item => [
      formatDate(item.created_at),
      item.user_email,
      item.action.replace(/_/g, ' '),
      formatDetails(item.action, item.details) || '',
      item.ip_address || ''
    ]);
    
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="font-semibold text-slate-800">Admin</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-slate-200 flex gap-1">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Users ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'activity'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Activity Log
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm text-red-700">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              <span className="ml-3 text-sm text-slate-500">Loading...</span>
            </div>
          ) : activeTab === 'users' ? (
            <div>
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Users list */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">First Seen</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Last Login</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {user.picture ? (
                              <img
                                src={user.picture}
                                alt={user.name}
                                className="w-8 h-8 rounded-full"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-sm font-medium">
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <span className="text-sm font-medium text-slate-800">{user.name}</span>
                              <span className="block text-xs text-slate-500">{user.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {user.is_admin ? (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                              Admin
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                              User
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600" title={formatDate(user.created_at)}>
                            {formatRelativeTime(user.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600" title={formatDate(user.last_login)}>
                            {formatRelativeTime(user.last_login)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    No users found
                  </div>
                )}
              </div>
              
            </div>
          ) : (
            <div>
              {/* Activity filters */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* Search by actor */}
                <div className="relative flex-1 min-w-[200px]">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search by actor or action..."
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  />
                </div>
                
                {/* Date from */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  />
                </div>
                
                {/* Date to */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  />
                </div>
                
                {/* Download CSV */}
                <button
                  onClick={downloadCSV}
                  disabled={filteredActivity.length === 0}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV
                </button>
              </div>
              
              {/* Results count */}
              <p className="text-xs text-slate-500 mb-3">
                Showing {filteredActivity.length} of {activity.length} activities
              </p>

              {/* Activity log */}
              <div className="space-y-2">
                {filteredActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-xs font-medium flex-shrink-0">
                      {item.user_email.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800 truncate">
                          {item.user_email}
                        </span>
                        <ActionBadge action={item.action} />
                      </div>
                      {item.details && Object.keys(item.details).length > 0 && (
                        <p className="text-xs text-slate-600 mt-1">
                          {formatDetails(item.action, item.details)}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        {formatDate(item.created_at)}
                        {item.ip_address && ` · ${item.ip_address}`}
                      </p>
                    </div>
                  </div>
                ))}
                {filteredActivity.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    {activity.length === 0 ? 'No activity recorded yet' : 'No matching activities found'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
