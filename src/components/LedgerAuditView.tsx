import { useEffect, useState } from 'react';
import { Blocks, Search, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthUser, BlockchainTransaction } from '../types/anagu';

interface LedgerAuditViewProps {
  user: AuthUser;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function LedgerAuditView({ user, onNotify }: LedgerAuditViewProps) {
  const [transactions, setTransactions] = useState<BlockchainTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'blockchain' | 'audit'>('blockchain');

  useEffect(() => {
    apiRequest<{ transactions: BlockchainTransaction[] }>('/api/blockchain/transactions')
      .then((res) => setTransactions(res.transactions))
      .catch((err) => onNotify(err.message, 'error'));

    if (['land_admin', 'sys_admin', 'registrar', 'governor'].includes(user.role)) {
      apiRequest<{ logs: Array<Record<string, unknown>> }>('/api/audit-logs')
        .then((res) => setAuditLogs(res.logs))
        .catch(() => {});
    }
  }, [user.role]);

  const filteredTx = transactions.filter(
    (t) =>
      !search ||
      t.parcel_ref?.toLowerCase().includes(search.toLowerCase()) ||
      t.tx_hash.toLowerCase().includes(search.toLowerCase()) ||
      t.event_name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAudit = auditLogs.filter(
    (a) =>
      !search ||
      String(a.action).toLowerCase().includes(search.toLowerCase()) ||
      String(a.target_id || '').toLowerCase().includes(search.toLowerCase()) ||
      String(a.actor_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900">
            Hyperledger Besu Ledger &amp; System Audit Trail
          </h1>
          <p className="text-xs text-slate-500">
            Traceable smart contract events (LandRegistry &amp; LandTitleNFT) and RBAC-enforced audit records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter parcel, hash, event..."
              className="rounded-lg border border-slate-300 py-1.5 pr-3 pl-8 text-xs focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab('blockchain')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                tab === 'blockchain' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Blockchain Transactions
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                tab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              System Audit Logs
            </button>
          </div>
        </div>
      </div>

      {tab === 'blockchain' ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-600">
            <Blocks className="h-4 w-4 text-emerald-700" />
            <span>
              Privacy Guarantee: Only salted identity commitments and Merkle document roots are recorded on-chain.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Block</th>
                  <th className="py-2.5 pr-3 font-semibold">Contract / Method</th>
                  <th className="py-2.5 pr-3 font-semibold">Event</th>
                  <th className="py-2.5 pr-3 font-semibold">Parcel Ref</th>
                  <th className="py-2.5 pr-3 font-semibold">Initiator</th>
                  <th className="py-2.5 pr-3 font-semibold">Transaction Hash</th>
                  <th className="py-2.5 text-right font-semibold">Gas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTx.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono font-semibold text-slate-900 tabular-nums">
                      #{tx.block_number}
                    </td>
                    <td className="py-3 pr-3 font-mono text-slate-700">
                      {tx.contract_name}.{tx.method_name}
                    </td>
                    <td className="py-3 pr-3 font-semibold text-emerald-700">{tx.event_name}</td>
                    <td className="py-3 pr-3 font-mono text-slate-800">{tx.parcel_ref}</td>
                    <td className="py-3 pr-3 text-slate-700">{tx.initiator_name || 'Registry'}</td>
                    <td className="py-3 pr-3 font-mono text-[11px] text-slate-500">{tx.tx_hash}</td>
                    <td className="py-3 text-right font-mono text-slate-600 tabular-nums">
                      {Number(tx.gas_used).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {auditLogs.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              Full system audit logs require Registrar, Land Admin, Governor, or System Admin privileges.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2.5 pr-3 font-semibold">Timestamp</th>
                    <th className="py-2.5 pr-3 font-semibold">Actor</th>
                    <th className="py-2.5 pr-3 font-semibold">Role</th>
                    <th className="py-2.5 pr-3 font-semibold">Action</th>
                    <th className="py-2.5 pr-3 font-semibold">Target</th>
                    <th className="py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAudit.map((log) => (
                    <tr key={String(log.id)} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(String(log.created_at)).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-slate-900">{String(log.actor_name || 'System')}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-600">{String(log.actor_role || '—')}</td>
                      <td className="py-2.5 pr-3 font-semibold text-slate-800">{String(log.action)}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-700">
                        {String(log.target_type)}:{String(log.target_id || '')}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-500">{String(log.details || '{}')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
