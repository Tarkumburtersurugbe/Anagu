import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Compass, Layers } from 'lucide-react';
import { LeafletMap } from './LeafletMap';
import { apiRequest } from '../lib/api';
import type { AuthUser, GisValidationResult, LandApplication, LandParcel, LatLng } from '../types/anagu';

interface GisVerificationViewProps {
  user: AuthUser;
  applications: LandApplication[];
  parcels: LandParcel[];
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function GisVerificationView({
  user,
  applications,
  parcels,
  onRefresh,
  onNotify,
}: GisVerificationViewProps) {
  const [selectedParcelRef, setSelectedParcelRef] = useState<string | null>(null);
  const [testCoords, setTestCoords] = useState<LatLng[]>([
    [9.0912, 7.5012],
    [9.0912, 7.5024],
    [9.0902, 7.5024],
    [9.0902, 7.5012],
  ]);
  const [validationResult, setValidationResult] = useState<GisValidationResult | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [diagnosticNotes, setDiagnosticNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingGisApps = applications.filter(
    (a) => a.status === 'GIS verification pending' || a.status === 'Submitted' || a.status === 'Under review'
  );

  async function runSpatialCheck(coords: LatLng[], excludeParcelId?: string) {
    try {
      const res = await apiRequest<{ result: GisValidationResult }>('/api/gis/validate', {
        method: 'POST',
        body: JSON.stringify({ coordinates: coords, excludeParcelId }),
      });
      setValidationResult(res.result);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'GIS spatial check failed', 'error');
    }
  }

  async function submitSurveyDecision(app: LandApplication, approved: boolean) {
    setBusyId(app.id);
    try {
      await apiRequest(`/api/gis/verify/${app.id}`, {
        method: 'POST',
        body: JSON.stringify({
          approved,
          diagnosticNotes: diagnosticNotes || undefined,
        }),
      });
      onNotify(
        approved
          ? `GIS verification approved for ${app.application_ref}. Forwarded to Ownership Oracle.`
          : `GIS spatial issue flagged for ${app.application_ref}.`
      );
      setDiagnosticNotes('');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Surveyor verification rejected by backend', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900">
            GIS Land Verification &amp; Spatial Integrity Workbench
          </h1>
          <p className="text-xs text-slate-500">
            Leaflet cadastral boundary explorer paired with PostGIS ST_IsValid and ST_Intersects overlap detection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const clean: LatLng[] = [
                [9.0912, 7.5012],
                [9.0912, 7.5024],
                [9.0902, 7.5024],
                [9.0902, 7.5012],
              ];
              setTestCoords(clean);
              runSpatialCheck(clean);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Test Clean Plot
          </button>
          <button
            type="button"
            onClick={() => {
              const overlap: LatLng[] = [
                [9.0840, 7.4915],
                [9.0840, 7.4930],
                [9.0832, 7.4930],
                [9.0832, 7.4915],
              ];
              setTestCoords(overlap);
              runSpatialCheck(overlap);
            }}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
          >
            Test Overlap Conflict
          </button>
          <button
            type="button"
            onClick={() => {
              const bowtie: LatLng[] = [
                [9.095, 7.51],
                [9.096, 7.512],
                [9.096, 7.51],
                [9.095, 7.512],
              ];
              setTestCoords(bowtie);
              runSpatialCheck(bowtie);
            }}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 whitespace-nowrap"
          >
            Test Invalid Self-Intersection
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
              <Layers className="h-4 w-4 text-emerald-700" />
              Interactive Cadastral Map
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawingMode(!drawingMode)}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${
                  drawingMode ? 'bg-emerald-700 text-white' : 'border border-slate-300 text-slate-700'
                }`}
              >
                {drawingMode ? 'Plotting Active (Click Map)' : 'Plot Test Polygon'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTestCoords([]);
                  setValidationResult(null);
                }}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => runSpatialCheck(testCoords)}
                className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Run ST_IsValid / ST_Intersects
              </button>
            </div>
          </div>

          <LeafletMap
            parcels={parcels}
            draftPolygon={testCoords}
            selectedParcelRef={selectedParcelRef}
            drawingMode={drawingMode}
            onAddVertex={(pt) => setTestCoords((prev) => [...prev, pt])}
            onSelectParcel={(p) => {
              setSelectedParcelRef(p.parcel_ref);
              setTestCoords(p.coordinates);
              runSpatialCheck(p.coordinates, p.id);
            }}
            heightClass="h-[420px]"
          />
        </div>

        <div className="space-y-4 lg:col-span-5">
          {/* Spatial Diagnostic Output */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
              <Compass className="h-4 w-4 text-emerald-700" />
              Spatial Diagnostic Report
            </h2>

            {!validationResult ? (
              <p className="mt-3 text-xs text-slate-500">
                Select a cadastral parcel or click a spatial preset button above to run PostGIS geometry validation and
                overlap detection.
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-slate-500">ST_IsValid</div>
                    <div
                      className={`mt-1 flex items-center gap-1 font-mono font-bold ${
                        validationResult.stIsValid ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {validationResult.stIsValid ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {validationResult.stIsValid ? 'TRUE' : 'FALSE'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-slate-500">ST_Intersects (Overlap)</div>
                    <div
                      className={`mt-1 flex items-center gap-1 font-mono font-bold ${
                        !validationResult.stIntersects ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {!validationResult.stIntersects ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {validationResult.stIntersects ? 'TRUE (CONFLICT)' : 'FALSE (CLEAR)'}
                    </div>
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
                  <div>Area: {validationResult.areaSqm.toLocaleString()} m² ({validationResult.areaHectares} ha)</div>
                  <div className="mt-1 truncate">GeoHash: {validationResult.geoHash}</div>
                  <div className="mt-1 truncate">WKT: {validationResult.wkt}</div>
                </div>

                <div className="space-y-1">
                  {validationResult.diagnostics.map((d, idx) => (
                    <div key={idx} className="text-slate-700">
                      • {d}
                    </div>
                  ))}
                </div>

                {validationResult.overlappingParcels.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 p-3 text-red-900">
                    <div className="font-semibold">Detected Overlapping Parcels:</div>
                    {validationResult.overlappingParcels.map((op) => (
                      <div key={op.parcelRef} className="mt-1 font-mono text-[11px]">
                        {op.parcelRef} ({op.status}) — {op.overlapEstimatePct}% overlap
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Surveyor Queue */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-slate-900">Surveyor Verification Queue</h2>
              <span className="font-mono text-xs text-slate-500">{pendingGisApps.length} pending</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {user.role === 'surveyor'
                ? 'Inspect coordinates and submit signed verification reports.'
                : 'Read-only preview (Licensed Surveyor role required on backend to sign reports).'}
            </p>

            <div className="mt-3">
              <input
                type="text"
                value={diagnosticNotes}
                onChange={(e) => setDiagnosticNotes(e.target.value)}
                placeholder="Optional surveyor beacon/boundary remarks..."
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="mt-3 space-y-2.5">
              {pendingGisApps.length === 0 ? (
                <p className="text-xs text-slate-500">No applications awaiting GIS verification.</p>
              ) : (
                pendingGisApps.map((app) => (
                  <div key={app.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-900">{app.application_ref}</span>
                      <span className="font-mono text-[11px] text-slate-500">{app.parcel_ref}</span>
                    </div>
                    <div className="mt-1 text-slate-700">{app.land_location}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedParcelRef(app.parcel_ref);
                          setTestCoords(app.coordinates);
                          runSpatialCheck(app.coordinates, app.parcel_id);
                        }}
                        className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Inspect on Map
                      </button>
                      <button
                        type="button"
                        disabled={busyId === app.id}
                        onClick={() => submitSurveyDecision(app, true)}
                        className="rounded bg-emerald-700 px-2.5 py-1 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Approve GIS
                      </button>
                      <button
                        type="button"
                        disabled={busyId === app.id}
                        onClick={() => submitSurveyDecision(app, false)}
                        className="rounded border border-red-300 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        Flag Conflict
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
