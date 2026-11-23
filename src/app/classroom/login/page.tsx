'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MonitorPlay, LogIn, ArrowLeft, AlertCircle, CheckCircle2, Send } from 'lucide-react';

export default function ClassroomLoginPage() {
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
      const res = await fetch('/api/classroom/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'CLASSROOM_ACCESS_DENIED') {
          setAccessDenied(true);
          setRequestStatus(data.requestStatus || 'NONE');
          throw new Error(data.message || 'Access to Classroom Activity has not been granted by administrator.');
        }
        throw new Error(data.message || 'Login failed');
      }

      router.push('/professor/classroom');
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
      const res = await fetch('/api/classroom/access-request', {
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
          href="/classroom"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Classroom Portal</span>
        </Link>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <MonitorPlay className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold">Classroom Login</h1>
            <p className="text-xs text-neutral-400">Faculty access for live Classroom Activity</p>
          </div>

          {error && (
            <div className="p-3.5 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {accessDenied && (
            <div className="p-4 bg-amber-950/60 border border-amber-800 rounded-2xl text-xs space-y-3">
              <div className="text-amber-200 font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Classroom Access is on Request Only</span>
              </div>
              <p className="text-neutral-300 leading-relaxed">
                {requestStatus === 'REQUESTED'
                  ? 'Your access request has already been submitted and is currently pending administrator review.'
                  : 'You do not have active classroom activity permissions. Click below to submit an access request to the administrator.'}
              </p>
              {requestStatus !== 'REQUESTED' && (
                <button
                  type="button"
                  onClick={handleRequestAccess}
                  disabled={requestLoading}
                  className="w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{requestLoading ? 'Submitting Request...' : 'Request Access from Admin'}</span>
                </button>
              )}
            </div>
          )}

          {requestMessage && (
            <div className="p-3.5 bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{requestMessage}</span>
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
                placeholder="professor@iiit.ac.in"
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500"
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
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-teal-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer text-sm shadow-lg"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-800 text-center text-xs text-neutral-500">
            IIIT Hyderabad &bull; Classroom Activity Management
          </div>
        </div>
      </div>
    </div>
  );
}
