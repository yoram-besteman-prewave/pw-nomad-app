import { useState, useEffect, useCallback, useRef } from 'react';

interface User {
  email: string;
  name: string;
  picture: string;
  is_admin?: boolean;
}

interface SessionInfo {
  expires_in_seconds: number;
  should_warn: boolean;
  warning_threshold_seconds: number;
}

interface AuthState {
  authenticated: boolean;
  user: User | null;
  session: SessionInfo | null;
  loading: boolean;
  error: string | null;
}

const API_BASE = '/api';
const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of inactivity before showing warning

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    user: null,
    session: null,
    loading: true,
    error: null,
  });
  
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const [isInactive, setIsInactive] = useState(false);

  // Track user activity
  useEffect(() => {
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
      setIsInactive(false);
    };

    // Events that indicate user activity
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));

    // Check inactivity every 30 seconds
    const inactivityCheck = setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivityRef.current;
      if (timeSinceActivity > INACTIVITY_THRESHOLD_MS) {
        setIsInactive(true);
      }
    }, 30000);

    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
      clearInterval(inactivityCheck);
    };
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });
      
      if (res.ok) {
        const data = await res.json();
        setState({
          authenticated: data.authenticated,
          user: data.user,
          session: data.session,
          loading: false,
          error: null,
        });
      } else {
        setState({
          authenticated: false,
          user: null,
          session: null,
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to check authentication',
      }));
    }
  }, []);

  const login = useCallback(() => {
    window.location.href = `${API_BASE}/auth/login`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      setState({
        authenticated: false,
        user: null,
        session: null,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, []);

  const extendSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/extend`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({
          ...prev,
          session: prev.session ? {
            ...prev.session,
            expires_in_seconds: data.expires_in_seconds,
            should_warn: false,
          } : null,
        }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to extend session:', err);
      return false;
    }
  }, []);

  // Check auth on mount and set up interval
  useEffect(() => {
    checkAuth();
    
    // Check every 30 seconds
    checkIntervalRef.current = setInterval(checkAuth, 30000);
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkAuth]);

  // Check for URL error params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    
    if (error) {
      let message = 'Authentication failed';
      switch (error) {
        case 'invalid_domain':
          message = 'Only @prewave.ai accounts are allowed';
          break;
        case 'auth_denied':
          message = 'Authentication was denied';
          break;
        case 'auth_failed':
          message = 'Authentication failed. Please try again.';
          break;
        case 'no_email':
          message = 'No email found in authentication response. Check Okta attribute configuration.';
          break;
        case 'Okta SSO not configured':
          message = 'Okta SSO is not configured. Set OKTA_SSO_URL environment variable.';
          break;
        case 'No SAML assertion found':
          message = 'Invalid response from Okta. Please try again.';
          break;
        default:
          // Handle URL-encoded error messages from Okta
          message = decodeURIComponent(error);
      }
      
      setState(prev => ({ ...prev, error: message }));
      
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Only show warning if user is inactive AND session is expiring
  const shouldShowWarning = isInactive && state.session?.should_warn;

  return {
    ...state,
    login,
    logout,
    extendSession,
    checkAuth,
    isInactive,
    shouldShowWarning,
    resetActivity: () => {
      lastActivityRef.current = Date.now();
      setIsInactive(false);
    },
  };
}

