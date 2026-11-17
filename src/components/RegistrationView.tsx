import React, { useState } from 'react';
import { FileUp, MapPin, Plus, Send, Trash2, WifiOff } from 'lucide-react';
import { LeafletMap } from './LeafletMap';
import {
  apiRequest,
  computeFileSha256,
  enqueueOfflineItem,
  isOfflineSimulated,
} from '../lib/api';
import type { AuthUser, LandApplication, LandParcel, LatLng } from '../types/anagu';

interface RegistrationViewProps {
  user: AuthUser;
  applications: LandApplication[];
  parcels: LandParcel[];
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

const NIGERIAN_STATES = [
  { state: 'FCT Abuja', lgas: ['AMAC', 'Bwari', 'Gwagwalada', 'Kuje'] },
  { state: 'Lagos', lgas: ['Eti-Osa', 'Ikeja', 'Lekki', 'Ikorodu'] },
  { state: 'Anambra', lgas: ['Awka South', 'Awka North', 'Onitsha North', 'Nnewi North'] },
  { state: 'Enugu', lgas: ['Enugu North', 'Enugu South', 'Nsukka'] },
  { state: 'Rivers', lgas: ['Port Harcourt', 'Obio/Akpor', 'Eleme'] },
];

const PIPELINE_STAGES = [
  'Draft',
  'Submitted',
  'GIS verification pending',
  'Ownership verification pending',
  'Legal review',
  'Approved',
];

export function RegistrationView({
  user,
  applications,
  parcels,
  onRefresh,
  onNotify,
}: RegistrationViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [applicantName, setApplicantName] = useState(user.fullName);
  const [contactEmail, setContactEmail] = useState(user.email);
  const [contactPhone, setContactPhone] = useState(user.phone || '+234 803 000 0000');
  const [idDetails, setIdDetails] = useState(`NIN: ***-***-${user.ninLast4 || '4821'}`);
  const [stateName, setStateName] = useState('FCT Abuja');
  const [lgaName, setLgaName] = useState('AMAC');
  const [landLocation, setLandLocation] = useState('');
  const [landSizeSqm, setLandSizeSqm] = useState('1200');
  const [ownershipCategory, setOwnershipCategory] = useState('Certificate of Occupancy');
  const [coordinates, setCoordinates] = useState<LatLng[]>([
    [9.0915, 7.4982],
    [9.0915, 7.4995],
    [9.0904, 7.4995],
    [9.0904, 7.4982],
  ]);
  const [drawingMode, setDrawingMode] = useState(true);
  const [attachedDocs, setAttachedDocs] = useState<
    Array<{ docType: string; fileName: string; sha256Hash: string; fileSizeBytes: number }>
  >([
    {
      docType: 'Survey Plan',
      fileName: 'Survey_Beacon_Plan_2026.pdf',
      sha256Hash: `0x${Array.from({ length: 64 }, (_, i) => ((i * 7 + 3) % 16).toString(16)).join('')}`,
      fileSizeBytes: 512400,
    },
  ]);
  const [docTypeSelect, setDocTypeSelect] = useState('Certificate of Occupancy');
  const [submitting, setSubmitting] = useState(false);
  const [selectedApp, setSelectedApp] = useState<LandApplication | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const lgasForState = NIGERIAN_STATES.find((s) => s.state === stateName)?.lgas || ['AMAC'];

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const sha256Hash = await computeFileSha256(file);
    setAttachedDocs((prev) => [
      ...prev,
      {
        docType: docTypeSelect,
        fileName: file.name,
        sha256Hash,
        fileSizeBytes: file.size || 128000,
      },
    ]);
    onNotify(`Attached ${file.name} (SHA-256 computed)`);
  }

