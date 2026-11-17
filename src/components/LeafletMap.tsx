import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LandParcel, LatLng } from '../types/anagu';

interface LeafletMapProps {
  parcels: LandParcel[];
  draftPolygon?: LatLng[];
  selectedParcelRef?: string | null;
  drawingMode?: boolean;
  onAddVertex?: (coord: LatLng) => void;
  onSelectParcel?: (parcel: LandParcel) => void;
  heightClass?: string;
}

const STATUS_STYLES: Record<string, { color: string; fillColor: string; fillOpacity: number; dashArray?: string }> = {
  Registered: { color: '#059669', fillColor: '#10B981', fillOpacity: 0.28 },
  Pending: { color: '#D97706', fillColor: '#F59E0B', fillOpacity: 0.28 },
  Revoked: { color: '#DC2626', fillColor: '#EF4444', fillOpacity: 0.34, dashArray: '6 4' },
  Draft: { color: '#475569', fillColor: '#64748B', fillOpacity: 0.2, dashArray: '4 4' },
  Rejected: { color: '#991B1B', fillColor: '#DC2626', fillOpacity: 0.15, dashArray: '3 5' },
  Cancelled: { color: '#64748B', fillColor: '#94A3B8', fillOpacity: 0.12 },
};

export function LeafletMap({
  parcels,
  draftPolygon = [],
  selectedParcelRef,
  drawingMode = false,
  onAddVertex,
  onSelectParcel,
  heightClass = 'h-[420px]',
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onAddVertexRef = useRef(onAddVertex);
  const drawingModeRef = useRef(drawingMode);

  onAddVertexRef.current = onAddVertex;
  drawingModeRef.current = drawingMode;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [9.082, 7.482], // Abuja FCT Cadastral Center
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors · ANAGU GIS',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawingModeRef.current && onAddVertexRef.current) {
        onAddVertexRef.current([
          Number(e.latlng.lat.toFixed(6)),
          Number(e.latlng.lng.toFixed(6)),
        ]);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    let focusedBounds: L.LatLngBounds | null = null;

    for (const parcel of parcels) {
      if (!parcel.coordinates || parcel.coordinates.length < 3) continue;
      const baseStyle = STATUS_STYLES[parcel.status] || STATUS_STYLES.Pending;
      const isSelected = selectedParcelRef && parcel.parcel_ref === selectedParcelRef;

      const poly = L.polygon(parcel.coordinates, {
        ...baseStyle,
        weight: isSelected ? 3.5 : 2,
      });

      poly.bindPopup(
        `<div style="min-width:210px;font-family:Public Sans,sans-serif;">
          <div style="font-weight:700;font-size:12px;color:#0F172A;margin-bottom:4px;">${parcel.parcel_ref}</div>
          <div style="font-size:12px;color:#334155;margin-bottom:6px;">${parcel.location_text}</div>
          <div style="font-size:11px;color:#475569;">Status: <strong>${parcel.status}</strong> · ${Number(parcel.area_sqm).toLocaleString()} m²</div>
          ${parcel.title_number ? `<div style="font-size:11px;color:#0F766E;margin-top:3px;">Title: ${parcel.title_number}</div>` : ''}
        </div>`
      );

      poly.on('click', () => {
        if (!drawingModeRef.current && onSelectParcel) {
          onSelectParcel(parcel);
        }
      });

      poly.addTo(group);

      if (isSelected) {
        focusedBounds = poly.getBounds();
      }
    }

    if (draftPolygon.length >= 1) {
      draftPolygon.forEach((pt, idx) => {
        L.circleMarker(pt, {
          radius: 5,
          color: '#0F766E',
          fillColor: '#14B8A6',
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(`V${idx + 1}`, { permanent: false })
          .addTo(group);
      });

      if (draftPolygon.length >= 2) {
        const shape =
          draftPolygon.length >= 3
            ? L.polygon(draftPolygon, {
                color: '#0F766E',
                fillColor: '#14B8A6',
                fillOpacity: 0.25,
                weight: 2.5,
                dashArray: '5 4',
              })
            : L.polyline(draftPolygon, { color: '#0F766E', weight: 2.5, dashArray: '5 4' });
        shape.addTo(group);
        if (!focusedBounds) {
          focusedBounds = shape.getBounds();
        }
      }
    }

    if (focusedBounds && focusedBounds.isValid()) {
      map.fitBounds(focusedBounds.pad(0.6), { maxZoom: 16 });
    }
  }, [parcels, draftPolygon, selectedParcelRef, onSelectParcel]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <div
        ref={containerRef}
        className={`w-full ${heightClass} ${drawingMode ? 'cursor-crosshair' : ''}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600" />
            Registered Title
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-amber-500" />
            Pending Verification
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-red-600" />
            Statutorily Revoked
          </span>
          {draftPolygon.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-xs bg-teal-600" />
              Active Plot Geometry
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-slate-500">
          EPSG:4326 WGS84 · {parcels.length} cadastral parcel(s)
        </span>
      </div>
    </div>
  );
}
