import { useEffect, useState } from 'react';
import { CheckCircle2, Play, Settings, Shield, UserCheck, XCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { ROLE_LABELS, type AuthUser, type TestRunSummary, type UserRole } from '../types/anagu';

interface AdminSettingsViewProps {
  user: AuthUser;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function AdminSettingsView({ user, onNotify }: AdminSettingsViewProps) {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [settings, setSettings] = useState<Array<{ key: string; value: string; description: string }>>([]);
  const [testSummary, setTestSummary] = useState<TestRunSummary | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<Record<string, unknown> | null>(null);

  // Personal Profile Editor
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone || '');

  async function loadAdminData() {
    if (user.role === 'sys_admin' || user.role === 'land_admin') {
      try {
        const sbRes = await apiRequest<{ supabase: Record<string, unknown> }>('/api/supabase/status');
        setSupabaseStatus(sbRes.supabase);
      } catch {
        // Ignore
      }
    }
    if (user.role === 'sys_admin') {
      try {
        const [uRes, sRes] = await Promise.all([
          apiRequest<{ users: Array<Record<string, unknown>> }>('/api/admin/users'),
          apiRequest<{ settings: Array<{ key: string; value: string; description: string }> }>('/api/admin/settings'),
        ]);
        setUsers(uRes.users);
        setSettings(sRes.settings);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Failed to load admin console', 'error');
      }
    }
  }

  useEffect(() => {
    loadAdminData();
  }, [user.role]);

  async function handleRoleChange(userId: string, roleCode: UserRole) {
    try {
      await apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleCode }),
      });
      onNotify('User role updated.');
      loadAdminData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  }

  async function handleUpdateSetting(key: string, value: string) {
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key, value }),
      });
      onNotify(`Setting '${key}' saved.`);
      loadAdminData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Setting update failed', 'error');
    }
  }

  async function handleRunTests() {
    setRunningTests(true);
    try {
      const res = await apiRequest<{ summary: TestRunSummary }>('/api/tests/run', { method: 'POST' });
      setTestSummary(res.summary);
      onNotify(`Verification suite completed: ${res.summary.passed}/${res.summary.total} assertions passed.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Test execution requires sys_admin role', 'error');
    } finally {
      setRunningTests(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone }),
      });
      onNotify('Your profile details have been updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Profile update failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* User Profile Card (available to all authenticated roles) */}
      <form onSubmit={handleSaveProfile} className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
              <UserCheck className="h-4 w-4 text-emerald-700" />
              Account Profile &amp; Session Credentials
            </h2>
            <p className="text-xs text-slate-500">
              Role: <strong>{ROLE_LABELS[user.role]}</strong> · Custodial Address:{' '}
              <span className="font-mono">{user.walletAddress}</span>
            </p>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            Save Profile
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Email Address</label>
            <input
              type="email"
              disabled
              value={user.email}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
        </div>
      </form>

      {user.role === 'sys_admin' && (
        <>
          {/* Live Automated Evaluation & Test Suite */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
                  <Shield className="h-4 w-4 text-emerald-700" />
                  Live System Evaluation &amp; Test Suite
                </h2>
                <p className="text-xs text-slate-500">
                  Executes real backend assertions across GIS, Besu Smart Contracts, Ownership Oracle, MQTT, and RBAC
                  Security.
                </p>
              </div>
              <button
                type="button"
                disabled={runningTests}
                onClick={handleRunTests}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {runningTests ? 'Running Verification Suite...' : 'Execute Verification Tests'}
              </button>
            </div>

            {testSummary && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                  <span>
                    Executed: <strong className="font-mono">{new Date(testSummary.executedAt).toLocaleTimeString()}</strong>
                  </span>
                  <span className="text-emerald-700">
                    Passed: <strong className="font-mono tabular-nums">{testSummary.passed}</strong>
                  </span>
                  <span className={testSummary.failed > 0 ? 'text-red-700' : 'text-slate-600'}>
                    Failed: <strong className="font-mono tabular-nums">{testSummary.failed}</strong>
                  </span>
                  <span>
                    Duration: <strong className="font-mono tabular-nums">{testSummary.totalDurationMs} ms</strong>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Suite</th>
                        <th className="py-2 pr-3 font-semibold">Test Case</th>
                        <th className="py-2 pr-3 font-semibold">Result</th>
                        <th className="py-2 pr-3 text-right font-semibold">Time</th>
                        <th className="py-2 font-semibold">Measured Output</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {testSummary.results.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-3 font-semibold text-slate-800">{r.suite}</td>
                          <td className="py-2 pr-3 text-slate-700">{r.name}</td>
                          <td className="py-2 pr-3">
                            {r.passed ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                PASS
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                                <XCircle className="h-3.5 w-3.5" />
                                FAIL
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-slate-600 tabular-nums">
                            {r.durationMs} ms
                          </td>
                          <td className="py-2 font-mono text-[11px] text-slate-600">{r.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Role Management */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-display text-base font-bold text-slate-900">User &amp; Role Access Control</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Name</th>
                    <th className="py-2 pr-3 font-semibold">Email</th>
                    <th className="py-2 pr-3 font-semibold">License / ID</th>
                    <th className="py-2 font-semibold">Assigned Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={String(u.id)}>
                      <td className="py-2.5 pr-3 font-medium text-slate-900">{String(u.full_name)}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-600">{String(u.email)}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-500">{String(u.license_no || 'Citizen')}</td>
                      <td className="py-2.5">
                        <select
                          value={String(u.role_code)}
                          onChange={(e) => handleRoleChange(String(u.id), e.target.value as UserRole)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                        >
                          {Object.entries(ROLE_LABELS).map(([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* System Settings */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
              <Settings className="h-4 w-4 text-emerald-700" />
              Registry &amp; Infrastructure Settings
            </h2>
            <div className="mt-3 divide-y divide-slate-100 text-xs">
              {settings.map((s) => (
                <div key={s.key} className="flex flex-col justify-between gap-2 py-2.5 sm:flex-row sm:items-center">
                  <div>
                    <div className="font-mono font-semibold text-slate-900">{s.key}</div>
                    <div className="text-slate-500">{s.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      defaultValue={s.value}
                      onBlur={(e) => {
                        if (e.target.value !== s.value) {
                          handleUpdateSetting(s.key, e.target.value);
                        }
                      }}
                      className="w-64 rounded border border-slate-300 px-2.5 py-1 font-mono text-[11px]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {supabaseStatus && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-display text-base font-bold text-slate-900">
                Supabase Infrastructure &amp; JWKS Verification
              </h2>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">Project Ref</dt>
                  <dd className="mt-1 font-mono font-semibold text-slate-900">
                    {String(supabaseStatus.projectRef || 'Not set')}
                  </dd>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">Publishable Key</dt>
                  <dd className={`mt-1 font-semibold ${supabaseStatus.publishableKeyValid ? 'text-emerald-700' : 'text-red-700'}`}>
                    {supabaseStatus.publishableKeyValid ? 'Valid Format Loaded' : 'Missing / Invalid'}
                  </dd>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">Server Secret Key</dt>
                  <dd className={`mt-1 font-semibold ${supabaseStatus.secretKeyValid ? 'text-emerald-700' : 'text-red-700'}`}>
                    {supabaseStatus.secretKeyValid ? 'Loaded Server-Side' : 'Missing / Invalid'}
                  </dd>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">JWKS Endpoint</dt>
                  <dd className={`mt-1 font-semibold ${supabaseStatus.jwksReachable ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {supabaseStatus.jwksReachable
                      ? `Reachable (${String(supabaseStatus.jwksKeyCount)} key)`
                      : String(supabaseStatus.error || 'Unreachable')}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  );
}
