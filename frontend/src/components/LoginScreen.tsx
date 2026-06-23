interface LoginScreenProps {
  onLogin: () => void;
  error?: string | null;
}

// NoMAD compass logo - minimalist design
function NoMADLogo({ className = "w-20 h-20" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" fill="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          {/* Compass ring */}
        <circle cx="100" cy="100" r="60" fill="none"/>
        {/* Cardinal ticks */}
        <path d="M100 40 L100 55 M100 160 L100 145 M160 100 L145 100 M40 100 L55 100" strokeWidth="4"/>
          {/* North needle (filled) */}
        <path d="M100 60 L118 100 L82 100 Z" stroke="none"/>
          {/* South needle (outline) */}
        <path d="M82 100 L100 140 L118 100" fill="none" strokeWidth="3"/>
        {/* Center dot */}
        <circle cx="100" cy="100" r="6" fill="currentColor" stroke="none"/>
      </g>
    </svg>
  );
}

// Okta logo
function OktaLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.389 0 0 5.389 0 12s5.389 12 12 12 12-5.389 12-12S18.611 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
    </svg>
  );
}

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      {/* Card container */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 w-full max-w-sm text-center">
        {/* Logo */}
        <div className="flex justify-center">
          <NoMADLogo className="w-20 h-20 text-slate-700" />
        </div>
        
        {/* Title */}
        <h1 className="mt-5 text-2xl font-semibold text-slate-800">
          NoMAD
        </h1>

        {/* Error message */}
        {error && (
          <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded text-left">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Login button */}
          <button
            onClick={onLogin}
          className="mt-8 w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition-colors"
          >
          <OktaLogo className="w-4 h-4" />
          Continue with Okta
          </button>

        {/* Footer */}
        <p className="mt-8 text-xs text-gray-400">
          v0.2.0
          </p>
      </div>
    </div>
  );
}
