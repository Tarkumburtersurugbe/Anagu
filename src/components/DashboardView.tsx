import { ArrowUpRight, CheckCircle2, Clock, FileCheck, MapPin, ShieldAlert, Users, XCircle } from 'lucide-react';
import { LeafletMap } from './LeafletMap';
import { ROLE_LABELS, type AuthUser, type BlockchainTransaction, type LandParcel } from '../types/anagu';

interface DashboardSummary {
  kpis: {
    totalRegisteredParcels: number;
    totalLandowners: number;
    pendingApplications: number;
    approvedApplications: number;
    rejectedApplications: number;
    revokedTitles: number;
  };
  appStatusBreakdown: Array<{ status: string; count: number }>;
  verificationStats: Array<{ outcome: string; count: number }>;
  surveyStats: Array<{ approved: number; count: number }>;
  recentTransactions: BlockchainTransaction[];
  recentActivities: Array<{
    id: string;
    action: string;
    actor_name?: string;
    actor_role?: string;
    target_type: string;
    target_id?: string;
    created_at: string;
  }>;
}

interface DashboardViewProps {
  user: AuthUser;
  summary: DashboardSummary | null;
  parcels: LandParcel[];
  onNavigate: (tab: string) => void;
}

export function DashboardView({ user, summary, parcels, onNavigate }: DashboardViewProps) {
  if (!summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white p-4" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  const kpiItems = [
    { label: 'Registered Parcels', value: summary.kpis.totalRegisteredParcels, icon: MapPin, tone: 'text-emerald-700' },
    { label: 'Verified Landowners', value: summary.kpis.totalLandowners, icon: Users, tone: 'text-slate-900' },
    { label: 'Pending Applications', value: summary.kpis.pendingApplications, icon: Clock, tone: 'text-amber-700' },
    { label: 'Approved Applications', value: summary.kpis.approvedApplications, icon: CheckCircle2, tone: 'text-emerald-700' },
    { label: 'Rejected Applications', value: summary.kpis.rejectedApplications, icon: XCircle, tone: 'text-slate-700' },
    { label: 'Revoked Titles (Sec. 28)', value: summary.kpis.revokedTitles, icon: ShieldAlert, tone: 'text-red-700' },
  ];

  const maxStatusCount = Math.max(1, ...summary.appStatusBreakdown.map((s) => s.count));

  return (
    <div className="space-y-6">
      {/* Role Context Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Active Workspace · {ROLE_LABELS[user.role]}
          </p>
          <h1 className="mt-1 font-display text-xl font-bold text-slate-900">
            Welcome back, {user.fullName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('registration')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap"
          >
            New Land Application
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('gis')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            Open GIS Cadastral Map
          </button>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{item.label}</span>
                <Icon className={`h-4 w-4 ${item.tone}`} />
              </div>
              <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${item.tone}`}>
                {item.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* GIS Preview + Analytics Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Cadastral GIS Map Preview</h2>
              <p className="text-xs text-slate-500">Live Nigerian land parcel polygons and title states</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('gis')}
              className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap"
            >
              Inspect Spatial Workbench
            </button>
          </div>
          <LeafletMap parcels={parcels} heightClass="h-[340px]" />
        </div>

        <div className="flex flex-col justify-between gap-6 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Application Pipeline Breakdown</h2>
            <p className="text-xs text-slate-500">Current distribution across statutory stages</p>
            <div className="mt-4 space-y-3">
              {summary.appStatusBreakdown.map((item) => {
                const widthPct = Math.max(8, Math.round((item.count / maxStatusCount) * 100));
                return (
                  <div key={item.status}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{item.status}</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">{item.count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          item.status === 'Approved'
                            ? 'bg-emerald-600'
                            : item.status === 'Rejected'
                              ? 'bg-red-600'
                              : 'bg-slate-700'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold text-slate-800">Ownership Verification Oracle Outcomes</h3>
            <div className="mt-3 space-y-2">
              {summary.verificationStats.length === 0 ? (
                <p className="text-xs text-slate-500">No oracle verifications recorded yet.</p>
              ) : (
                summary.verificationStats.map((v) => (
                  <div key={v.outcome} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <FileCheck className="h-3.5 w-3.5 text-emerald-700" />
                      {v.outcome}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">{v.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Blockchain Transactions + Recent System Activities */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Recent Besu Blockchain Transactions</h2>
              <p className="text-xs text-slate-500">Immutable LandRegistry and ERC-721 events</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('ledger')}
              className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap"
            >
              View Ledger
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Block</th>
                  <th className="py-2 pr-3 font-semibold">Event</th>
                  <th className="py-2 pr-3 font-semibold">Parcel Ref</th>
                  <th className="py-2 pr-3 font-semibold">Tx Hash</th>
                  <th className="py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono text-slate-700 tabular-nums">#{tx.block_number}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">{tx.event_name}</td>
                    <td className="py-2.5 pr-3 font-mono text-slate-700">{tx.parcel_ref}</td>
                    <td className="py-2.5 pr-3 font-mono text-slate-500">{tx.tx_hash.slice(0, 14)}...</td>
                    <td className="py-2.5 text-right font-medium text-emerald-700">{tx.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5">
          <h2 className="font-display text-base font-bold text-slate-900">Recent System Activities</h2>
          <p className="text-xs text-slate-500">Backend-enforced RBAC &amp; operational events</p>
          <div className="mt-3 divide-y divide-slate-100">
            {summary.recentActivities.map((act) => (
              <div key={act.id} className="py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{act.action.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {new Date(act.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-500">
                  {act.actor_name || 'System'} · {act.target_type} {act.target_id || ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
