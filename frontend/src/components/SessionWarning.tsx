import { useState, useEffect } from 'react';

interface SessionWarningProps {
  expiresInSeconds: number;
  onExtend: () => Promise<boolean>;
  onExpired: () => void;
}

export function SessionWarning({ expiresInSeconds, onExtend, onExpired }: SessionWarningProps) {
  const [timeLeft, setTimeLeft] = useState(expiresInSeconds);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    setTimeLeft(expiresInSeconds);
  }, [expiresInSeconds]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [onExpired]);

  const handleExtend = async () => {
    setExtending(true);
    await onExtend();
    setExtending(false);
    // Dialog will close automatically when session is extended (parent removes warning state)
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Full-screen backdrop */}
      <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" />
      
      {/* Warning card */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Progress bar at top */}
        <div className="h-1 bg-gray-200">
          <div 
            className="h-full bg-amber-500 transition-all duration-1000"
            style={{ width: `${(timeLeft / 300) * 100}%` }}
          />
        </div>

        <div className="p-8 text-center">
          {/* Warning icon */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 mb-6">
            <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Session Expiring Soon
          </h2>
          
          {/* Timer */}
          <div className="mb-4">
            <span className="text-5xl font-mono font-bold text-amber-600">
              {formatTime(timeLeft)}
            </span>
          </div>

          {/* Message */}
          <p className="text-gray-600 mb-8 max-w-sm mx-auto">
            Your session is about to expire due to inactivity. 
            Click below to stay signed in.
          </p>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleExtend}
              disabled={extending}
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {extending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Extending...
                </span>
              ) : (
                'Stay Signed In'
              )}
            </button>
          </div>

          <p className="mt-6 text-xs text-gray-400">
            Session will be extended by 30 minutes
          </p>
        </div>
      </div>
    </div>
  );
}

