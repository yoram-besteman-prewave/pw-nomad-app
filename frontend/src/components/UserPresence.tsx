import { useState, useRef, useEffect } from 'react';

interface User {
  email: string;
  name: string;
  picture: string;
}

interface UserPresenceProps {
  currentUser: User;
  otherUsers: User[];
  onLogout: () => void;
}

export function UserPresence({ currentUser, otherUsers, onLogout }: UserPresenceProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  // Generate consistent color from email
  const getAvatarColor = (email: string) => {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500',
      'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500',
    ];
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div className="flex items-center gap-1">
      {/* Other users (small avatars) */}
      {otherUsers.slice(0, 5).map((user, idx) => (
        <div
          key={user.email}
          className="relative"
          style={{ marginLeft: idx > 0 ? '-8px' : '0', zIndex: 10 - idx }}
          title={user.name}
        >
          {user.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              className="w-7 h-7 rounded-full border-2 border-white ring-1 ring-gray-200"
            />
          ) : (
            <div className={`w-7 h-7 rounded-full border-2 border-white ring-1 ring-gray-200 flex items-center justify-center text-[10px] font-medium text-white ${getAvatarColor(user.email)}`}>
              {getInitials(user.name)}
            </div>
          )}
          {/* Online indicator */}
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
        </div>
      ))}

      {/* Show +N if more users */}
      {otherUsers.length > 5 && (
        <div 
          className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600 border-2 border-white"
          style={{ marginLeft: '-8px', zIndex: 4 }}
        >
          +{otherUsers.length - 5}
        </div>
      )}

      {/* Separator */}
      {otherUsers.length > 0 && (
        <div className="w-px h-6 bg-gray-200 mx-1" />
      )}

      {/* Current user (with dropdown) */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          {currentUser.picture ? (
            <img
              src={currentUser.picture}
              alt={currentUser.name}
              className="w-8 h-8 rounded-full border-2 border-white ring-1 ring-gray-200"
            />
          ) : (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white ${getAvatarColor(currentUser.email)}`}>
              {getInitials(currentUser.name)}
            </div>
          )}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
            {/* User info */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {currentUser.picture ? (
                  <img
                    src={currentUser.picture}
                    alt={currentUser.name}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white ${getAvatarColor(currentUser.email)}`}>
                    {getInitials(currentUser.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{currentUser.name}</p>
                  <p className="text-xs text-gray-500 truncate">{currentUser.email}</p>
                </div>
              </div>
            </div>

            {/* Online users section */}
            {otherUsers.length > 0 && (
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Online Now ({otherUsers.length + 1})
                </p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {otherUsers.map(user => (
                    <div key={user.email} className="flex items-center gap-2">
                      {user.picture ? (
                        <img src={user.picture} alt={user.name} className="w-6 h-6 rounded-full" />
                      ) : (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-medium text-white ${getAvatarColor(user.email)}`}>
                          {getInitials(user.name)}
                        </div>
                      )}
                      <span className="text-sm text-gray-700 truncate">{user.name}</span>
                      <span className="w-2 h-2 rounded-full bg-green-500 ml-auto flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sign out button */}
            <div className="px-2 py-1">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

