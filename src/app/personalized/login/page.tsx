'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Brain, LogIn, ArrowLeft, AlertCircle, CheckCircle2, Send } from 'lucide-react';

export default function PersonalizedLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAccessDenied(false);
    setRequestMessage(null);
    setLoading(true);

    try {
      const res = await fetch('/api/personalized/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'PERSONALIZED_ACCESS_DENIED') {
          setAccessDenied(true);
          setRequestStatus(data.requestStatus || 'NONE');
          throw new Error(data.message || 'Access to Personalised Learning has not been granted by administrator.');
        }
        throw new Error(data.message || 'Login failed');
      }

      if (data.data?.user?.role === 'PROFESSOR') {
        router.push('/professor/personalized');
      } else {
        router.push('/student/personalized');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccess = async () => {
    if (!email) return;
    setRequestLoading(true);
    setRequestMessage(null);

    try {
      const res = await fetch('/api/personalized/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to submit request');
      }
      setRequestMessage('Access request submitted successfully! Your administrator has been notified.');
      setRequestStatus('REQUESTED');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit access request');
    } finally {
      setRequestLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        <Link
          href="/personalized"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Personalised Learning Portal</span>
        </Link>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Brain className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold">Personalized Login</h1>
            <p className="text-xs text-neutral-400">Institutional &amp; Faculty access for Personalised Learning</p>
          </div>

          {error && (
            <div className="p-3.5 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {requestMessage && (
            <div className="p-3.5 bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs rounded-xl flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <div className="flex-1 leading-relaxed">{requestMessage}</div>
            </div>
          )}

          {accessDenied && (
            <div className="p-4 bg-amber-950/40 border border-amber-800/80 rounded-2xl space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200 leading-relaxed">
                  Faculty access to Personalised Learning is granted on request only. You can submit an access request to the administrator with one click:
                </div>
              </div>
              <button
                type="button"
                onClick={handleRequestAccess}
                disabled={requestLoading || requestStatus === 'REQUESTED'}
                className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {requestLoading
                    ? 'Submitting Request...'
                    : requestStatus === 'REQUESTED'
                    ? 'Request Pending Admin Review'
                    : 'Request Access from Admin'}
                </span>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prof@iiit.ac.in"
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer text-sm shadow-lg"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-800 text-center text-xs text-neutral-400">
            Faculty access is managed via the Administrator User Management portal.
          </div>
        </div>
      </div>
    </div>
  );
}
