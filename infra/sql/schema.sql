-- ANAGU Integrated Digital Land Administration & Title Registration System
-- PostgreSQL + PostGIS Production Reference Schema

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(80) UNIQUE NOT NULL,
    module VARCHAR(60) NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(40),
    password_hash TEXT NOT NULL,
    role_code VARCHAR(40) NOT NULL REFERENCES roles(code),
    nin_last4 VARCHAR(8),
    license_no VARCHAR(80),
    wallet_address VARCHAR(64),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE landowners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    full_name VARCHAR(160) NOT NULL,
    id_type VARCHAR(40) NOT NULL,
    id_number_hash VARCHAR(128) NOT NULL,
    contact_address TEXT NOT NULL,
    state_name VARCHAR(60) NOT NULL,
    lga_name VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE land_parcels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_ref VARCHAR(64) UNIQUE NOT NULL,
    location_text TEXT NOT NULL,
    state_name VARCHAR(60) NOT NULL,
    lga_name VARCHAR(80) NOT NULL,
    cadastral_zone VARCHAR(80),
    area_sqm DOUBLE PRECISION NOT NULL,
    ownership_category VARCHAR(80) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'Pending',
    geo_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gis_geometries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID UNIQUE REFERENCES land_parcels(id) ON DELETE CASCADE,
    geom GEOMETRY(Polygon, 4326) NOT NULL,
    geojson JSONB NOT NULL,
    is_valid BOOLEAN NOT NULL,
    validation_notes TEXT,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_gis_geometries_geom ON gis_geometries USING GIST (geom);

CREATE TABLE land_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_ref VARCHAR(64) UNIQUE NOT NULL,
    applicant_user_id UUID NOT NULL REFERENCES users(id),
    landowner_id UUID REFERENCES landowners(id),
    parcel_id UUID REFERENCES land_parcels(id),
    applicant_name VARCHAR(160) NOT NULL,
    contact_email VARCHAR(180) NOT NULL,
    contact_phone VARCHAR(40) NOT NULL,
    id_details VARCHAR(120) NOT NULL,
    land_location TEXT NOT NULL,
    state_name VARCHAR(60) NOT NULL,
    lga_name VARCHAR(80) NOT NULL,
    land_size_sqm DOUBLE PRECISION NOT NULL,
    ownership_category VARCHAR(80) NOT NULL,
    status VARCHAR(60) NOT NULL DEFAULT 'Draft',
    feedback TEXT,
    assigned_surveyor_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ownership_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
    doc_type VARCHAR(60) NOT NULL,
    file_name VARCHAR(200) NOT NULL,
    storage_key TEXT NOT NULL,
    sha256_hash VARCHAR(128) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE survey_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES land_applications(id),
    parcel_id UUID NOT NULL REFERENCES land_parcels(id),
    surveyor_id UUID NOT NULL REFERENCES users(id),
    st_is_valid BOOLEAN NOT NULL,
    st_intersects BOOLEAN NOT NULL,
    overlapping_parcel_refs TEXT,
    overlap_percentage DOUBLE PRECISION DEFAULT 0,
    diagnostic_summary TEXT NOT NULL,
    approved BOOLEAN NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE institutional_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_ref VARCHAR(80) UNIQUE NOT NULL,
    parcel_ref VARCHAR(64),
    registered_owner_name VARCHAR(160) NOT NULL,
    id_last4 VARCHAR(8),
    state_name VARCHAR(60) NOT NULL,
    lga_name VARCHAR(80) NOT NULL,
    title_instrument VARCHAR(80) NOT NULL,
    encumbrance_status VARCHAR(60) DEFAULT 'Clear',
    verified_source VARCHAR(120) NOT NULL
);

CREATE TABLE community_attestations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES land_applications(id),
    community_name VARCHAR(120) NOT NULL,
    council_leader_name VARCHAR(140) NOT NULL,
    claimant_name VARCHAR(160) NOT NULL,
    attestation_status VARCHAR(40) NOT NULL,
    notes TEXT,
    attested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ownership_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES land_applications(id),
    outcome VARCHAR(80) NOT NULL,
    institutional_status VARCHAR(60) NOT NULL,
    community_status VARCHAR(60) NOT NULL,
    conflict_details TEXT,
    reviewer_id UUID REFERENCES users(id),
    legal_review_notes TEXT,
    verified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE blockchain_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_hash VARCHAR(80) UNIQUE NOT NULL,
    block_number BIGINT NOT NULL,
    contract_name VARCHAR(60) NOT NULL,
    contract_address VARCHAR(64) NOT NULL,
    method_name VARCHAR(60) NOT NULL,
    parcel_ref VARCHAR(64),
    initiator_user_id UUID REFERENCES users(id),
    event_name VARCHAR(80) NOT NULL,
    event_payload JSONB NOT NULL,
    gas_used INTEGER NOT NULL,
    status VARCHAR(30) DEFAULT 'Confirmed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID UNIQUE NOT NULL REFERENCES land_applications(id),
    parcel_id UUID UNIQUE NOT NULL REFERENCES land_parcels(id),
    registrar_id UUID NOT NULL REFERENCES users(id),
    blockchain_tx_id UUID REFERENCES blockchain_transactions(id),
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE nft_titles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_number VARCHAR(64) UNIQUE NOT NULL,
    token_id INTEGER UNIQUE NOT NULL,
    parcel_id UUID NOT NULL REFERENCES land_parcels(id),
    owner_user_id UUID NOT NULL REFERENCES users(id),
    owner_name VARCHAR(160) NOT NULL,
    owner_commitment_hash VARCHAR(128) NOT NULL,
    tx_hash VARCHAR(80) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Active',
    issued_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE title_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_id UUID NOT NULL REFERENCES nft_titles(id),
    from_user_id UUID NOT NULL REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    authorized_by_registrar_id UUID NOT NULL REFERENCES users(id),
    consideration_ngn NUMERIC(16, 2),
    tx_hash VARCHAR(80) NOT NULL,
    transferred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE revocation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_id UUID NOT NULL REFERENCES nft_titles(id),
    parcel_id UUID NOT NULL REFERENCES land_parcels(id),
    statutory_ground VARCHAR(80) NOT NULL,
    gazette_order_ref VARCHAR(120) NOT NULL,
    legal_justification TEXT NOT NULL,
    supporting_doc_hash VARCHAR(128) NOT NULL,
    executed_by_governor_id UUID NOT NULL REFERENCES users(id),
    tx_hash VARCHAR(80) NOT NULL,
    status VARCHAR(30) DEFAULT 'Executed',
    revoked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mqtt_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic VARCHAR(160) NOT NULL,
    qos SMALLINT DEFAULT 1,
    payload JSONB NOT NULL,
    delivery_status VARCHAR(30) DEFAULT 'Published',
    latency_ms INTEGER DEFAULT 0,
    published_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id UUID REFERENCES users(id),
    actor_role VARCHAR(40),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    target_id VARCHAR(120),
    details JSONB,
    ip_address VARCHAR(60),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