  async function submitApplication(submitNow: boolean) {
    if (!landLocation.trim()) {
      onNotify('Please enter the land location / plot description.', 'error');
      return;
    }
    if (coordinates.length < 3) {
      onNotify('Plot at least 3 boundary coordinates on the map.', 'error');
      return;
    }

    const payload = {
      applicantName,
      contactEmail,
      contactPhone,
      idDetails,
      landLocation,
      stateName,
      lgaName,
      landSizeSqm: Number(landSizeSqm) || 0,
      ownershipCategory,
      coordinates,
      submitNow,
      documents: attachedDocs,
    };

    if (isOfflineSimulated()) {
      enqueueOfflineItem({
        id: `off-${Date.now()}`,
        type: 'application',
        label: `${landLocation} (${stateName})`,
        payload,
        queuedAt: new Date().toISOString(),
      });
      onNotify('Offline mode active: Application queued locally and will sync automatically upon reconnection.');
      setShowForm(false);
      onRefresh();
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ application: { applicationRef: string }; docHashAlert?: boolean }>(
        '/api/applications',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      onNotify(
        `${submitNow ? 'Submitted' : 'Saved draft'} ${res.application.applicationRef}.${
          res.docHashAlert ? ' Warning: duplicate document hash flagged for review.' : ''
        }`
      );
      setShowForm(false);
      setLandLocation('');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDraftSubmit(app: LandApplication) {
    try {
      await apiRequest(`/api/applications/${app.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ coordinates: app.coordinates }),
      });
      onNotify(`Application ${app.application_ref} submitted for GIS verification.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to submit', 'error');
    }
  }

  async function handleCancelApp(app: LandApplication) {
    try {
      await apiRequest(`/api/applications/${app.id}/cancel`, { method: 'POST' });
      onNotify(`Application ${app.application_ref} cancelled.`);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to cancel', 'error');
    }
  }

  const filteredApps = applications.filter((a) => statusFilter === 'ALL' || a.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900">Land Registration Applications</h1>
          <p className="text-xs text-slate-500">
            Submit boundary coordinates, attach SHA-256 verified ownership deeds, and track statutory approval stages.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          {showForm ? 'Close Application Form' : 'New Registration Application'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                New Land Title Registration Form
              </h2>
              <p className="text-xs text-slate-500">
                Click on the cadastral map below to define parcel boundary vertices, or adjust coordinates manually.
              </p>
            </div>
            {isOfflineSimulated() && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <WifiOff className="h-4 w-4" />
                Offline Queue Mode Active
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Applicant Full Name</label>
                  <input
                    type="text"
                    value={applicantName}
                    onChange={(e) => setApplicantName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Identification (NIN / BVN)</label>
                  <input
                    type="text"
                    value={idDetails}
                    onChange={(e) => setIdDetails(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Contact Email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Contact Phone</label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">State</label>
                  <select
                    value={stateName}
                    onChange={(e) => {
                      const nextState = e.target.value;
                      setStateName(nextState);
                      const found = NIGERIAN_STATES.find((s) => s.state === nextState);
                      if (found) setLgaName(found.lgas[0]);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  >
                    {NIGERIAN_STATES.map((s) => (
                      <option key={s.state} value={s.state}>
                        {s.state}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">LGA</label>
                  <select
                    value={lgaName}
                    onChange={(e) => setLgaName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  >
                    {lgasForState.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Declared Size (m²)</label>
                  <input
                    type="number"
                    value={landSizeSqm}
                    onChange={(e) => setLandSizeSqm(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Land Location / Plot Address</label>
                  <input
                    type="text"
                    value={landLocation}
                    onChange={(e) => setLandLocation(e.target.value)}
                    placeholder="Plot 412, Maitama Extension, Abuja"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Ownership Category</label>
                  <select
                    value={ownershipCategory}
                    onChange={(e) => setOwnershipCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                  >
                    <option>Certificate of Occupancy</option>
                    <option>Statutory Right of Occupancy</option>
                    <option>Customary Right of Occupancy</option>
                    <option>Deed of Assignment</option>
                  </select>
                </div>
              </div>

              {/* Supporting Document Upload */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Supporting Ownership Documents &amp; Survey Plan
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={docTypeSelect}
                      onChange={(e) => setDocTypeSelect(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option>Certificate of Occupancy</option>
                      <option>Survey Plan</option>
                      <option>Deed of Assignment</option>
                      <option>Additional Evidence</option>
                    </select>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800">
                      <FileUp className="h-3.5 w-3.5" />
                      Attach File
                      <input type="file" className="hidden" onChange={handleFileSelect} />
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {attachedDocs.map((doc, idx) => (
                    <div
                      key={`${doc.fileName}-${idx}`}
                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800">{doc.docType}</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="text-slate-600">{doc.fileName}</span>
                        <span className="ml-2 font-mono text-[10px] text-slate-400">
                          {doc.sha256Hash.slice(0, 14)}...
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachedDocs((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 lg:col-span-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Interactive Boundary Plotter ({coordinates.length} vertices)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawingMode(!drawingMode)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      drawingMode ? 'bg-emerald-700 text-white' : 'border border-slate-300 text-slate-700'
                    }`}
                  >
                    {drawingMode ? 'Click Map to Add Vertex' : 'Enable Map Plotting'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoordinates([])}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear Vertices
                  </button>
                </div>
              </div>

              <LeafletMap
                parcels={parcels}
                draftPolygon={coordinates}
                drawingMode={drawingMode}
                onAddVertex={(pt) => setCoordinates((prev) => [...prev, pt])}
                heightClass="h-[300px]"
              />

              <div className="max-h-24 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                {coordinates.length === 0
                  ? 'No vertices plotted yet. Click on the map above to define parcel corners.'
                  : coordinates.map((c, i) => `V${i + 1}: [${c[0]}, ${c[1]}]`).join('  ·  ')}
              </div>

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitApplication(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitApplication(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Applications Table */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {['ALL', 'Draft', 'GIS verification pending', 'Ownership verification pending', 'Legal review', 'Approved', 'Rejected'].map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All Applications' : st}
                </button>
              )
            )}
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredApps.length} application(s)
          </span>
        </div>

        {filteredApps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 py-12 text-center">
            <MapPin className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-700">No applications match this filter</p>
            <p className="mt-1 text-xs text-slate-500">Create a new registration application or clear the status filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Application Ref</th>
                  <th className="py-2.5 pr-3 font-semibold">Applicant</th>
                  <th className="py-2.5 pr-3 font-semibold">Land Location</th>
                  <th className="py-2.5 pr-3 font-semibold">Category</th>
                  <th className="py-2.5 pr-3 text-right font-semibold">Area (m²)</th>
                  <th className="py-2.5 pr-3 font-semibold">Status</th>
                  <th className="py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApps.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono font-semibold text-slate-900">{app.application_ref}</td>
                    <td className="py-3 pr-3 text-slate-800">{app.applicant_name}</td>
                    <td className="py-3 pr-3 text-slate-600">{app.land_location}</td>
                    <td className="py-3 pr-3 text-slate-600">{app.ownership_category}</td>
                    <td className="py-3 pr-3 text-right font-mono text-slate-800 tabular-nums">
                      {Number(app.land_size_sqm).toLocaleString()}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`font-semibold ${
                          app.status === 'Approved'
                            ? 'text-emerald-700'
                            : app.status === 'Rejected' || app.status === 'Cancelled'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {app.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedApp(selectedApp?.id === app.id ? null : app)}
                          className="font-semibold text-emerald-700 hover:underline"
                        >
                          {selectedApp?.id === app.id ? 'Hide' : 'Track'}
                        </button>
                        {app.status === 'Draft' && (
                          <button
                            type="button"
                            onClick={() => handleDraftSubmit(app)}
                            className="font-semibold text-slate-900 hover:underline"
                          >
                            Submit
                          </button>
                        )}
                        {app.status !== 'Approved' && app.status !== 'Cancelled' && (
                          <button
                            type="button"
                            onClick={() => handleCancelApp(app)}
                            className="font-semibold text-red-700 hover:underline"
                          >
                            Cancel
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

        {selectedApp && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-xs font-bold text-slate-900">{selectedApp.application_ref}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="text-xs font-medium text-slate-600">{selectedApp.parcel_ref}</span>
              </div>
              <span className="text-xs font-semibold text-emerald-700">Current Stage: {selectedApp.status}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
              {PIPELINE_STAGES.map((stage, idx) => {
                const activeIdx = PIPELINE_STAGES.indexOf(selectedApp.status);
                const done = activeIdx >= idx || selectedApp.status === 'Approved';
                return (
                  <div
                    key={stage}
                    className={`rounded border p-2 text-[11px] font-medium ${
                      done
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    {idx + 1}. {stage}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-700">
              <strong>Registry Feedback:</strong> {selectedApp.feedback || 'Awaiting officer review.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
