import { useEffect, useState } from 'react';
import { BarChart3, Download, Printer } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface AnalyticsPayload {
  applicationsByState: Array<{ state_name: string; count: number }>;
  applicationsByCategory: Array<{ ownership_category: string; count: number }>;
  gisOutcomes: Array<{ st_is_valid: number; st_intersects: number; approved: number; count: number }>;
  oracleOutcomes: Array<{ outcome: string; count: number }>;
  mqttMetrics: Array<{ delivery_status: string; count: number; avg_latency: number }>;
  storageComparison: {
    offChainMinioBytes: number;
    onChainCommitmentBytes: number;
    savingsPct: number;
  };
  securitySummary: {
    blockedUnauthorizedAttempts: number;
    blockchainTransactionsConfirmed: number;
  };
}

interface ReportsAnalyticsViewProps {
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ReportsAnalyticsView({ onNotify }: ReportsAnalyticsViewProps) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  useEffect(() => {
    apiRequest<AnalyticsPayload>('/api/reports/analytics')
      .then(setData)
      .catch((err) => onNotify(err.message, 'error'));
  }, []);

  async function handleExportCsv() {
    try {
      const csvText = await apiRequest<string>('/api/reports/export');
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'anagu-land-registry-report.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify('CSV report downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  }

  if (!data) {
    return <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900">Reports &amp; Registry Analytics</h1>
          <p className="text-xs text-slate-500">
            Live metrics computed from GIS verification, Ownership Oracle, Besu ledger, and MQTT telemetry.
          </p>
        </div>

        <div className="no-print flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5" />
            Export PDF / Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
            <BarChart3 className="h-4 w-4 text-emerald-700" />
            Applications by State
          </h2>
          <div className="mt-4 space-y-2.5 text-xs">
            {data.applicationsByState.map((row) => (
              <div key={row.state_name} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-medium text-slate-700">{row.state_name}</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">{row.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-display text-sm font-bold text-slate-900">Storage Overhead Comparison</h2>
          <p className="mt-1 text-xs text-slate-500">Off-chain MinIO documents vs. on-chain Besu commitments</p>
          <dl className="mt-4 space-y-2.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-600">Off-Chain Document Payload</dt>
              <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                {(data.storageComparison.offChainMinioBytes / 1024).toFixed(1)} KB
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">On-Chain Hash Commitments</dt>
              <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                {(data.storageComparison.onChainCommitmentBytes / 1024).toFixed(2)} KB
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2">
              <dt className="font-semibold text-slate-800">On-Chain Storage Reduction</dt>
              <dd className="font-mono font-bold text-emerald-700 tabular-nums">
                {data.storageComparison.savingsPct}%
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-display text-sm font-bold text-slate-900">MQTT Delivery &amp; Security Metrics</h2>
          <div className="mt-4 space-y-2.5 text-xs">
            {data.mqttMetrics.map((m) => (
              <div key={m.delivery_status} className="flex items-center justify-between">
                <span className="text-slate-600">MQTT {m.delivery_status}</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {m.count} msg · {Number(m.avg_latency || 0).toFixed(1)} ms avg
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="text-slate-600">Confirmed Besu Transactions</span>
              <span className="font-mono font-bold text-emerald-700 tabular-nums">
                {data.securitySummary.blockchainTransactionsConfirmed}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Blocked Unauthorised Attempts</span>
              <span className="font-mono font-bold text-red-700 tabular-nums">
                {data.securitySummary.blockedUnauthorizedAttempts}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-display text-sm font-bold text-slate-900">Land Ownership Categories</h2>
          <div className="mt-3 space-y-2 text-xs">
            {data.applicationsByCategory.map((c) => (
              <div key={c.ownership_category} className="flex justify-between border-b border-slate-100 py-1.5">
                <span className="text-slate-700">{c.ownership_category}</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-display text-sm font-bold text-slate-900">Oracle &amp; GIS Verification Summary</h2>
          <div className="mt-3 space-y-2 text-xs">
            {data.oracleOutcomes.map((o) => (
              <div key={o.outcome} className="flex justify-between border-b border-slate-100 py-1.5">
                <span className="text-slate-700">Oracle · {o.outcome}</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">{o.count}</span>
              </div>
            ))}
            {data.gisOutcomes.map((g, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-1.5">
                <span className="text-slate-700">
                  GIS · {g.approved ? 'Spatial Verified' : 'Spatial Flagged'}
                </span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">{g.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
