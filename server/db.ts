import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { evaluateParcelGeometry, LatLng } from './gis.ts';

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'anagu.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function sha256(input: string): string {
  return '0x' + crypto.createHash('sha256').update(input).digest('hex');
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
      PRIMARY KEY (role_code, permission_code)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role_code TEXT NOT NULL REFERENCES roles(code),
      nin_last4 TEXT,
      license_no TEXT,
      wallet_address TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS landowners (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      full_name TEXT NOT NULL,
      id_type TEXT NOT NULL,
      id_number_hash TEXT NOT NULL,
      contact_address TEXT NOT NULL,
      state_name TEXT NOT NULL,
      lga_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS land_parcels (
      id TEXT PRIMARY KEY,
      parcel_ref TEXT UNIQUE NOT NULL,
      location_text TEXT NOT NULL,
      state_name TEXT NOT NULL,
      lga_name TEXT NOT NULL,
      cadastral_zone TEXT,
      area_sqm REAL NOT NULL,
      ownership_category TEXT NOT NULL,
      status TEXT NOT NULL,
      geo_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gis_geometries (
      id TEXT PRIMARY KEY,
      parcel_id TEXT UNIQUE NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
      coordinates_json TEXT NOT NULL,
      geojson_text TEXT NOT NULL,
      wkt_text TEXT NOT NULL,
      is_valid INTEGER NOT NULL,
      validation_notes TEXT NOT NULL,
      centroid_lat REAL NOT NULL,
      centroid_lng REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS land_applications (
      id TEXT PRIMARY KEY,
      application_ref TEXT UNIQUE NOT NULL,
      applicant_user_id TEXT NOT NULL REFERENCES users(id),
      landowner_id TEXT REFERENCES landowners(id),
      parcel_id TEXT REFERENCES land_parcels(id),
      applicant_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      id_details TEXT NOT NULL,
      land_location TEXT NOT NULL,
      state_name TEXT NOT NULL,
      lga_name TEXT NOT NULL,
      land_size_sqm REAL NOT NULL,
      ownership_category TEXT NOT NULL,
      status TEXT NOT NULL,
      feedback TEXT,
      assigned_surveyor_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ownership_documents (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS survey_records (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
      parcel_id TEXT NOT NULL REFERENCES land_parcels(id),
      surveyor_id TEXT NOT NULL REFERENCES users(id),
      st_is_valid INTEGER NOT NULL,
      st_intersects INTEGER NOT NULL,
      overlapping_parcel_refs TEXT,
      overlap_percentage REAL DEFAULT 0,
      diagnostic_summary TEXT NOT NULL,
      approved INTEGER NOT NULL,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS institutional_records (
      id TEXT PRIMARY KEY,
      record_ref TEXT UNIQUE NOT NULL,
      parcel_ref TEXT,
      registered_owner_name TEXT NOT NULL,
      id_last4 TEXT,
      state_name TEXT NOT NULL,
      lga_name TEXT NOT NULL,
      title_instrument TEXT NOT NULL,
      encumbrance_status TEXT NOT NULL,
      verified_source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_attestations (
      id TEXT PRIMARY KEY,
      application_id TEXT REFERENCES land_applications(id) ON DELETE CASCADE,
      community_name TEXT NOT NULL,
      council_leader_name TEXT NOT NULL,
      claimant_name TEXT NOT NULL,
      attestation_status TEXT NOT NULL,
      notes TEXT,
      attested_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ownership_verifications (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
      outcome TEXT NOT NULL,
      institutional_status TEXT NOT NULL,
      community_status TEXT NOT NULL,
      conflict_details TEXT,
      reviewer_id TEXT REFERENCES users(id),
      legal_review_notes TEXT,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blockchain_transactions (
      id TEXT PRIMARY KEY,
      tx_hash TEXT UNIQUE NOT NULL,
      block_number INTEGER NOT NULL,
      contract_name TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      method_name TEXT NOT NULL,
      parcel_ref TEXT,
      initiator_user_id TEXT REFERENCES users(id),
      event_name TEXT NOT NULL,
      event_payload TEXT NOT NULL,
      gas_used INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      application_id TEXT UNIQUE NOT NULL REFERENCES land_applications(id),
      parcel_id TEXT UNIQUE NOT NULL REFERENCES land_parcels(id),
      registrar_id TEXT NOT NULL REFERENCES users(id),
      blockchain_tx_id TEXT REFERENCES blockchain_transactions(id),
      registered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nft_titles (
      id TEXT PRIMARY KEY,
      title_number TEXT UNIQUE NOT NULL,
      token_id INTEGER UNIQUE NOT NULL,
      parcel_id TEXT NOT NULL REFERENCES land_parcels(id),
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      owner_name TEXT NOT NULL,
      owner_commitment_hash TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS title_transfers (
      id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES nft_titles(id),
      from_user_id TEXT NOT NULL REFERENCES users(id),
      to_user_id TEXT NOT NULL REFERENCES users(id),
      authorized_by_registrar_id TEXT NOT NULL REFERENCES users(id),
      consideration_ngn REAL,
      tx_hash TEXT NOT NULL,
      transferred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revocation_requests (
      id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES nft_titles(id),
      parcel_id TEXT NOT NULL REFERENCES land_parcels(id),
      statutory_ground TEXT NOT NULL,
      gazette_order_ref TEXT NOT NULL,
      legal_justification TEXT NOT NULL,
      supporting_doc_hash TEXT NOT NULL,
      executed_by_governor_id TEXT NOT NULL REFERENCES users(id),
      tx_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      revoked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mqtt_messages (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      qos INTEGER DEFAULT 1,
      payload TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      latency_ms INTEGER DEFAULT 18,
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id),
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  seedInitialData();
}

function seedInitialData() {
  const existingUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (existingUsers.cnt > 0) return;

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

  const roles = [
    ['citizen', 'Citizen / Landowner', 'Submit applications, track titles, and view transaction history.'],
    ['surveyor', 'Licensed Surveyor', 'Perform GIS spatial validation, overlap analysis, and submit survey reports.'],
    ['registrar', 'Registrar of Titles', 'Review verified files, authorize registrations, mint NFTs, and approve transfers.'],
    ['land_admin', 'Land Administrator', 'Manage institutional land records, oracle reviews, and operational analytics.'],
    ['governor', 'Governor-Authorised Officer', 'Execute statutory Section 28 revocations under the Nigerian Land Use Act.'],
    ['sys_admin', 'System Administrator', 'Manage users, roles, permissions, system settings, and audit logs.'],
  ];
  const insertRole = db.prepare('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)');
  for (const r of roles) insertRole.run(...r);

  const permissions = [
    ['application:create', 'Land Registration', 'Create and submit land registration applications'],
    ['gis:verify', 'GIS Verification', 'Submit spatial verification reports'],
    ['oracle:verify', 'Ownership Oracle', 'Run and record institutional/community verification'],
    ['title:approve', 'Registrar', 'Approve registration and mint ERC-721 NFT titles'],
    ['title:transfer', 'Registrar', 'Authorize registry-controlled title transfers'],
    ['title:revoke', 'Statutory Revocation', 'Execute Section 28 Land Use Act revocations'],
    ['admin:manage', 'System Admin', 'Manage roles, settings, and run verification tests'],
  ];
  const insertPerm = db.prepare('INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)');
  for (const p of permissions) insertPerm.run(...p);

  const rolePermPairs: [string, string][] = [
    ['citizen', 'application:create'],
    ['surveyor', 'gis:verify'],
    ['land_admin', 'oracle:verify'],
    ['registrar', 'title:approve'],
    ['registrar', 'title:transfer'],
    ['registrar', 'oracle:verify'],
    ['governor', 'title:revoke'],
    ['sys_admin', 'admin:manage'],
    ['sys_admin', 'oracle:verify'],
  ];
  const insertRP = db.prepare('INSERT INTO role_permissions (role_code, permission_code) VALUES (?, ?)');
  for (const rp of rolePermPairs) insertRP.run(...rp);

  const defaultPassHash = bcrypt.hashSync('Anagu@2026!', 10);

  const users = [
    {
      id: 'usr-citizen-1',
      fullName: 'Chukwuemeka Okafor',
      email: 'citizen@anagu.ng',
      phone: '+234 803 412 8890',
      role: 'citizen',
      ninLast4: '4821',
      licenseNo: null,
      wallet: '0x71C9A4B2E10F9812D3C5A01948E3F2B049A11C01',
    },
    {
      id: 'usr-citizen-2',
      fullName: 'Amina Bello-Sadiq',
      email: 'amina.bello@anagu.ng',
      phone: '+234 809 772 1904',
      role: 'citizen',
      ninLast4: '9034',
      licenseNo: null,
      wallet: '0x82D1C5A049B712E8811C33F9480192A3D11B2002',
    },
    {
      id: 'usr-surveyor-1',
      fullName: 'Surv. Babatunde Adeyemi, FNIS',
      email: 'surveyor@anagu.ng',
      phone: '+234 802 661 3042',
      role: 'surveyor',
      ninLast4: '1175',
      licenseNo: 'SURCON-NG-4492',
      wallet: '0x94E2B1039C4410D9A112B394012948E1A33C3003',
    },
    {
      id: 'usr-registrar-1',
      fullName: 'Barr. Ngozi Ezeani',
      email: 'registrar@anagu.ng',
      phone: '+234 805 330 5511',
      role: 'registrar',
      ninLast4: '6620',
      licenseNo: 'NBA-SCN-08914',
      wallet: '0x33A49D120F884B109E44C12098A4F1029B44D4004',
    },
    {
      id: 'usr-landadmin-1',
      fullName: 'Ibrahim Musa Danjuma',
      email: 'landadmin@anagu.ng',
      phone: '+234 806 914 2208',
      role: 'land_admin',
      ninLast4: '3309',
      licenseNo: 'NITP-NG-2180',
      wallet: '0x55B81C904A112F490C33E8810924B1029C55E5005',
    },
    {
      id: 'usr-governor-1',
      fullName: 'Hon. Dr. Kayode Ogunleye (Governor Delegate)',
      email: 'governor@anagu.ng',
      phone: '+234 807 100 0028',
      role: 'governor',
      ninLast4: '7741',
      licenseNo: 'FCT-GOV-SEC28',
      wallet: '0x11F90C33A4128B994E102938A4B10294C66F6006',
    },
    {
      id: 'usr-sysadmin-1',
      fullName: 'Timothy Ugbe',
      email: 'sysadmin@anagu.ng',
      phone: '+234 812 504 7710',
      role: 'sys_admin',
      ninLast4: '5518',
      licenseNo: 'ANAGU-SYS-001',
      wallet: '0x99A10B22C33D44E55F66077188299300AA778007',
    },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, full_name, email, phone, password_hash, role_code, nin_last4, license_no, wallet_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const u of users) {
    insertUser.run(u.id, u.fullName, u.email, u.phone, defaultPassHash, u.role, u.ninLast4, u.licenseNo, u.wallet, daysAgo(45));
  }

  const insertOwner = db.prepare(`
    INSERT INTO landowners (id, user_id, full_name, id_type, id_number_hash, contact_address, state_name, lga_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOwner.run('own-1', 'usr-citizen-1', 'Chukwuemeka Okafor', 'NIN', sha256('NIN-4821-OKAFOR'), '14 Aguiyi Ironsi Street, Maitama, Abuja', 'FCT Abuja', 'AMAC', daysAgo(40));
  insertOwner.run('own-2', 'usr-citizen-2', 'Amina Bello-Sadiq', 'NIN', sha256('NIN-9034-BELLO'), '8 Ahmadu Bello Way, Victoria Island, Lagos', 'Lagos', 'Eti-Osa', daysAgo(35));

  // Seed 4 realistic Nigerian cadastral parcels (Abuja Maitama/Wuse II, Awka Anambra, Lagos Lekki)
  const seededParcels: Array<{
    id: string;
    ref: string;
    location: string;
    state: string;
    lga: string;
    zone: string;
    category: string;
    status: string;
    coords: LatLng[];
    days: number;
  }> = [
    {
      id: 'pcl-1',
      ref: 'NG-FCT-ABJ-2026-0001',
      location: 'Plot 104, Cadastral Zone A05, Maitama, Abuja',
      state: 'FCT Abuja',
      lga: 'AMAC',
      zone: 'Zone A05 Maitama',
      category: 'Certificate of Occupancy',
      status: 'Registered',
      coords: [
        [9.0842, 7.4912],
        [9.0842, 7.4926],
        [9.0831, 7.4926],
        [9.0831, 7.4912],
      ],
      days: 30,
    },
    {
      id: 'pcl-2',
      ref: 'NG-FCT-ABJ-2026-0002',
      location: 'Plot 218, Cadastral Zone A08, Wuse II, Abuja',
      state: 'FCT Abuja',
      lga: 'AMAC',
      zone: 'Zone A08 Wuse II',
      category: 'Statutory Right of Occupancy',
      status: 'Registered',
      coords: [
        [9.0772, 7.4795],
        [9.0772, 7.4809],
        [9.0761, 7.4809],
        [9.0761, 7.4795],
      ],
      days: 22,
    },
    {
      id: 'pcl-3',
      ref: 'NG-ANM-AWK-2026-0003',
      location: 'Plot 19, Udoka Housing Estate Phase II, Awka',
      state: 'Anambra',
      lga: 'Awka South',
      zone: 'Awka Capital Territory',
      category: 'Customary Right of Occupancy',
      status: 'Revoked',
      coords: [
        [6.2225, 7.0815],
        [6.2225, 7.0828],
        [6.2215, 7.0828],
        [6.2215, 7.0815],
      ],
      days: 18,
    },
    {
      id: 'pcl-4',
      ref: 'NG-FCT-ABJ-2026-0004',
      location: 'Plot 77, Cadastral Zone B06, Mabushi, Abuja',
      state: 'FCT Abuja',
      lga: 'AMAC',
      zone: 'Zone B06 Mabushi',
      category: 'Certificate of Occupancy',
      status: 'Pending',
      coords: [
        [9.0815, 7.4565],
        [9.0815, 7.4577],
        [9.0805, 7.4577],
        [9.0805, 7.4565],
      ],
      days: 4,
    },
    {
      id: 'pcl-5',
      ref: 'NG-FCT-ABJ-2026-0005',
      location: 'Plot 302, Cadastral Zone A05, Maitama Extension, Abuja',
      state: 'FCT Abuja',
      lga: 'AMAC',
      zone: 'Zone A05 Maitama',
      category: 'Deed of Assignment',
      status: 'Pending',
      coords: [
        [9.0885, 7.4945],
        [9.0885, 7.4958],
        [9.0875, 7.4958],
        [9.0875, 7.4945],
      ],
      days: 2,
    },
  ];

  const insertParcel = db.prepare(`
    INSERT INTO land_parcels (id, parcel_ref, location_text, state_name, lga_name, cadastral_zone, area_sqm, ownership_category, status, geo_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGeom = db.prepare(`
    INSERT INTO gis_geometries (id, parcel_id, coordinates_json, geojson_text, wkt_text, is_valid, validation_notes, centroid_lat, centroid_lng, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of seededParcels) {
    const gis = evaluateParcelGeometry(p.coords, []);
    insertParcel.run(
      p.id,
      p.ref,
      p.location,
      p.state,
      p.lga,
      p.zone,
      gis.areaSqm,
      p.category,
      p.status,
      gis.geoHash,
      daysAgo(p.days),
      daysAgo(p.days)
    );
    insertGeom.run(
      `geom-${p.id}`,
      p.id,
      JSON.stringify(p.coords),
      JSON.stringify(gis.geojson),
      gis.wkt,
      1,
      gis.validationReason,
      gis.centroid[0],
      gis.centroid[1],
      daysAgo(p.days)
    );
  }

  // Applications
  const insertApp = db.prepare(`
    INSERT INTO land_applications (
      id, application_ref, applicant_user_id, landowner_id, parcel_id, applicant_name,
      contact_email, contact_phone, id_details, land_location, state_name, lga_name,
      land_size_sqm, ownership_category, status, feedback, assigned_surveyor_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertApp.run(
    'app-1', 'APP-ANAGU-2026-1001', 'usr-citizen-1', 'own-1', 'pcl-1', 'Chukwuemeka Okafor',
    'citizen@anagu.ng', '+234 803 412 8890', 'NIN: ***-***-4821',
    'Plot 104, Cadastral Zone A05, Maitama, Abuja', 'FCT Abuja', 'AMAC', 18825,
    'Certificate of Occupancy', 'Approved', 'All GIS, institutional, and legal verifications passed. NFT Title issued.',
    'usr-surveyor-1', daysAgo(30), daysAgo(28)
  );
  insertApp.run(
    'app-2', 'APP-ANAGU-2026-1002', 'usr-citizen-2', 'own-2', 'pcl-2', 'Amina Bello-Sadiq',
    'amina.bello@anagu.ng', '+234 809 772 1904', 'NIN: ***-***-9034',
    'Plot 218, Cadastral Zone A08, Wuse II, Abuja', 'FCT Abuja', 'AMAC', 18828,
    'Statutory Right of Occupancy', 'Approved', 'Verified against AGIS records and registered on Hyperledger Besu.',
    'usr-surveyor-1', daysAgo(22), daysAgo(20)
  );
  insertApp.run(
    'app-3', 'APP-ANAGU-2026-1003', 'usr-citizen-1', 'own-1', 'pcl-3', 'Chukwuemeka Okafor',
    'citizen@anagu.ng', '+234 803 412 8890', 'NIN: ***-***-4821',
    'Plot 19, Udoka Housing Estate Phase II, Awka', 'Anambra', 'Awka South', 15950,
    'Customary Right of Occupancy', 'Approved', 'Initially approved; later revoked under Section 28(1) overriding public interest.',
    'usr-surveyor-1', daysAgo(18), daysAgo(10)
  );
  insertApp.run(
    'app-4', 'APP-ANAGU-2026-1004', 'usr-citizen-1', 'own-1', 'pcl-4', 'Chukwuemeka Okafor',
    'citizen@anagu.ng', '+234 803 412 8890', 'NIN: ***-***-4821',
    'Plot 77, Cadastral Zone B06, Mabushi, Abuja', 'FCT Abuja', 'AMAC', 14650,
    'Certificate of Occupancy', 'GIS verification pending', 'Submitted with survey plan; awaiting Surveyor boundary validation.',
    'usr-surveyor-1', daysAgo(4), daysAgo(3)
  );
  insertApp.run(
    'app-5', 'APP-ANAGU-2026-1005', 'usr-citizen-2', 'own-2', 'pcl-5', 'Amina Bello-Sadiq',
    'amina.bello@anagu.ng', '+234 809 772 1904', 'NIN: ***-***-9034',
    'Plot 302, Cadastral Zone A05, Maitama Extension, Abuja', 'FCT Abuja', 'AMAC', 15870,
    'Deed of Assignment', 'Legal review', 'GIS & Oracle verification completed; awaiting Registrar final approval.',
    'usr-surveyor-1', daysAgo(2), daysAgo(1)
  );

  // Documents
  const insertDoc = db.prepare(`
    INSERT INTO ownership_documents (id, application_id, doc_type, file_name, storage_key, sha256_hash, file_size_bytes, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDoc.run('doc-1', 'app-1', 'Certificate of Occupancy', 'CofO_Plot104_Maitama.pdf', 'minio://anagu-docs/app-1/cofo.pdf', sha256('COFO-104-OKAFOR-VERIFIED'), 482910, daysAgo(30));
  insertDoc.run('doc-2', 'app-1', 'Survey Plan', 'Beacon_Plan_FCT_A05_104.pdf', 'minio://anagu-docs/app-1/survey.pdf', sha256('SURVEY-104-OKAFOR'), 912340, daysAgo(30));
  insertDoc.run('doc-3', 'app-2', 'Statutory Right of Occupancy', 'RofO_Plot218_WuseII.pdf', 'minio://anagu-docs/app-2/rofo.pdf', sha256('ROFO-218-BELLO'), 512000, daysAgo(22));
  insertDoc.run('doc-4', 'app-4', 'Survey Plan', 'Mabushi_Plot77_Survey.pdf', 'minio://anagu-docs/app-4/survey.pdf', sha256('SURVEY-77-MABUSHI'), 740120, daysAgo(4));
  insertDoc.run('doc-5', 'app-5', 'Deed of Assignment', 'Deed_Plot302_MaitamaExt.pdf', 'minio://anagu-docs/app-5/deed.pdf', sha256('DEED-302-BELLO'), 615400, daysAgo(2));

  // Institutional & Community Records for Oracle
  const insertInst = db.prepare(`
    INSERT INTO institutional_records (id, record_ref, parcel_ref, registered_owner_name, id_last4, state_name, lga_name, title_instrument, encumbrance_status, verified_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertInst.run('inst-1', 'AGIS-REC-2026-104', 'NG-FCT-ABJ-2026-0001', 'Chukwuemeka Okafor', '4821', 'FCT Abuja', 'AMAC', 'Certificate of Occupancy', 'Clear', 'Abuja Geographic Information Systems (AGIS)');
  insertInst.run('inst-2', 'AGIS-REC-2026-218', 'NG-FCT-ABJ-2026-0002', 'Amina Bello-Sadiq', '9034', 'FCT Abuja', 'AMAC', 'Statutory Right of Occupancy', 'Clear', 'Abuja Geographic Information Systems (AGIS)');
  insertInst.run('inst-3', 'AGIS-REC-2026-077', 'NG-FCT-ABJ-2026-0004', 'Chukwuemeka Okafor', '4821', 'FCT Abuja', 'AMAC', 'Certificate of Occupancy', 'Clear', 'Abuja Geographic Information Systems (AGIS)');
  insertInst.run('inst-4', 'AGIS-REC-2026-302', 'NG-FCT-ABJ-2026-0005', 'Amina Bello-Sadiq', '9034', 'FCT Abuja', 'AMAC', 'Deed of Assignment', 'Clear', 'Abuja Geographic Information Systems (AGIS)');
  insertInst.run('inst-5', 'LASR-REC-2025-881', 'NG-LAG-ETI-2025-0881', 'Babajide Sanwo', '7712', 'Lagos', 'Eti-Osa', 'Governor Consent Deed', 'Mortgaged', 'Lagos State Land Registry');

  const insertComm = db.prepare(`
    INSERT INTO community_attestations (id, application_id, community_name, council_leader_name, claimant_name, attestation_status, notes, attested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertComm.run('comm-1', 'app-1', 'Maitama District Landowners Association', 'Chief Musa Garki', 'Chukwuemeka Okafor', 'Confirmed', 'Uncontested possession confirmed by district council.', daysAgo(29));
  insertComm.run('comm-2', 'app-2', 'Wuse II Urban Elders Forum', 'Alhaji Suleiman Tanko', 'Amina Bello-Sadiq', 'Confirmed', 'Boundary beacons verified by adjoining plot holders.', daysAgo(21));
  insertComm.run('comm-3', 'app-4', 'Mabushi Community Development Council', 'Hon. Danladi Bwari', 'Chukwuemeka Okafor', 'Confirmed', 'Community attestation logged; pending statutory GIS and institutional checks.', daysAgo(3));
  insertComm.run('comm-4', 'app-5', 'Maitama Extension Stakeholders', 'Chief Musa Garki', 'Amina Bello-Sadiq', 'Confirmed', 'Deed witnessed by family elders.', daysAgo(2));

  // Survey records
  const insertSurvey = db.prepare(`
    INSERT INTO survey_records (id, application_id, parcel_id, surveyor_id, st_is_valid, st_intersects, overlapping_parcel_refs, overlap_percentage, diagnostic_summary, approved, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSurvey.run('srv-1', 'app-1', 'pcl-1', 'usr-surveyor-1', 1, 0, '', 0, 'ST_IsValid = TRUE; zero spatial overlap across Abuja Zone A05.', 1, daysAgo(29));
  insertSurvey.run('srv-2', 'app-2', 'pcl-2', 'usr-surveyor-1', 1, 0, '', 0, 'ST_IsValid = TRUE; boundary beacons verified against Wuse II grid.', 1, daysAgo(21));
  insertSurvey.run('srv-3', 'app-5', 'pcl-5', 'usr-surveyor-1', 1, 0, '', 0, 'ST_IsValid = TRUE; clean Maitama Extension polygon.', 1, daysAgo(1));

  // Ownership verifications
  const insertVerif = db.prepare(`
    INSERT INTO ownership_verifications (id, application_id, outcome, institutional_status, community_status, conflict_details, reviewer_id, legal_review_notes, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVerif.run('ov-1', 'app-1', 'Successfully verified', 'Matched AGIS Record', 'Community Confirmed', null, 'usr-landadmin-1', 'Title chain verified.', daysAgo(28));
  insertVerif.run('ov-2', 'app-2', 'Successfully verified', 'Matched AGIS Record', 'Community Confirmed', null, 'usr-landadmin-1', 'Statutory R of O valid.', daysAgo(20));
  insertVerif.run('ov-3', 'app-5', 'Successfully verified', 'Matched AGIS Record', 'Community Confirmed', null, 'usr-landadmin-1', 'Ready for Registrar issuance.', daysAgo(1));

  // Blockchain Transactions + Registrations + NFT Titles + 1 Section 28 Revocation
  const registryAddr = '0x4B82E019C4A1D9920F118E4209A1B883C12D0001';
  const nftAddr = '0x9E31F884A201B773C109D44820E1A559D44E0721';

  const insertTx = db.prepare(`
    INSERT INTO blockchain_transactions (id, tx_hash, block_number, contract_name, contract_address, method_name, parcel_ref, initiator_user_id, event_name, event_payload, gas_used, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx1 = sha256('BESU-TX-1001-NG-FCT-ABJ-2026-0001');
  const tx2 = sha256('BESU-TX-1002-NG-FCT-ABJ-2026-0002');
  const tx3 = sha256('BESU-TX-1003-NG-ANM-AWK-2026-0003');
  const tx4 = sha256('BESU-TX-1004-REVOKE-NG-ANM-AWK-2026-0003');

  insertTx.run('btx-1', tx1, 10421, 'LandRegistry', registryAddr, 'registerParcel', 'NG-FCT-ABJ-2026-0001', 'usr-registrar-1', 'ParcelRegistered', JSON.stringify({ tokenId: 1001, parcelRef: 'NG-FCT-ABJ-2026-0001', ownerCommitment: sha256('usr-citizen-1:pcl-1') }), 184210, 'Confirmed', daysAgo(28));
  insertTx.run('btx-2', tx2, 10489, 'LandRegistry', registryAddr, 'registerParcel', 'NG-FCT-ABJ-2026-0002', 'usr-registrar-1', 'ParcelRegistered', JSON.stringify({ tokenId: 1002, parcelRef: 'NG-FCT-ABJ-2026-0002', ownerCommitment: sha256('usr-citizen-2:pcl-2') }), 183900, 'Confirmed', daysAgo(20));
  insertTx.run('btx-3', tx3, 10512, 'LandRegistry', registryAddr, 'registerParcel', 'NG-ANM-AWK-2026-0003', 'usr-registrar-1', 'ParcelRegistered', JSON.stringify({ tokenId: 1003, parcelRef: 'NG-ANM-AWK-2026-0003', ownerCommitment: sha256('usr-citizen-1:pcl-3') }), 185100, 'Confirmed', daysAgo(17));
  insertTx.run('btx-4', tx4, 10644, 'LandRegistry', registryAddr, 'revokeParcel', 'NG-ANM-AWK-2026-0003', 'usr-governor-1', 'ParcelRevoked', JSON.stringify({ tokenId: 1003, ground: 'Overriding public interest', gazetteRef: 'ANM-GAZ-2026-S28-04' }), 112400, 'Confirmed', daysAgo(10));

  const insertReg = db.prepare(`
    INSERT INTO registrations (id, application_id, parcel_id, registrar_id, blockchain_tx_id, registered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertReg.run('reg-1', 'app-1', 'pcl-1', 'usr-registrar-1', 'btx-1', daysAgo(28));
  insertReg.run('reg-2', 'app-2', 'pcl-2', 'usr-registrar-1', 'btx-2', daysAgo(20));
  insertReg.run('reg-3', 'app-3', 'pcl-3', 'usr-registrar-1', 'btx-3', daysAgo(17));

  const insertNft = db.prepare(`
    INSERT INTO nft_titles (id, title_number, token_id, parcel_id, owner_user_id, owner_name, owner_commitment_hash, tx_hash, status, issued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertNft.run('nft-1', 'ANAGU-CT-2026-0001', 1001, 'pcl-1', 'usr-citizen-1', 'Chukwuemeka Okafor', sha256('usr-citizen-1:pcl-1'), tx1, 'Active', daysAgo(28));
  insertNft.run('nft-2', 'ANAGU-CT-2026-0002', 1002, 'pcl-2', 'usr-citizen-2', 'Amina Bello-Sadiq', sha256('usr-citizen-2:pcl-2'), tx2, 'Active', daysAgo(20));
  insertNft.run('nft-3', 'ANAGU-CT-2026-0003', 1003, 'pcl-3', 'usr-citizen-1', 'Chukwuemeka Okafor', sha256('usr-citizen-1:pcl-3'), tx3, 'Revoked', daysAgo(17));

  const insertRev = db.prepare(`
    INSERT INTO revocation_requests (id, title_id, parcel_id, statutory_ground, gazette_order_ref, legal_justification, supporting_doc_hash, executed_by_governor_id, tx_hash, status, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRev.run(
    'rev-1',
    'nft-3',
    'pcl-3',
    'Overriding public interest',
    'ANM-GAZ-2026-S28-04',
    'Acquisition for Awka Regional Stormwater & Arterial Transit Corridor pursuant to Section 28(1) & (2)(b) of the Land Use Act.',
    sha256('GAZETTE-ANM-2026-S28-04'),
    'usr-governor-1',
    tx4,
    'Executed',
    daysAgo(10)
  );

  // Notifications & MQTT Messages & Audit Logs
  const insertNotif = db.prepare(`
    INSERT INTO notifications (id, user_id, title, message, category, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertNotif.run('ntf-1', 'usr-citizen-1', 'Digital Land Title Issued', 'Title ANAGU-CT-2026-0001 (Token #1001) has been issued for Plot 104, Maitama.', 'Title Issuance', 0, daysAgo(28));
  insertNotif.run('ntf-2', 'usr-citizen-1', 'Statutory Revocation Notice (Section 28)', 'Title ANAGU-CT-2026-0003 in Awka was statutorily revoked under Gazette ANM-GAZ-2026-S28-04.', 'Statutory Revocation', 0, daysAgo(10));
  insertNotif.run('ntf-3', 'usr-surveyor-1', 'New GIS Verification Assignment', 'Application APP-ANAGU-2026-1004 (Mabushi Plot 77) awaits spatial polygon check.', 'GIS Assignment', 0, daysAgo(3));
  insertNotif.run('ntf-4', 'usr-registrar-1', 'Application Ready for Approval', 'Application APP-ANAGU-2026-1005 passed GIS and Ownership Oracle review.', 'Registrar Queue', 0, daysAgo(1));

  const insertMqtt = db.prepare(`
    INSERT INTO mqtt_messages (id, topic, qos, payload, delivery_status, latency_ms, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertMqtt.run('mq-1', 'anagu/titles/issued', 1, JSON.stringify({ titleNumber: 'ANAGU-CT-2026-0001', tokenId: 1001, parcelRef: 'NG-FCT-ABJ-2026-0001' }), 'Acknowledged', 19, daysAgo(28));
  insertMqtt.run('mq-2', 'anagu/revocations/executed', 2, JSON.stringify({ titleNumber: 'ANAGU-CT-2026-0003', ground: 'Overriding public interest', gazetteRef: 'ANM-GAZ-2026-S28-04' }), 'Acknowledged', 24, daysAgo(10));
  insertMqtt.run('mq-3', 'anagu/applications/submitted', 1, JSON.stringify({ applicationRef: 'APP-ANAGU-2026-1004', state: 'FCT Abuja' }), 'Delivered', 16, daysAgo(3));

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run('aud-1', 'usr-registrar-1', 'registrar', 'TITLE_ISSUED', 'nft_title', 'ANAGU-CT-2026-0001', JSON.stringify({ tokenId: 1001, txHash: tx1 }), '10.24.8.14', daysAgo(28));
  insertAudit.run('aud-2', 'usr-governor-1', 'governor', 'STATUTORY_REVOCATION', 'nft_title', 'ANAGU-CT-2026-0003', JSON.stringify({ ground: 'Overriding public interest', gazette: 'ANM-GAZ-2026-S28-04' }), '10.24.0.2', daysAgo(10));
  insertAudit.run('aud-3', 'usr-surveyor-1', 'surveyor', 'GIS_VERIFICATION_PASSED', 'application', 'APP-ANAGU-2026-1005', JSON.stringify({ stIsValid: true, stIntersects: false }), '10.24.12.7', daysAgo(1));

  const insertSetting = db.prepare(`
    INSERT INTO system_settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  insertSetting.run('besu_chain_id', '1337', 'Hyperledger Besu IBFT 2.0 Network Chain ID', daysAgo(45));
  insertSetting.run('land_registry_contract', registryAddr, 'Deployed LandRegistry Smart Contract Address', daysAgo(45));
  insertSetting.run('land_title_nft_contract', nftAddr, 'Deployed LandTitleNFT ERC-721 Contract Address', daysAgo(45));
  insertSetting.run('max_overlap_tolerance_pct', '0.5', 'Maximum GIS boundary overlap tolerance percentage', daysAgo(45));
  insertSetting.run('mqtt_default_qos', '1', 'Default MQTT QoS level for registry events', daysAgo(45));
}
