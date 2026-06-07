import { useEffect, useRef, useState } from 'react';
import * as api from '../api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
        };
      };
    };
  }
}

interface GoogleLoginPageProps {
  clientId: string;
  allowedDomain: string;
  onSuccess: (email: string) => void;
}

export function GoogleLoginPage({ clientId, allowedDomain, onSuccess }: GoogleLoginPageProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;

    function initializeGoogle() {
      if (!window.google?.accounts?.id || !buttonRef.current) {
        return false;
      }
      initializedRef.current = true;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 300,
        text: 'signin_with',
      });
      return true;
    }

    if (initializeGoogle()) return;

    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      const interval = setInterval(() => {
        if (initializeGoogle()) clearInterval(interval);
      }, 100);
      const timeout = setTimeout(() => { clearInterval(interval); setScriptFailed(true); }, 10000);
      return () => { clearInterval(interval); clearTimeout(timeout); };
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const interval = setInterval(() => {
        if (initializeGoogle()) clearInterval(interval);
      }, 100);
      setTimeout(() => { clearInterval(interval); setScriptFailed(true); }, 10000);
    };
    script.onerror = () => setScriptFailed(true);
    document.head.appendChild(script);
  }, [clientId]);

  async function handleCredentialResponse(response: { credential: string }) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.googleLogin(response.credential);
      if (result.ok && result.email) {
        onSuccess(result.email);
      }
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
      setLoading(false);
    }
  }

  return (
    <div className="google-login-page">
      <div className="google-login-card">
        <div className="google-login-logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="4" fill="var(--accent)"></rect>
            <path d="M8 7h3l1 5-1 5H8l1-5-1-5z" fill="white" opacity="0.9"></path>
            <path d="M13 7h3l1 5-1 5h-3l1-5-1-5z" fill="white" opacity="0.6"></path>
          </svg>
          <span className="google-login-title">Artifact</span>
        </div>
        <p className="google-login-desc">
          Sign in with your <strong>@{allowedDomain}</strong> account to continue.
        </p>
        {scriptFailed ? (
          <p className="google-login-error">
            Failed to load Google Sign-In. Check your network connection and try refreshing.
          </p>
        ) : (
          <div ref={buttonRef} className="google-login-button" />
        )}
        {loading && <p className="google-login-status">Verifying...</p>}
        {error && <p className="google-login-error">{error}</p>}
      </div>
    </div>
  );
}
