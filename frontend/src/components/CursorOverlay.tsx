interface CursorOverlayProps {
  cursors: Map<string, { x: number; y: number }>;
  users: Array<{ email: string; name: string; picture: string }>;
}

export function CursorOverlay({ cursors, users }: CursorOverlayProps) {
  // Generate consistent color from email
  const getColor = (email: string) => {
    const colors = [
      '#3b82f6', '#10b981', '#8b5cf6', '#ec4899',
      '#6366f1', '#14b8a6', '#f97316', '#06b6d4',
    ];
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const getFirstName = (name: string) => {
    return name.split(' ')[0];
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-[99]" style={{ overflow: 'hidden' }}>
      {Array.from(cursors.entries()).map(([email, pos]) => {
        const user = users.find(u => u.email === email);
        if (!user || !pos) return null;

        const color = getColor(email);

        return (
          <div
            key={email}
            className="absolute transition-all duration-75 ease-out"
            style={{
              left: pos.x,
              top: pos.y,
              transform: 'translate(-2px, -2px)',
            }}
          >
            {/* Cursor arrow */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
            >
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>

            {/* Name label */}
            <div
              className="absolute left-5 top-4 px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap"
              style={{ backgroundColor: color }}
            >
              {getFirstName(user.name)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

