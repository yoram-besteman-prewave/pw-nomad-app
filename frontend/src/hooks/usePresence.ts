import { useState, useEffect, useCallback, useRef } from 'react';

interface UserPresence {
  email: string;
  name: string;
  picture: string;
  cursor?: { x: number; y: number } | null;
}

// WebSocket URL - uses same host, cookies are sent automatically
const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/presence`;
};

export function usePresence(
  isAuthenticated: boolean, 
  onSessionInvalidated?: (message: string) => void,
  onDataUpdated?: (changeType: string, details: Record<string, unknown>) => void
) {
  const [users, setUsers] = useState<UserPresence[]>([]);
  const [cursors, setCursors] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [connected, setConnected] = useState(false);
  const [sessionInvalidated, setSessionInvalidated] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const onSessionInvalidatedRef = useRef(onSessionInvalidated);
  const onDataUpdatedRef = useRef(onDataUpdated);
  
  // Keep callback ref up to date
  onSessionInvalidatedRef.current = onSessionInvalidated;
  onDataUpdatedRef.current = onDataUpdated;

  const connect = useCallback(() => {
    if (!isAuthenticated) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      console.log('Presence: Connecting to WebSocket...');
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Presence: WebSocket connected');
        setConnected(true);
        reconnectAttempts.current = 0;
        
        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'presence') {
            // Full presence update - list of active users
            setUsers(msg.users || []);
          } else if (msg.type === 'cursor') {
            // Cursor position update from another user
            setCursors(prev => {
              const next = new Map(prev);
              if (msg.cursor && msg.user?.email) {
                next.set(msg.user.email, msg.cursor);
              } else if (msg.user?.email) {
                next.delete(msg.user.email);
              }
              return next;
            });
          } else if (msg.type === 'user_left') {
            // User disconnected - remove their cursor
            if (msg.user?.email) {
              setCursors(prev => {
                const next = new Map(prev);
                next.delete(msg.user.email);
                return next;
              });
            }
          } else if (msg.type === 'session_invalidated') {
            // User signed in on another tab - this session is now invalid
            console.log('Session invalidated:', msg.message);
            setSessionInvalidated(true);
            if (onSessionInvalidatedRef.current) {
              onSessionInvalidatedRef.current(msg.message || 'You signed into a new tab and were signed out here.');
            }
            // Close the WebSocket - don't try to reconnect
            ws.close(1000, 'Session invalidated');
            reconnectAttempts.current = maxReconnectAttempts; // Prevent reconnect
          } else if (msg.type === 'data_updated') {
            // Data has changed - trigger refresh
            console.log('Data updated:', msg.change_type, msg.details);
            if (onDataUpdatedRef.current) {
              onDataUpdatedRef.current(msg.change_type, msg.details || {});
            }
          }
        } catch (e) {
          console.error('Presence: Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('Presence: WebSocket closed', event.code, event.reason);
        setConnected(false);
        wsRef.current = null;
        
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Reconnect if still authenticated and not too many attempts
        if (isAuthenticated && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`Presence: Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('Presence: WebSocket error:', error);
      };
    } catch (e) {
      console.error('Presence: Failed to create WebSocket:', e);
    }
  }, [isAuthenticated]);

  const disconnect = useCallback(() => {
    console.log('Presence: Disconnecting...');
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnecting');
      wsRef.current = null;
    }
    
    setConnected(false);
    reconnectAttempts.current = 0;
  }, []);

  const sendCursorPosition = useCallback((x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'cursor',
        cursor: { x, y },
      }));
    }
  }, []);

  // Connect when authenticated, disconnect when not
  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
      setUsers([]);
      setCursors(new Map());
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect]);

  // Track mouse position and send updates (throttled)
  useEffect(() => {
    if (!isAuthenticated || !connected) return;

    let lastSent = 0;
    const throttleMs = 50; // Max 20 updates per second

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSent > throttleMs) {
        sendCursorPosition(e.clientX, e.clientY);
        lastSent = now;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isAuthenticated, connected, sendCursorPosition]);

  return {
    users,
    cursors,
    connected,
    sessionInvalidated,
  };
}
