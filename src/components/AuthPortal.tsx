import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, Lock, Mail, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { apiRequest, setStoredSession } from '../lib/api';
import { ROLE_LABELS, type AuthUser, type UserRole } from '../types/anagu';

interface AuthPortalProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
}

const DEMO_ACCOUNTS: Array<{ role: UserRole; email: string; name: string }> = [
  { role: 'citizen', email: 'citizen@anagu.ng', name: 'Chukwuemeka Okafor' },
  { role: 'surveyor', email: 'surveyor@anagu.ng', name: 'Surv. Babatunde Adeyemi' },
  { role: 'registrar', email: 'registrar@anagu.ng', name: 'Barr. Ngozi Ezeani' },
  { role: 'land_admin', email: 'landadmin@anagu.ng', name: 'Ibrahim Musa Danjuma' },
  { role: 'governor', email: 'governor@anagu.ng', name: 'Hon. Dr. Kayode Ogunleye' },
  { role: 'sys_admin', email: 'sysadmin@anagu.ng', name: 'Timothy Ugbe' },
];

export function AuthPortal({ onAuthenticated }: AuthPortalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset' | 'verify'>('login');
  const [email, setEmail] = useState('citizen@anagu.ng');
  const [password, setPassword] = useState('Anagu@2026!');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ninLast4, setNinLast4] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Public title verification
  const [verifyQuery, setVerifyQuery] = useState('ANAGU-CT-2026-0001');
  const [verifiedTitle, setVerifiedTitle] = useState<Record<string, unknown> | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredSession(data.token, data.user);
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, phone, password, ninLast4 }),
      });
      setStoredSession(data.token, data.user);
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ message: string; resetTokenPreview?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (data.resetTokenPreview) {
        setResetToken(data.resetTokenPreview);
      }
      setInfo(`${data.message}${data.resetTokenPreview ? ` Token: ${data.resetTokenPreview}` : ''}`);
      setMode('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset request failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      setInfo(data.message);
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyTitle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifiedTitle(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ title: Record<string, unknown> }>(
        `/api/titles/verify/${encodeURIComponent(verifyQuery.trim())}`
      );
      setVerifiedTitle(data.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Title not found');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:grid lg:grid-cols-12">
      {/* Left institutional visual column */}
      <div className="relative flex flex-col justify-between bg-slate-900 text-white lg:col-span-6 xl:col-span-7">
        <div className="relative h-64 w-full overflow-hidden lg:absolute lg:inset-0 lg:h-full">
          <img
            src="/src/assets/images/anagu_civic_banner_1794917693317.jpg"
            alt="Nigerian urban cadastral district"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/75 to-slate-950/50" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-8 lg:p-12">
          <div className="flex items-center justify-between gap-4">
            <span className="font-display text-xl font-bold tracking-tight text-white">ANAGU</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode(mode === 'verify' ? 'login' : 'verify');
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 whitespace-nowrap"
            >
              <Search className="h-3.5 w-3.5" />
              {mode === 'verify' ? 'Back to Sign In' : 'Verify Public Land Title'}
            </button>
          </div>

          <div className="my-8 max-w-xl">
            <p className="mb-3 text-xs font-medium tracking-wide text-emerald-300">
              Federal & State Land Administration Infrastructure · Nigeria
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight text-white sm:text-4xl [text-wrap:balance]">
              Integrated Digital Land Administration &amp; Title Registration
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-200 sm:text-base">
              Unified cadastral GIS spatial verification, dual institutional &amp; community ownership oracle,
              permissioned Hyperledger Besu ERC-721 title issuance, Section 28 statutory revocation governance, and
              offline-resilient MQTT field synchronisation.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 border-t border-white/15 pt-6 sm:grid-cols-3">
              <div>
                <div className="font-mono text-xs text-slate-400">Spatial Engine</div>
                <div className="mt-1 text-sm font-semibold text-white">ST_IsValid &amp; ST_Intersects</div>
              </div>
              <div>
                <div className="font-mono text-xs text-slate-400">Title Ledger</div>
                <div className="mt-1 text-sm font-semibold text-white">Besu ERC-721 + QR Seal</div>
              </div>
              <div>
                <div className="font-mono text-xs text-slate-400">Statutory Law</div>
                <div className="mt-1 text-sm font-semibold text-white">Land Use Act Sec. 28</div>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            ANAGU Land Registry Portal · Privacy-preserving on-chain commitments (zero PII on ledger)
          </div>
        </div>
      </div>

      {/* Right authentication & role quick-access panel */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:col-span-6 xl:col-span-5">
        <div className="mx-auto w-full max-w-md">
          {/* Mode Tabs */}
          <div className="mb-6 flex flex-wrap gap-1 rounded-lg bg-slate-200/75 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('verify');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'verify' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Verify Title
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
              {info}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Sign in to ANAGU</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Access your role-based land administration workspace.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email address</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                    placeholder="name@anagu.ng"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                    }}
                    className="text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
              >
                {loading ? 'Authenticating...' : 'Sign In'}
                <ArrowRight className="h-4 w-4" />
              </button>

              <div className="border-t border-slate-200 pt-4">
                <div className="mb-2 text-xs font-semibold text-slate-700">
                  Development Role Accounts (Password: <span className="font-mono">Anagu@2026!</span>)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.role}
                      type="button"
                      onClick={() => {
                        setEmail(acc.email);
                        setPassword('Anagu@2026!');
                      }}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        email === acc.email
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight">{ROLE_LABELS[acc.role]}</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{acc.email}</div>
                    </button>
                  ))}
                </div>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Citizen Registration</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Create a landowner account to submit land applications and receive digital NFT titles.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Full Legal Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Chidinma Nwosu"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 803..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">NIN Last 4 Digits</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={ninLast4}
                    onChange={(e) => setNinLast4(e.target.value)}
                    placeholder="4821"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" />
                {loading ? 'Creating account...' : 'Create Citizen Account'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Forgot Password</h2>
                <p className="mt-1 text-xs text-slate-500">Request a time-limited reset token for your account.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Registered Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Issue Reset Token
                </button>
              </div>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Reset Password</h2>
                <p className="mt-1 text-xs text-slate-500">Enter your reset token and choose a new password.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Reset Token</label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 font-mono text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Confirm Password Reset
              </button>
            </form>
          )}

          {mode === 'verify' && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Public Title Verification</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Verify any ANAGU Digital Land Title ID, Parcel Reference, or ERC-721 Token ID.
                </p>
              </div>
              <form onSubmit={handleVerifyTitle} className="flex gap-2">
                <input
                  type="text"
                  required
                  value={verifyQuery}
                  onChange={(e) => setVerifyQuery(e.target.value)}
                  placeholder="ANAGU-CT-2026-0001 or NG-FCT-ABJ-2026-0001"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-emerald-600 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                >
                  Verify
                </button>
              </form>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                <button type="button" onClick={() => setVerifyQuery('ANAGU-CT-2026-0001')} className="underline hover:text-slate-900">
                  ANAGU-CT-2026-0001 (Active)
                </button>
                <span>·</span>
                <button type="button" onClick={() => setVerifyQuery('ANAGU-CT-2026-0003')} className="underline hover:text-slate-900">
                  ANAGU-CT-2026-0003 (Revoked)
                </button>
              </div>

              {verifiedTitle && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-mono font-bold text-slate-900">{String(verifiedTitle.title_number)}</span>
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        verifiedTitle.status === 'Active' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {String(verifiedTitle.status)}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Registered Holder</dt>
                      <dd className="font-semibold text-slate-900">{String(verifiedTitle.owner_name)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Parcel Ref</dt>
                      <dd className="font-mono text-slate-800">{String(verifiedTitle.parcel_ref)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Location</dt>
                      <dd className="text-right text-slate-800">{String(verifiedTitle.location_text)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">ERC-721 Token ID</dt>
                      <dd className="font-mono text-slate-900">#{String(verifiedTitle.token_id)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Besu Tx Hash</dt>
                      <dd className="max-w-[190px] truncate font-mono text-slate-700">{String(verifiedTitle.tx_hash)}</dd>
                    </div>
                    {verifiedTitle.status === 'Revoked' && (
                      <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-800">
                        Revoked under Section 28 ({String(verifiedTitle.statutory_ground)}) · Gazette {String(verifiedTitle.gazette_order_ref)}
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                Confidential personal identifiers (NIN/phone) are never published on-chain.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
