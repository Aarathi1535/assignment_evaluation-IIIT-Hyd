'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Brain, UserPlus, ArrowLeft } from 'lucide-react';

export default function PersonalizedRegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'STUDENT' | 'PROFESSOR'>('STUDENT');
  const [skillLevel, setSkillLevel] = useState<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'>('INTERMEDIATE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/personalized/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role, skillLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      if (role === 'PROFESSOR') {
        router.push('/professor/personalized');
      } else {
        router.push('/student/personalized');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during registration');
    } finally {
      setLoading(false);
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
            <h1 className="text-2xl font-bold">Register Personalized Account</h1>
            <p className="text-xs text-neutral-400">Independent user database for Personalised Learning</p>
          </div>

          {error && (
            <div className="p-3 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rohan Sharma"
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rohan@iiit.ac.in"
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

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'STUDENT' | 'PROFESSOR')}
                className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="STUDENT">Student</option>
                <option value="PROFESSOR">Professor / Instructor</option>
              </select>
            </div>

            {role === 'STUDENT' && (
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Starting Skill Level</label>
                <select
                  value={skillLevel}
                  onChange={(e) => setSkillLevel(e.target.value as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED')}
                  className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="BEGINNER">Beginner (Foundations &amp; Concepts)</option>
                  <option value="INTERMEDIATE">Intermediate (Core Problem Solving)</option>
                  <option value="ADVANCED">Advanced (Rigorous &amp; Complex)</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer text-sm shadow-lg"
            >
              <UserPlus className="w-4 h-4" />
              <span>{loading ? 'Creating Account...' : 'Register'}</span>
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-800 text-center text-xs text-neutral-400">
            Already have an account?{' '}
            <Link href="/personalized/login" className="text-purple-400 hover:underline font-semibold">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
