import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Award, CheckCircle2, Printer, Repeat, ShieldCheck, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthUser, LandApplication, NftTitle } from '../types/anagu';

interface RegistrarTitlesViewProps {
  user: AuthUser;
  applications: LandApplication[];
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function RegistrarTitlesView({
  user,
  applications,
  onRefresh,
  onNotify,
}: RegistrarTitlesViewProps) {
  const [titles, setTitles] = useState<NftTitle[]>([]);
  const [transfers, setTransfers] = useState<Array<Record<string, unknown>>>([]);
  const [recipients, setRecipients] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedCertificate, setSelectedCertificate] = useState<NftTitle | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [transferTarget, setTransferTarget] = useState<NftTitle | null>(null);
  const [transferRecipientId, setTransferRecipientId] = useState('');
  const [considerationNgn, setConsiderationNgn] = useState('45000000');

  async function loadTitles() {
    try {
      const res = await apiRequest<{
        titles: NftTitle[];
        transfers: Array<Record<string, unknown>>;
        eligibleRecipients: Array<{ id: string; full_name: string; email: string }>;
      }>('/api/titles');
      setTitles(res.titles);
      setTransfers(res.transfers);
      setRecipients(res.eligibleRecipients);
      if (res.eligibleRecipients.length > 0 && !transferRecipientId) {
        setTransferRecipientId(res.eligibleRecipients[0].id);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load NFT titles', 'error');
    }
  }

  useEffect(() => {
    loadTitles();
  }, []);

  useEffect(() => {
    if (!selectedCertificate) {
      setQrDataUrl('');
      return;
    }
    const verifyUrl = `${window.location.origin}/?verify=${encodeURIComponent(selectedCertificate.title_number)}`;
    QRCode.toDataURL(verifyUrl, {
      width: 156,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    }).then(setQrDataUrl);
  }, [selectedCertificate]);

  const registrarQueue = applications.filter(
    (a) => a.status === 'Legal review' || a.status === 'Ownership verification pending'
  );

  async function handleRegistrarDecision(app: LandApplication, decision: 'approve' | 'reject' | 'request_correction') {
    setBusyId(app.id);
    try {
      const res = await apiRequest<{ titleNumber?: string; tokenId?: number; status: string }>(
        `/api/registrar/decision/${app.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, notes: decisionNotes }),
        }
      );
      onNotify(
        decision === 'approve'
          ? `Approved! Minted ERC-721 Title ${res.titleNumber} (Token #${res.tokenId}) on Hyperledger Besu.`
          : `Application ${app.application_ref} updated to ${res.status}.`
      );
      setDecisionNotes('');
      await loadTitles();
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Registrar action blocked by backend', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTarget || !transferRecipientId) return;
    setBusyId(transferTarget.id);
    try {
      const res = await apiRequest<{ txHash: string }>(`/api/titles/${transferTarget.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          newOwnerUserId: transferRecipientId,
          considerationNgn: Number(considerationNgn) || 0,
        }),
      });
      onNotify(`Ownership transferred on Besu (${res.txHash.slice(0, 14)}...).`);
      setTransferTarget(null);
      await loadTitles();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Transfer rejected', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="font-display text-lg font-bold text-slate-900">
          Registrar Approvals &amp; ERC-721 Digital Land Titles
        </h1>
        <p className="text-xs text-slate-500">
          Issue verifiable ERC-721 NFT land titles on Hyperledger Besu, download official QR-encoded certificates, and
          execute registry-controlled ownership transfers.
        </p>
      </div>

      {/* Registrar Approval Queue */}
      {(user.role === 'registrar' || registrarQueue.length > 0) && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">Registrar Approval Queue</h2>
              <p className="text-xs text-slate-500">
                {user.role === 'registrar'
                  ? 'Approving an application commits the parcel on Besu LandRegistry and mints an ERC-721 title.'
                  : 'Authorised Registrar role required on backend to sign title issuance.'}
              </p>
            </div>
            <input
              type="text"
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="Optional Registrar minute / approval note..."
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>

          <div className="mt-4 space-y-3">
            {registrarQueue.length === 0 ? (
              <p className="text-xs text-slate-500">No applications currently awaiting Registrar approval.</p>
            ) : (
              registrarQueue.map((app) => (
                <div key={app.id} className="rounded-lg border border-slate-200 p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{app.application_ref}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-semibold text-slate-800">{app.applicant_name}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-mono text-slate-500">{app.parcel_ref}</span>
                    </div>
                    <span className="font-semibold text-amber-700">{app.status}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    {app.land_location} · {Number(app.land_size_sqm).toLocaleString()} m² · Oracle:{' '}
                    <strong>{app.oracle_outcome || 'Pending'}</strong>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={busyId === app.id}
                      onClick={() => handleRegistrarDecision(app, 'request_correction')}
                      className="rounded border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Request Correction
                    </button>
                    <button
                      type="button"
                      disabled={busyId === app.id}
                      onClick={() => handleRegistrarDecision(app, 'reject')}
                      className="rounded border border-red-300 bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyId === app.id}
                      onClick={() => handleRegistrarDecision(app, 'approve')}
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <Award className="h-3.5 w-3.5" />
                      Approve &amp; Mint NFT Title
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Issued NFT Digital Titles Table */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-900">Issued ERC-721 Digital Land Titles</h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">{titles.length} title(s)</span>
        </div>
        {titles.length === 0 ? (
          <p className="text-xs text-slate-500">No digital land titles issued yet for your account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Title ID</th>
                  <th className="py-2.5 pr-3 font-semibold">Token</th>
                  <th className="py-2.5 pr-3 font-semibold">Registered Owner</th>
                  <th className="py-2.5 pr-3 font-semibold">Parcel &amp; Location</th>
                  <th className="py-2.5 pr-3 font-semibold">Besu Tx Hash</th>
                  <th className="py-2.5 pr-3 font-semibold">Status</th>
                  <th className="py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {titles.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono font-bold text-slate-900">{t.title_number}</td>
                    <td className="py-3 pr-3 font-mono text-slate-700 tabular-nums">#{t.token_id}</td>
                    <td className="py-3 pr-3 font-medium text-slate-800">{t.owner_name}</td>
                    <td className="py-3 pr-3 text-slate-600">
                      <div className="font-mono text-[11px] text-slate-800">{t.parcel_ref}</div>
                      <div>{t.location_text}</div>
                    </td>
                    <td className="py-3 pr-3 font-mono text-slate-500">{t.tx_hash.slice(0, 14)}...</td>
                    <td className="py-3 pr-3">
                      <span className={`font-semibold ${t.status === 'Active' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedCertificate(t)}
                          className="font-semibold text-emerald-700 hover:underline whitespace-nowrap"
                        >
                          View Certificate
                        </button>
                        {user.role === 'registrar' && (
                          <button
                            type="button"
                            onClick={() => setTransferTarget(t)}
                            className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:underline whitespace-nowrap"
                          >
                            <Repeat className="h-3 w-3" />
                            Transfer
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Registry-Controlled Title Transfers */}
      {transfers.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-display text-sm font-bold text-slate-900">Registry-Controlled Title Transfers</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">From</th>
                  <th className="py-2 pr-3 font-semibold">To</th>
                  <th className="py-2 pr-3 font-semibold">Authorised By</th>
                  <th className="py-2 pr-3 text-right font-semibold">Consideration (NGN)</th>
                  <th className="py-2 font-semibold">Besu Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.map((tr) => (
                  <tr key={String(tr.id)}>
                    <td className="py-2.5 pr-3 text-slate-700">{String(tr.from_name)}</td>
                    <td className="py-2.5 pr-3 font-semibold text-slate-900">{String(tr.to_name)}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{String(tr.registrar_name)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                      ₦{Number(tr.consideration_ngn || 0).toLocaleString()}
                    </td>
                    <td className="py-2.5 font-mono text-slate-500">{String(tr.tx_hash).slice(0, 18)}...</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Registry Transfer Modal */}
      {transferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleTransferSubmit}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900">
                Authorize Title Transfer ({transferTarget.title_number})
              </h3>
              <button type="button" onClick={() => setTransferTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Direct peer-to-peer ERC-721 transfers are disabled by smart contract. Only Registrar-authorized transfers
              on non-revoked titles are permitted.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">New Registered Owner</label>
              <select
                value={transferRecipientId}
                onChange={(e) => setTransferRecipientId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name} ({r.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Consideration Amount (NGN)</label>
              <input
                type="number"
                value={considerationNgn}
                onChange={(e) => setConsiderationNgn(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTransferTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === transferTarget.id}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Execute Contract Transfer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable Official Digital Land Title Certificate Modal */}
      {selectedCertificate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white p-8 shadow-xl">
            <div className="no-print mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="text-xs font-semibold text-slate-500">Official ANAGU ERC-721 Land Title Certificate</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCertificate(null)}
                  className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="rounded-lg border-2 border-emerald-900/20 bg-slate-50/40 p-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-5">
                <div className="flex items-center gap-4">
                  <img
                    src="/src/assets/images/anagu_official_seal_1794917693424.jpg"
                    alt="ANAGU Land Registry Official Seal"
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 rounded-full border border-emerald-900/20 object-cover"
                  />
                  <div>
                    <div className="text-[11px] font-semibold tracking-wider text-emerald-800">
                      FEDERAL REPUBLIC OF NIGERIA · ANAGU DIGITAL LAND REGISTRY
                    </div>
                    <h3 className="mt-0.5 font-display text-xl font-bold text-slate-900">
                      Digital Certificate of Land Title
                    </h3>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-700">
                      {selectedCertificate.title_number}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${
                      selectedCertificate.status === 'Active' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {selectedCertificate.status.toUpperCase()}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">
                    Token #{selectedCertificate.token_id}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-12">
                <dl className="space-y-2.5 text-xs sm:col-span-8">
                  <div>
                    <dt className="text-slate-500">Registered Titleholder</dt>
                    <dd className="text-sm font-bold text-slate-900">{selectedCertificate.owner_name}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Land Location &amp; Jurisdiction</dt>
                    <dd className="font-medium text-slate-900">
                      {selectedCertificate.location_text} ({selectedCertificate.lga_name},{' '}
                      {selectedCertificate.state_name})
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-slate-500">Parcel Reference</dt>
                      <dd className="font-mono font-semibold text-slate-900">{selectedCertificate.parcel_ref}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Surveyed Area</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        {Number(selectedCertificate.area_sqm).toLocaleString()} m²
                      </dd>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-slate-500">Title Instrument</dt>
                      <dd className="font-medium text-slate-900">{selectedCertificate.ownership_category}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Registration Date</dt>
                      <dd className="font-mono text-slate-900">
                        {new Date(selectedCertificate.issued_at).toLocaleDateString()}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-slate-500">Hyperledger Besu Transaction Reference</dt>
                    <dd className="break-all font-mono text-[11px] text-slate-700">{selectedCertificate.tx_hash}</dd>
                  </div>
                </dl>

                <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-3 sm:col-span-4">
                  {qrDataUrl && (
                    <img src={qrDataUrl} alt="Title Verification QR Code" className="h-32 w-32" />
                  )}
                  <span className="mt-2 text-center font-mono text-[10px] text-slate-500">
                    Scan to verify authenticity against ANAGU Registry
                  </span>
                </div>
              </div>

              {selectedCertificate.status === 'Revoked' && (
                <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                  <strong>STATUTORILY REVOKED:</strong> {selectedCertificate.statutory_ground} · Gazette{' '}
                  {selectedCertificate.gazette_order_ref}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                  Zero PII stored on-chain · Privacy commitment verified
                </span>
                <span className="font-mono">ERC-721 ANAGUCT</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
