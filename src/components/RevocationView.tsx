import React, { useEffect, useState } from 'react';
import { Gavel, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthUser, NftTitle } from '../types/anagu';

interface RevocationViewProps {
  user: AuthUser;
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function RevocationView({ user, onRefresh, onNotify }: RevocationViewProps) {
  const [titles, setTitles] = useState<NftTitle[]>([]);
  const [revocations, setRevocations] = useState<Array<Record<string, unknown>>>([]);
  const [selectedTitleId, setSelectedTitleId] = useState('');
  const [statutoryGround, setStatutoryGround] = useState<'Overriding public interest' | 'Breach of statutory conditions'>(
    'Overriding public interest'
  );
  const [gazetteOrderRef, setGazetteOrderRef] = useState('');
  const [legalJustification, setLegalJustification] = useState('');
  const [supportingDocRef, setSupportingDocRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    try {
      const [tRes, rRes] = await Promise.all([
        apiRequest<{ titles: NftTitle[] }>('/api/titles'),
        apiRequest<{ revocations: Array<Record<string, unknown>> }>('/api/revocations'),
      ]);
      const active = tRes.titles.filter((t) => t.status === 'Active');
      setTitles(active);
      if (active.length > 0 && !selectedTitleId) {
        setSelectedTitleId(active[0].id);
      }
      setRevocations(rRes.revocations);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load revocation data', 'error');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleRevoke(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTitleId || !gazetteOrderRef.trim() || !legalJustification.trim()) {
      onNotify('All statutory revocation fields and Gazette reference are required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ txHash: string }>('/api/revocations', {
        method: 'POST',
        body: JSON.stringify({
          titleId: selectedTitleId,
          statutoryGround,
          gazetteOrderRef,
          legalJustification,
          supportingDocRef,
        }),
      });
      onNotify(`Statutory revocation executed on Besu (${res.txHash.slice(0, 14)}...). Titleholder notified via MQTT.`);
      setGazetteOrderRef('');
      setLegalJustification('');
      setSupportingDocRef('');
      await loadData();
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Revocation blocked by backend RBAC', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              Statutory Land Title Revocation (Land Use Act Section 28)
            </h1>
            <p className="text-xs text-slate-500">
              Strictly restricted to the Governor-Authorised role. Ordinary ownership disputes must not be processed as
              statutory revocations.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <Gavel className="h-4 w-4" />
            {user.role === 'governor'
              ? 'Governor Authority Active'
              : 'Restricted: Backend requires governor role'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleRevoke}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5"
        >
          <h2 className="font-display text-sm font-bold text-slate-900">Execute Section 28 Revocation</h2>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Active Digital Land Title</label>
            <select
              value={selectedTitleId}
              onChange={(e) => setSelectedTitleId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              {titles.length === 0 ? (
                <option value="">No active titles available</option>
              ) : (
                titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title_number} — {t.owner_name} ({t.parcel_ref})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Section 28 Statutory Ground
            </label>
            <select
              value={statutoryGround}
              onChange={(e) =>
                setStatutoryGround(
                  e.target.value as 'Overriding public interest' | 'Breach of statutory conditions'
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              <option value="Overriding public interest">1. Overriding public interest</option>
              <option value="Breach of statutory conditions">2. Breach of statutory conditions</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Official Gazette / Revocation Order Reference
            </label>
            <input
              type="text"
              required
              value={gazetteOrderRef}
              onChange={(e) => setGazetteOrderRef(e.target.value)}
              placeholder="e.g. FCT-GAZ-2026-S28-19"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Supporting Instrument / Notice Document Ref
            </label>
            <input
              type="text"
              value={supportingDocRef}
              onChange={(e) => setSupportingDocRef(e.target.value)}
              placeholder="Signed Governor Notice & Compensation Schedule Ref"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Legal Grounds &amp; Justification</label>
            <textarea
              rows={3}
              required
              value={legalJustification}
              onChange={(e) => setLegalJustification(e.target.value)}
              placeholder="Cite statutory purpose under Section 28 of the Nigerian Land Use Act..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || titles.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            <ShieldAlert className="h-4 w-4" />
            {submitting ? 'Recording Revocation on Besu...' : 'Execute Authorised Statutory Revocation'}
          </button>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <h2 className="font-display text-sm font-bold text-slate-900">Statutory Revocation Audit History</h2>
          <p className="mt-1 text-xs text-slate-500">
            Revoked titles are permanently locked on-chain against transfers and flagged in red on the GIS cadastral map.
          </p>

          <div className="mt-4 space-y-3">
            {revocations.length === 0 ? (
              <p className="text-xs text-slate-500">No statutory revocations recorded.</p>
            ) : (
              revocations.map((rev) => (
                <div key={String(rev.id)} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-900">
                      {String(rev.title_number)} · Token #{String(rev.token_id)}
                    </span>
                    <span className="font-semibold text-red-700">{String(rev.statutory_ground)}</span>
                  </div>
                  <div className="mt-1 text-slate-700">
                    Parcel: <span className="font-mono">{String(rev.parcel_ref)}</span> — {String(rev.location_text)}
                  </div>
                  <div className="mt-1 text-slate-600">
                    Affected Holder: <strong>{String(rev.owner_name)}</strong> · Gazette:{' '}
                    <span className="font-mono">{String(rev.gazette_order_ref)}</span>
                  </div>
                  <p className="mt-2 text-slate-700">{String(rev.legal_justification)}</p>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-2 font-mono text-[11px] text-slate-500">
                    <span>Executed by: {String(rev.governor_name)}</span>
                    <span>Besu Tx: {String(rev.tx_hash).slice(0, 18)}...</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
