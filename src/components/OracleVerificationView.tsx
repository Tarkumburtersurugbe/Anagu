import { useEffect, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Scale, Users } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthUser, LandApplication } from '../types/anagu';

interface OracleVerificationViewProps {
  user: AuthUser;
  applications: LandApplication[];
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function OracleVerificationView({
  user,
  applications,
  onRefresh,
  onNotify,
}: OracleVerificationViewProps) {
  const [institutionalRecords, setInstitutionalRecords] = useState<Array<Record<string, unknown>>>([]);
  const [communityAttestations, setCommunityAttestations] = useState<Array<Record<string, unknown>>>([]);
  const [verifications, setVerifications] = useState<Array<Record<string, unknown>>>([]);
  const [communityLeader, setCommunityLeader] = useState('Chief Musa Garki (District Head)');
  const [communityName, setCommunityName] = useState('FCT Indigenous Land Council');
  const [communityConfirmed, setCommunityConfirmed] = useState(true);
  const [institutionalOverride, setInstitutionalOverride] = useState(false);
  const [legalReviewNotes, setLegalReviewNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadOracleData() {
    try {
      const res = await apiRequest<{
        institutionalRecords: Array<Record<string, unknown>>;
        communityAttestations: Array<Record<string, unknown>>;
        verifications: Array<Record<string, unknown>>;
      }>('/api/oracle/records');
      setInstitutionalRecords(res.institutionalRecords);
      setCommunityAttestations(res.communityAttestations);
      setVerifications(res.verifications);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load Oracle records', 'error');
    }
  }

  useEffect(() => {
    loadOracleData();
  }, []);

  const oracleQueue = applications.filter(
    (a) =>
      a.status === 'Ownership verification pending' ||
      a.status === 'GIS verification pending' ||
      a.status === 'Under review' ||
      a.status === 'Legal review'
  );

  async function runOracleCheck(app: LandApplication) {
    setBusyId(app.id);
    try {
      const res = await apiRequest<{
        verification: { outcome: string; institutionalStatus: string; communityStatus: string };
      }>(`/api/oracle/verify/${app.id}`, {
        method: 'POST',
        body: JSON.stringify({
          institutionalMatchOverride: institutionalOverride,
          communityConfirmed,
          communityLeader,
          communityName,
          legalReviewNotes,
        }),
      });
      onNotify(`Oracle outcome for ${app.application_ref}: ${res.verification.outcome}`);
      setLegalReviewNotes('');
      await loadOracleData();
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Oracle verification rejected by backend', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">Ownership Verification Oracle</h1>
            <p className="text-xs text-slate-500">
              Cross-checks submitted ownership claims and document SHA-256 hashes against authorised AGIS / State Land
              Registries and Traditional Community Council attestations.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Scale className="h-4 w-4 text-emerald-700" />
            Statutory Rule: Community attestation alone does not establish legal ownership
          </span>
        </div>
      </div>

      {/* Oracle Execution Workbench */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <h2 className="font-display text-sm font-bold text-slate-900">Applications for Oracle Verification</h2>
          <p className="mt-1 text-xs text-slate-500">
            Authorised roles ({user.role === 'land_admin' || user.role === 'registrar' || user.role === 'sys_admin' ? 'Your role is authorised' : 'Land Admin / Registrar required on backend'}).
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Community Council Name</label>
              <input
                type="text"
                value={communityName}
                onChange={(e) => setCommunityName(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Community Leader / Witness</label>
              <input
                type="text"
                value={communityLeader}
                onChange={(e) => setCommunityLeader(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Legal / Administrative Notes</label>
              <input
                type="text"
                value={legalReviewNotes}
                onChange={(e) => setLegalReviewNotes(e.target.value)}
                placeholder="Record institutional deed book ref or legal observations..."
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={communityConfirmed}
                onChange={(e) => setCommunityConfirmed(e.target.checked)}
                className="rounded border-slate-300"
              />
              Community council confirms possession
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={institutionalOverride}
                onChange={(e) => setInstitutionalOverride(e.target.checked)}
                className="rounded border-slate-300"
              />
              Manual institutional clearance override
            </label>
          </div>

          <div className="mt-4 space-y-3">
            {oracleQueue.length === 0 ? (
              <p className="text-xs text-slate-500">No applications pending ownership verification.</p>
            ) : (
              oracleQueue.map((app) => (
                <div key={app.id} className="rounded-lg border border-slate-200 p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{app.application_ref}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-semibold text-slate-800">{app.applicant_name}</span>
                    </div>
                    <span className="font-semibold text-amber-700">{app.status}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    {app.land_location} ({app.state_name} / {app.lga_name}) · {app.documents?.length || 0} attached doc(s)
                  </div>
                  {app.oracle_outcome && (
                    <div className="mt-2 text-slate-700">
                      Previous Oracle Outcome: <strong>{app.oracle_outcome}</strong> ({app.institutional_status} /{' '}
                      {app.community_status})
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={busyId === app.id}
                      onClick={() => runOracleCheck(app)}
                      className="rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {busyId === app.id ? 'Checking Oracle...' : 'Run Ownership Verification Oracle'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Institutional & Community Reference Ledgers */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
              <Building2 className="h-4 w-4 text-emerald-700" />
              Authorised Institutional Land Records
            </h2>
            <div className="mt-3 divide-y divide-slate-100 text-xs">
              {institutionalRecords.map((rec) => (
                <div key={String(rec.id)} className="py-2.5">
                  <div className="flex items-center justify-between font-mono font-semibold text-slate-900">
                    <span>{String(rec.record_ref)}</span>
                    <span className={rec.encumbrance_status === 'Clear' ? 'text-emerald-700' : 'text-amber-700'}>
                      {String(rec.encumbrance_status)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-slate-700">
                    {String(rec.registered_owner_name)} · {String(rec.title_instrument)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {String(rec.verified_source)} ({String(rec.state_name)})
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
              <Users className="h-4 w-4 text-emerald-700" />
              Community Council Attestations
            </h2>
            <div className="mt-3 divide-y divide-slate-100 text-xs">
              {communityAttestations.map((c) => (
                <div key={String(c.id)} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{String(c.community_name)}</span>
                    <span className="font-medium text-emerald-700">{String(c.attestation_status)}</span>
                  </div>
                  <div className="mt-0.5 text-slate-600">
                    Witness: {String(c.council_leader_name)} · Claimant: {String(c.claimant_name)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Verification History */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-display text-sm font-bold text-slate-900">Verification Audit History</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Application</th>
                <th className="py-2 pr-3 font-semibold">Applicant</th>
                <th className="py-2 pr-3 font-semibold">Outcome</th>
                <th className="py-2 pr-3 font-semibold">Institutional</th>
                <th className="py-2 pr-3 font-semibold">Community</th>
                <th className="py-2 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {verifications.map((v) => (
                <tr key={String(v.id)}>
                  <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">{String(v.application_ref)}</td>
                  <td className="py-2.5 pr-3 text-slate-800">{String(v.applicant_name)}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        v.outcome === 'Successfully verified'
                          ? 'text-emerald-700'
                          : v.outcome === 'Ownership information conflict'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {v.outcome === 'Successfully verified' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {String(v.outcome)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-700">{String(v.institutional_status)}</td>
                  <td className="py-2.5 pr-3 text-slate-700">{String(v.community_status)}</td>
                  <td className="py-2.5 text-slate-500">{String(v.conflict_details || v.legal_review_notes || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
