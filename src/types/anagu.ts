export type UserRole =
  | 'citizen'
  | 'surveyor'
  | 'registrar'
  | 'land_admin'
  | 'governor'
  | 'sys_admin';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  walletAddress: string;
  phone?: string;
  ninLast4?: string | null;
  licenseNo?: string | null;
}

export type LatLng = [number, number];

export interface LandDocument {
  id: string;
  application_id: string;
  doc_type: string;
  file_name: string;
  storage_key: string;
  sha256_hash: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export interface LandApplication {
  id: string;
  application_ref: string;
  applicant_user_id: string;
  parcel_id: string;
  parcel_ref: string;
  parcel_status: string;
  applicant_name: string;
  contact_email: string;
  contact_phone: string;
  id_details: string;
  land_location: string;
  state_name: string;
  lga_name: string;
  land_size_sqm: number;
  ownership_category: string;
  status: string;
  feedback: string;
  coordinates: LatLng[];
  centroid_lat?: number;
  centroid_lng?: number;
  gis_is_valid?: number;
  oracle_outcome?: string;
  institutional_status?: string;
  community_status?: string;
  legal_review_notes?: string;
  documents: LandDocument[];
  created_at: string;
  updated_at: string;
}

export interface LandParcel {
  id: string;
  parcel_ref: string;
  location_text: string;
  state_name: string;
  lga_name: string;
  cadastral_zone: string;
  area_sqm: number;
  ownership_category: string;
  status: 'Registered' | 'Pending' | 'Revoked' | 'Draft' | 'Rejected' | 'Cancelled';
  geo_hash: string;
  coordinates: LatLng[];
  wkt_text: string;
  is_valid: number;
  validation_notes: string;
  centroid_lat: number;
  centroid_lng: number;
  title_number?: string;
  token_id?: number;
  owner_name?: string;
  title_status?: string;
}

export interface GisValidationResult {
  stIsValid: boolean;
  stIntersects: boolean;
  validationReason: string;
  areaSqm: number;
  areaHectares: number;
  centroid: LatLng;
  geoHash: string;
  wkt: string;
  overlappingParcels: Array<{
    parcelRef: string;
    locationText: string;
    status: string;
    overlapEstimatePct: number;
  }>;
  duplicateGeoClaim: boolean;
  diagnostics: string[];
}

export interface NftTitle {
  id: string;
  title_number: string;
  token_id: number;
  parcel_id: string;
  parcel_ref: string;
  location_text: string;
  state_name: string;
  lga_name: string;
  area_sqm: number;
  ownership_category: string;
  owner_user_id: string;
  owner_name: string;
  owner_commitment_hash: string;
  tx_hash: string;
  status: 'Active' | 'Revoked';
  issued_at: string;
  coordinates_json: string;
  statutory_ground?: string;
  gazette_order_ref?: string;
  revoked_at?: string;
}

export interface BlockchainTransaction {
  id: string;
  tx_hash: string;
  block_number: number;
  contract_name: string;
  contract_address: string;
  method_name: string;
  parcel_ref: string;
  initiator_name?: string;
  initiator_role?: string;
  event_name: string;
  event_payload: string;
  gas_used: number;
  status: string;
  created_at: string;
}

export interface MqttMessage {
  id: string;
  topic: string;
  qos: number;
  payload: string;
  delivery_status: string;
  latency_ms: number;
  published_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: string;
  is_read: number;
  created_at: string;
}

export interface OfflineQueueItem {
  id: string;
  type: 'application';
  label: string;
  payload: Record<string, unknown>;
  queuedAt: string;
}

export interface TestRunSummary {
  executedAt: string;
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  results: Array<{
    id: string;
    suite: string;
    name: string;
    passed: boolean;
    durationMs: number;
    detail: string;
  }>;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  citizen: 'Citizen / Landowner',
  surveyor: 'Licensed Surveyor',
  registrar: 'Registrar of Titles',
  land_admin: 'Land Administrator',
  governor: 'Governor-Authorised Officer',
  sys_admin: 'System Administrator',
};
