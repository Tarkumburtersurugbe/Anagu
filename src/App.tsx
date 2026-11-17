import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  Blocks,
  Compass,
  FilePlus2,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Scale,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AuthPortal } from './components/AuthPortal';
import { DashboardView } from './components/DashboardView';
import { RegistrationView } from './components/RegistrationView';
import { GisVerificationView } from './components/GisVerificationView';
import { OracleVerificationView } from './components/OracleVerificationView';
import { RegistrarTitlesView } from './components/RegistrarTitlesView';
import { RevocationView } from './components/RevocationView';
import { LedgerAuditView } from './components/LedgerAuditView';
import { MqttSyncView } from './components/MqttSyncView';
import { ReportsAnalyticsView } from './components/ReportsAnalyticsView';
import { AdminSettingsView } from './components/AdminSettingsView';
import {
  apiRequest,
  clearStoredSession,
  getStoredToken,
  getStoredUser,
} from './lib/api';
import {
  ROLE_LABELS,
  type AuthUser,
  type LandApplication,
  type LandParcel,
  type NotificationItem,
} from './types/anagu';

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'registration', label: 'Land Registration', icon: FilePlus2 },
  { id: 'gis', label: 'GIS Verification', icon: Compass },
  { id: 'oracle', label: 'Ownership Oracle', icon: Scale },
  { id: 'titles', label: 'Registrar & NFT Titles', icon: ShieldCheck },
  { id: 'revocation', label: 'Section 28 Revocation', icon: Gavel },
  { id: 'ledger', label: 'Blockchain & Audit', icon: Blocks },
  { id: 'mqtt', label: 'MQTT & Offline Sync', icon: Radio },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
  { id: 'admin', label: 'Profile & Admin', icon: Settings },
];

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser<AuthUser>());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const [summary, setSummary] = useState<any>(null);
  const [applications, setApplications] = useState<LandApplication[]>([]);
  const [parcels, setParcels] = useState<LandParcel[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    if (!token) return;
    try {
      const [sumRes, appRes, pclRes, ntfRes] = await Promise.all([
        apiRequest('/api/dashboard/summary'),
        apiRequest<{ applications: LandApplication[] }>('/api/applications'),
        apiRequest<{ parcels: LandParcel[] }>('/api/parcels'),
        apiRequest<{ notifications: NotificationItem[] }>('/api/notifications'),
      ]);
      setSummary(sumRes);
      setApplications(appRes.applications);
      setParcels(pclRes.parcels);
      setNotifications(ntfRes.notifications);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('401') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('sign in')) {
        clearStoredSession();
        setToken(null);
        setUser(null);
      }
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadWorkspaceData();
  }, [token, loadWorkspaceData]);

  // Real-time MQTT EventSource subscription
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/mqtt/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('mqtt', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        notify(`MQTT [${parsed.topic}]: event received (${parsed.latencyMs} ms)`);
        loadWorkspaceData();
      } catch {
        // Ignore malformed frame
      }
    });
    return () => {
      es.close();
    };
  }, [token, loadWorkspaceData, notify]);

  async function markNotificationRead(id: string) {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    } catch {
      // Ignore
    }
  }

  function handleLogout() {
    clearStoredSession();
    setToken(null);
    setUser(null);
    setSummary(null);
    setActiveTab('dashboard');
  }

  if (!token || !user) {
    return (
      <AuthPortal
        onAuthenticated={(newToken, newUser) => {
          setToken(newToken);
          setUser(newUser);
        }}
      />
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200 lg:flex">
        <div className="flex h-16 items-center border-b border-slate-800 px-6">
          <span className="font-display text-lg font-bold tracking-tight text-white">ANAGU</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-xs">
          <div className="font-semibold text-white truncate">{user.fullName}</div>
          <div className="mt-0.5 text-slate-400 truncate">{ROLE_LABELS[user.role]}</div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 flex w-72 flex-col bg-slate-900 text-slate-200">
            <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
              <span className="font-display text-lg font-bold text-white">ANAGU</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium ${
                      active ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-800 p-4">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-semibold text-slate-900">ANAGU</span>
              <span>/</span>
              <span className="truncate font-medium text-slate-700">{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Bell className="h-4 w-4 text-slate-600" />
                <span className="hidden sm:inline">Notifications</span>
                {unreadCount > 0 && (
                  <span className="font-mono font-bold text-emerald-700 tabular-nums">({unreadCount})</span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg z-40">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2 text-xs font-bold text-slate-900">
                    <span>MQTT Notification Centre</span>
                    <button type="button" onClick={() => setNotifOpen(false)} className="text-slate-400 hover:text-slate-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">No notifications yet.</p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => markNotificationRead(n.id)}
                          className={`cursor-pointer rounded-lg border p-2.5 text-xs transition-colors ${
                            n.is_read
                              ? 'border-slate-100 bg-white text-slate-600'
                              : 'border-emerald-200 bg-emerald-50/50 text-slate-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 font-semibold">
                            <span>{n.title}</span>
                            <span className="text-[10px] font-normal text-slate-400">{n.category}</span>
                          </div>
                          <p className="mt-1 text-[11px] leading-snug">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 sm:inline-flex whitespace-nowrap"
            >
              <span>{ROLE_LABELS[user.role]}</span>
            </button>
          </div>
        </header>

        {/* Global Toast Feedback */}
        {toast && (
          <div className="no-print fixed right-4 bottom-4 z-50 max-w-md rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg transition-all sm:right-6 sm:bottom-6 bg-white border-slate-200 text-slate-900">
            <div className="flex items-center justify-between gap-3">
              <span className={toast.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}>
                {toast.message}
              </span>
              <button type="button" onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              user={user}
              summary={summary}
              parcels={parcels}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'registration' && (
            <RegistrationView
              user={user}
              applications={applications}
              parcels={parcels}
              onRefresh={loadWorkspaceData}
              onNotify={notify}
            />
          )}
          {activeTab === 'gis' && (
            <GisVerificationView
              user={user}
              applications={applications}
              parcels={parcels}
              onRefresh={loadWorkspaceData}
              onNotify={notify}
            />
          )}
          {activeTab === 'oracle' && (
            <OracleVerificationView
              user={user}
              applications={applications}
              onRefresh={loadWorkspaceData}
              onNotify={notify}
            />
          )}
          {activeTab === 'titles' && (
            <RegistrarTitlesView
              user={user}
              applications={applications}
              onRefresh={loadWorkspaceData}
              onNotify={notify}
            />
          )}
          {activeTab === 'revocation' && (
            <RevocationView
              user={user}
              onRefresh={loadWorkspaceData}
              onNotify={notify}
            />
          )}
          {activeTab === 'ledger' && <LedgerAuditView user={user} onNotify={notify} />}
          {activeTab === 'mqtt' && <MqttSyncView onRefresh={loadWorkspaceData} onNotify={notify} />}
          {activeTab === 'reports' && <ReportsAnalyticsView onNotify={notify} />}
          {activeTab === 'admin' && <AdminSettingsView user={user} onNotify={notify} />}
        </main>
      </div>
    </div>
  );
}
