import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, type Response } from 'express';
import { db, sha256 } from './db.ts';
import {
  AuthedRequest,
  requireAuth,
  requireRole,
  signToken,
  UserRole,
} from './auth.ts';
import { evaluateParcelGeometry, ExistingParcelGeometry, LatLng } from './gis.ts';
import {
  recordBesuParcelRegistration,
  recordBesuStatutoryRevocation,
  recordBesuTitleTransfer,
} from './blockchain.ts';
import {
  publishMqttEvent,
  registerMqttStreamClient,
  unregisterMqttStreamClient,
} from './mqtt.ts';
import { runAnaguVerificationSuite } from './tests/runTests.ts';
import { getSupabaseStatus } from './supabase.ts';

export const apiRouter = Router();

function logAudit(
  req: AuthedRequest,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>
) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud-${crypto.randomUUID().slice(0, 8)}`,
    req.user?.id || null,
    req.user?.role || 'public',
    action,
    targetType,
    targetId,
    JSON.stringify(details),
    req.ip || '127.0.0.1',
    new Date().toISOString()
  );
}

function getAllParcelsWithGeometry(): ExistingParcelGeometry[] {
  const rows = db
    .prepare(`
      SELECT p.id, p.parcel_ref, p.location_text, p.status, p.geo_hash, g.coordinates_json
      FROM land_parcels p
      JOIN gis_geometries g ON g.parcel_id = p.id
    `)
    .all() as Array<{
      id: string;
      parcel_ref: string;
      location_text: string;
      status: string;
      geo_hash: string;
      coordinates_json: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    parcelRef: r.parcel_ref,
    locationText: r.location_text,
    status: r.status,
    geoHash: r.geo_hash,
    coordinates: JSON.parse(r.coordinates_json) as LatLng[],
  }));
}

// ==========================================
// MODULE A: AUTHENTICATION & PROFILE
// ==========================================

apiRouter.post('/auth/register', (req, res) => {
  const { fullName, email, phone, password, ninLast4 } = req.body || {};
  if (!fullName || !email || !password) {
    res.status(400).json({ error: 'Full name, email, and password are required.' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = bcrypt.hashSync(String(password), 10);
  const walletAddress = '0x' + crypto.randomBytes(20).toString('hex').toUpperCase();
  const now = new Date().toISOString();

  // Public self-registration is strictly citizen role
  db.prepare(`
    INSERT INTO users (id, full_name, email, phone, password_hash, role_code, nin_last4, wallet_address, created_at)
    VALUES (?, ?, ?, ?, ?, 'citizen', ?, ?, ?)
  `).run(userId, String(fullName).trim(), normalizedEmail, phone || '+234 800 000 0000', passwordHash, ninLast4 || '0000', walletAddress, now);

  const authUser = {
    id: userId,
    fullName: String(fullName).trim(),
    email: normalizedEmail,
    role: 'citizen' as UserRole,
    walletAddress,
  };
  const token = signToken(authUser);

  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at)
    VALUES (?, ?, 'citizen', 'USER_REGISTERED', 'user', ?, ?, ?, ?)
  `).run(`aud-${crypto.randomUUID().slice(0, 8)}`, userId, userId, JSON.stringify({ email: normalizedEmail }), req.ip || '127.0.0.1', now);

  res.status(201).json({ token, user: authUser });
});

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const userRow = db
    .prepare('SELECT id, full_name, email, phone, password_hash, role_code, nin_last4, license_no, wallet_address, is_active FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase()) as
    | {
        id: string;
        full_name: string;
        email: string;
        phone: string;
        password_hash: string;
        role_code: UserRole;
        nin_last4: string | null;
        license_no: string | null;
        wallet_address: string;
        is_active: number;
      }
    | undefined;

  if (!userRow || !bcrypt.compareSync(String(password), userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (!userRow.is_active) {
    res.status(403).json({ error: 'Account is suspended. Contact System Administrator.' });
    return;
  }

  const authUser = {
    id: userRow.id,
    fullName: userRow.full_name,
    email: userRow.email,
    role: userRow.role_code,
    walletAddress: userRow.wallet_address,
  };

  const token = signToken(authUser);

  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at)
    VALUES (?, ?, ?, 'USER_LOGIN', 'user', ?, ?, ?, ?)
  `).run(
    `aud-${crypto.randomUUID().slice(0, 8)}`,
    userRow.id,
    userRow.role_code,
    userRow.id,
    JSON.stringify({ email: userRow.email }),
    req.ip || '127.0.0.1',
    new Date().toISOString()
  );

  res.json({
    token,
    user: {
      ...authUser,
      phone: userRow.phone,
      ninLast4: userRow.nin_last4,
      licenseNo: userRow.license_no,
    },
  });
});

apiRouter.post('/auth/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  const userRow = db
    .prepare('SELECT id, email FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase()) as { id: string; email: string } | undefined;

  if (!userRow) {
    res.json({ message: 'If an account exists for that email, a reset token has been generated.' });
    return;
  }

  const resetToken = `ANAGU-RST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (id, user_id, token, expires_at, used, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(`rst-${crypto.randomUUID().slice(0, 8)}`, userRow.id, resetToken, expiresAt, new Date().toISOString());

  res.json({
    message: 'Password reset token issued. Enter it on the reset screen to update your password.',
    resetTokenPreview: resetToken,
    expiresAt,
  });
});

apiRouter.post('/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || String(newPassword).length < 6) {
    res.status(400).json({ error: 'Valid reset token and new password (min 6 chars) are required.' });
    return;
  }

  const row = db
    .prepare('SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ?')
    .get(String(token).trim()) as { id: string; user_id: string; expires_at: string; used: number } | undefined;

  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired password reset token.' });
    return;
  }

  const newHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, row.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);

  res.json({ message: 'Password updated successfully. You may now sign in.' });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const row = db
    .prepare('SELECT id, full_name, email, phone, role_code, nin_last4, license_no, wallet_address, created_at FROM users WHERE id = ?')
    .get(req.user!.id) as Record<string, unknown>;
  res.json({ user: row });
});

apiRouter.patch('/auth/profile', requireAuth, (req: AuthedRequest, res) => {
  const { fullName, phone } = req.body || {};
  if (!fullName) {
    res.status(400).json({ error: 'Full name cannot be empty.' });
    return;
  }
  db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(
    String(fullName).trim(),
    String(phone || '').trim(),
    req.user!.id
  );
  logAudit(req, 'PROFILE_UPDATED', 'user', req.user!.id, { fullName });
  res.json({ message: 'Profile updated successfully.' });
});

// Public QR / Title verification endpoint (never exposes NIN or private contact details)
apiRouter.get('/titles/verify/:identifier', (req, res) => {
  const idParam = String(req.params.identifier).trim();
  const row = db
    .prepare(`
      SELECT t.title_number, t.token_id, t.owner_name, t.tx_hash, t.status, t.issued_at,
             p.parcel_ref, p.location_text, p.state_name, p.lga_name, p.area_sqm, p.ownership_category,
             r.statutory_ground, r.gazette_order_ref, r.revoked_at
      FROM nft_titles t
      JOIN land_parcels p ON p.id = t.parcel_id
      LEFT JOIN revocation_requests r ON r.title_id = t.id
      WHERE t.title_number = ? OR p.parcel_ref = ? OR CAST(t.token_id AS TEXT) = ?
    `)
    .get(idParam, idParam, idParam);

  if (!row) {
    res.status(404).json({ error: 'No matching ANAGU Digital Land Title found for that identifier.' });
    return;
  }
  res.json({ title: row });
});

// ==========================================
// MODULE B: DASHBOARD & SUMMARY
// ==========================================

apiRouter.get('/dashboard/summary', requireAuth, (_req: AuthedRequest, res) => {
  const parcelCount = (db.prepare('SELECT COUNT(*) as c FROM land_parcels WHERE status = ?').get('Registered') as { c: number }).c;
  const landownerCount = (db.prepare('SELECT COUNT(DISTINCT owner_user_id) as c FROM nft_titles').get() as { c: number }).c;
  const appStats = db.prepare(`
    SELECT status, COUNT(*) as count FROM land_applications GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  const pendingCount = appStats
    .filter((s) => !['Approved', 'Rejected', 'Cancelled', 'Draft'].includes(s.status))
    .reduce((acc, s) => acc + s.count, 0);
  const approvedCount = appStats.find((s) => s.status === 'Approved')?.count || 0;
  const rejectedCount = appStats.find((s) => s.status === 'Rejected')?.count || 0;
  const revokedCount = (db.prepare('SELECT COUNT(*) as c FROM nft_titles WHERE status = ?').get('Revoked') as { c: number }).c;

  const recentTransactions = db
    .prepare(`
      SELECT bt.*, u.full_name as initiator_name
      FROM blockchain_transactions bt
      LEFT JOIN users u ON u.id = bt.initiator_user_id
      ORDER BY bt.block_number DESC LIMIT 6
    `)
    .all();

  const recentActivities = db
    .prepare(`
      SELECT al.*, u.full_name as actor_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      ORDER BY al.created_at DESC LIMIT 8
    `)
    .all();

  const verificationStats = db
    .prepare('SELECT outcome, COUNT(*) as count FROM ownership_verifications GROUP BY outcome')
    .all();

  const surveyStats = db
    .prepare('SELECT approved, COUNT(*) as count FROM survey_records GROUP BY approved')
    .all();

  res.json({
    kpis: {
      totalRegisteredParcels: parcelCount,
      totalLandowners: landownerCount,
      pendingApplications: pendingCount,
      approvedApplications: approvedCount,
      rejectedApplications: rejectedCount,
      revokedTitles: revokedCount,
    },
    appStatusBreakdown: appStats,
    verificationStats,
    surveyStats,
    recentTransactions,
    recentActivities,
  });
});

// ==========================================
// MODULE C: LAND REGISTRATION
// ==========================================

apiRouter.get('/applications', requireAuth, (req: AuthedRequest, res) => {
  const isCitizen = req.user!.role === 'citizen';
  const rows = db
    .prepare(`
      SELECT a.*, p.parcel_ref, p.status as parcel_status,
             g.coordinates_json, g.centroid_lat, g.centroid_lng, g.is_valid as gis_is_valid,
             ov.outcome as oracle_outcome, ov.institutional_status, ov.community_status, ov.legal_review_notes
      FROM land_applications a
      LEFT JOIN land_parcels p ON p.id = a.parcel_id
      LEFT JOIN gis_geometries g ON g.parcel_id = p.id
      LEFT JOIN ownership_verifications ov ON ov.application_id = a.id
      ${isCitizen ? 'WHERE a.applicant_user_id = ?' : ''}
      ORDER BY a.updated_at DESC
    `)
    .all(...(isCitizen ? [req.user!.id] : [])) as Array<Record<string, unknown>>;

  const docsStmt = db.prepare('SELECT * FROM ownership_documents WHERE application_id = ?');
  const enriched = rows.map((row) => ({
    ...row,
    coordinates: row.coordinates_json ? JSON.parse(String(row.coordinates_json)) : [],
    documents: docsStmt.all(row.id),
  }));

  res.json({ applications: enriched });
});

apiRouter.post('/applications', requireAuth, (req: AuthedRequest, res) => {
  const {
    applicantName,
    contactEmail,
    contactPhone,
    idDetails,
    landLocation,
    stateName,
    lgaName,
    cadastralZone,
    landSizeSqm,
    ownershipCategory,
    coordinates,
    submitNow,
    documents,
  } = req.body || {};

  if (!landLocation || !stateName || !lgaName || !ownershipCategory) {
    res.status(400).json({ error: 'Land location, state, LGA, and ownership category are required.' });
    return;
  }

  const coords: LatLng[] = Array.isArray(coordinates) ? coordinates : [];
  if (coords.length < 3) {
    res.status(400).json({ error: 'At least 3 geographical boundary coordinates [lat, lng] are required.' });
    return;
  }

  const existingParcels = getAllParcelsWithGeometry();
  const gisCheck = evaluateParcelGeometry(coords, existingParcels);

  const now = new Date().toISOString();
  const appId = `app-${crypto.randomUUID().slice(0, 8)}`;
  const parcelId = `pcl-${crypto.randomUUID().slice(0, 8)}`;
  const seq = Math.floor(1000 + Math.random() * 9000);
  const stateCode = String(stateName).slice(0, 3).toUpperCase();
  const lgaCode = String(lgaName).slice(0, 3).toUpperCase();
  const appRef = `APP-ANAGU-2026-${seq}`;
  const parcelRef = `NG-${stateCode}-${lgaCode}-2026-${seq}`;

  const status = submitNow ? 'GIS verification pending' : 'Draft';
  const parcelStatus = submitNow ? 'Pending' : 'Draft';

  db.prepare(`
    INSERT INTO land_parcels (id, parcel_ref, location_text, state_name, lga_name, cadastral_zone, area_sqm, ownership_category, status, geo_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parcelId,
    parcelRef,
    String(landLocation).trim(),
    String(stateName).trim(),
    String(lgaName).trim(),
    cadastralZone || `${lgaName} Zone`,
    gisCheck.areaSqm || Number(landSizeSqm) || 0,
    String(ownershipCategory),
    parcelStatus,
    gisCheck.geoHash || sha256(parcelRef),
    now,
    now
  );

  db.prepare(`
    INSERT INTO gis_geometries (id, parcel_id, coordinates_json, geojson_text, wkt_text, is_valid, validation_notes, centroid_lat, centroid_lng, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `geom-${crypto.randomUUID().slice(0, 8)}`,
    parcelId,
    JSON.stringify(coords),
    JSON.stringify(gisCheck.geojson),
    gisCheck.wkt,
    gisCheck.stIsValid ? 1 : 0,
    gisCheck.validationReason,
    gisCheck.centroid[0],
    gisCheck.centroid[1],
    now
  );

  db.prepare(`
    INSERT INTO land_applications (
      id, application_ref, applicant_user_id, parcel_id, applicant_name, contact_email,
      contact_phone, id_details, land_location, state_name, lga_name, land_size_sqm,
      ownership_category, status, feedback, assigned_surveyor_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    appId,
    appRef,
    req.user!.id,
    parcelId,
    applicantName || req.user!.fullName,
    contactEmail || req.user!.email,
    contactPhone || '+234 800 000 0000',
    idDetails || 'NIN Verified',
    String(landLocation).trim(),
    String(stateName).trim(),
    String(lgaName).trim(),
    gisCheck.areaSqm || Number(landSizeSqm) || 0,
    String(ownershipCategory),
    status,
    submitNow
      ? 'Application submitted. Assigned for Surveyor GIS spatial verification.'
      : 'Saved as draft. Complete supporting documents and submit when ready.',
    'usr-surveyor-1',
    now,
    now
  );

  // Attach any submitted documents & check SHA-256 duplicate/forgery collision
  let docHashAlert = false;
  if (Array.isArray(documents)) {
    const insertDoc = db.prepare(`
      INSERT INTO ownership_documents (id, application_id, doc_type, file_name, storage_key, sha256_hash, file_size_bytes, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const doc of documents) {
      const hash = doc.sha256Hash || sha256(`${doc.fileName}:${doc.docType}:${appId}`);
      const reused = db
        .prepare('SELECT application_id FROM ownership_documents WHERE sha256_hash = ? AND application_id != ?')
        .get(hash, appId);
      if (reused) docHashAlert = true;

      insertDoc.run(
        `doc-${crypto.randomUUID().slice(0, 8)}`,
        appId,
        doc.docType || 'Supporting Deed',
        doc.fileName || 'document.pdf',
        `minio://anagu-docs/${appId}/${doc.fileName || 'doc.pdf'}`,
        hash,
        Number(doc.fileSizeBytes) || 245000,
        now
      );
    }
  }

  logAudit(req, submitNow ? 'APPLICATION_SUBMITTED' : 'APPLICATION_DRAFT_SAVED', 'application', appRef, {
    parcelRef,
    stIsValid: gisCheck.stIsValid,
    stIntersects: gisCheck.stIntersects,
    docHashAlert,
  });

  if (submitNow) {
    publishMqttEvent({
      topic: 'anagu/applications/submitted',
      qos: 1,
      payload: { applicationRef: appRef, parcelRef, stateName, lgaName },
      notifyUserIds: ['usr-surveyor-1', req.user!.id],
      notificationTitle: 'Land Application Submitted',
      notificationMessage: `Application ${appRef} (${landLocation}) has entered GIS verification queue.`,
      notificationCategory: 'Application Lifecycle',
    });
  }

  res.status(201).json({
    application: { id: appId, applicationRef: appRef, parcelRef, status },
    gisPreview: gisCheck,
    docHashAlert,
  });
});

apiRouter.post('/applications/:id/documents', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const { docType, fileName, sha256Hash, fileSizeBytes } = req.body || {};
  const app = db.prepare('SELECT * FROM land_applications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!app) {
    res.status(404).json({ error: 'Application not found.' });
    return;
  }
  if (req.user!.role === 'citizen' && app.applicant_user_id !== req.user!.id) {
    res.status(403).json({ error: 'You may only upload documents to your own applications.' });
    return;
  }

  const hash = sha256Hash || sha256(`${fileName}:${Date.now()}`);
  const duplicate = db
    .prepare('SELECT application_id FROM ownership_documents WHERE sha256_hash = ? AND application_id != ?')
    .get(hash, id) as { application_id: string } | undefined;

  const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ownership_documents (id, application_id, doc_type, file_name, storage_key, sha256_hash, file_size_bytes, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    docId,
    id,
    docType || 'Ownership Evidence',
    fileName || 'supporting_document.pdf',
    `minio://anagu-docs/${id}/${fileName || 'doc.pdf'}`,
    hash,
    Number(fileSizeBytes) || 180000,
    now
  );

  logAudit(req, 'DOCUMENT_UPLOADED', 'document', docId, { applicationId: id, duplicateDetected: Boolean(duplicate) });
  res.status(201).json({
    documentId: docId,
    sha256Hash: hash,
    duplicateDetected: Boolean(duplicate),
    warning: duplicate ? 'SHA-256 fingerprint matches a document already submitted on another application.' : null,
  });
});

apiRouter.post('/applications/:id/submit', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const { coordinates, landLocation, feedback } = req.body || {};
  const app = db.prepare('SELECT * FROM land_applications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!app) {
    res.status(404).json({ error: 'Application not found.' });
    return;
  }
  if (req.user!.role === 'citizen' && app.applicant_user_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  const now = new Date().toISOString();
  if (Array.isArray(coordinates) && coordinates.length >= 3 && app.parcel_id) {
    const existingParcels = getAllParcelsWithGeometry();
    const gisCheck = evaluateParcelGeometry(coordinates, existingParcels, String(app.parcel_id));
    db.prepare(`
      UPDATE gis_geometries
      SET coordinates_json = ?, geojson_text = ?, wkt_text = ?, is_valid = ?, validation_notes = ?, centroid_lat = ?, centroid_lng = ?
      WHERE parcel_id = ?
    `).run(
      JSON.stringify(coordinates),
      JSON.stringify(gisCheck.geojson),
      gisCheck.wkt,
      gisCheck.stIsValid ? 1 : 0,
      gisCheck.validationReason,
      gisCheck.centroid[0],
      gisCheck.centroid[1],
      app.parcel_id
    );
    db.prepare('UPDATE land_parcels SET area_sqm = ?, geo_hash = ?, status = ?, updated_at = ? WHERE id = ?').run(
      gisCheck.areaSqm,
      gisCheck.geoHash,
      'Pending',
      now,
      app.parcel_id
    );
  } else if (app.parcel_id) {
    db.prepare('UPDATE land_parcels SET status = ?, updated_at = ? WHERE id = ?').run('Pending', now, app.parcel_id);
  }

  db.prepare(`
    UPDATE land_applications
    SET status = 'GIS verification pending',
        land_location = COALESCE(?, land_location),
        feedback = COALESCE(?, 'Submitted for GIS spatial verification.'),
        updated_at = ?
    WHERE id = ?
  `).run(landLocation || null, feedback || null, now, id);

  publishMqttEvent({
    topic: 'anagu/applications/submitted',
    qos: 1,
    payload: { applicationRef: app.application_ref },
    notifyUserIds: ['usr-surveyor-1', String(app.applicant_user_id)],
    notificationTitle: 'Application Ready for Survey',
    notificationMessage: `${app.application_ref} has been submitted for GIS spatial check.`,
    notificationCategory: 'Application Lifecycle',
  });

  res.json({ message: 'Application submitted for GIS verification.' });
});

apiRouter.post('/applications/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const app = db.prepare('SELECT * FROM land_applications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!app) {
    res.status(404).json({ error: 'Application not found.' });
    return;
  }
  if (req.user!.role === 'citizen' && app.applicant_user_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  if (app.status === 'Approved') {
    res.status(400).json({ error: 'Approved applications cannot be cancelled; only statutory revocation applies.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE land_applications SET status = 'Cancelled', feedback = 'Cancelled by applicant.', updated_at = ? WHERE id = ?").run(now, id);
  if (app.parcel_id) {
    db.prepare("UPDATE land_parcels SET status = 'Cancelled', updated_at = ? WHERE id = ?").run(now, app.parcel_id);
  }
  logAudit(req, 'APPLICATION_CANCELLED', 'application', String(app.application_ref), {});
  res.json({ message: 'Application cancelled.' });
});

// ==========================================
// MODULE D: GIS LAND VERIFICATION
// ==========================================

apiRouter.get('/parcels', requireAuth, (_req, res) => {
  const parcels = db
    .prepare(`
      SELECT p.*, g.coordinates_json, g.wkt_text, g.is_valid, g.validation_notes, g.centroid_lat, g.centroid_lng,
             t.title_number, t.token_id, t.owner_name, t.status as title_status
      FROM land_parcels p
      JOIN gis_geometries g ON g.parcel_id = p.id
      LEFT JOIN nft_titles t ON t.parcel_id = p.id
      ORDER BY p.created_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  res.json({
    parcels: parcels.map((p) => ({
      ...p,
      coordinates: JSON.parse(String(p.coordinates_json)),
    })),
  });
});

apiRouter.post('/gis/validate', requireAuth, (req, res) => {
  const { coordinates, excludeParcelId } = req.body || {};
  if (!Array.isArray(coordinates)) {
    res.status(400).json({ error: 'coordinates array [[lat, lng], ...] is required.' });
    return;
  }
  const existing = getAllParcelsWithGeometry();
  const result = evaluateParcelGeometry(coordinates, existing, excludeParcelId);
  res.json({ result });
});

apiRouter.post('/gis/verify/:applicationId', requireAuth, requireRole('surveyor'), (req: AuthedRequest, res) => {
  const { applicationId } = req.params;
  const { approved, diagnosticNotes } = req.body || {};

  const app = db
    .prepare(`
      SELECT a.*, p.id as pid, p.parcel_ref, g.coordinates_json
      FROM land_applications a
      JOIN land_parcels p ON p.id = a.parcel_id
      JOIN gis_geometries g ON g.parcel_id = p.id
      WHERE a.id = ?
    `)
    .get(applicationId) as Record<string, unknown> | undefined;

  if (!app) {
    res.status(404).json({ error: 'Application or parcel geometry not found.' });
    return;
  }

  const coords = JSON.parse(String(app.coordinates_json)) as LatLng[];
  const existing = getAllParcelsWithGeometry();
  const gisCheck = evaluateParcelGeometry(coords, existing, String(app.pid));

  if (approved && (!gisCheck.stIsValid || gisCheck.stIntersects || gisCheck.duplicateGeoClaim)) {
    res.status(400).json({
      error: 'Cannot approve GIS verification: parcel geometry failed ST_IsValid or overlaps existing registered land.',
      gisCheck,
    });
    return;
  }

  const now = new Date().toISOString();
  const surveyId = `srv-${crypto.randomUUID().slice(0, 8)}`;
  const summary = diagnosticNotes || gisCheck.diagnostics.join(' ');

  db.prepare(`
    INSERT INTO survey_records (
      id, application_id, parcel_id, surveyor_id, st_is_valid, st_intersects,
      overlapping_parcel_refs, overlap_percentage, diagnostic_summary, approved, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    surveyId,
    applicationId,
    app.pid,
    req.user!.id,
    gisCheck.stIsValid ? 1 : 0,
    gisCheck.stIntersects ? 1 : 0,
    gisCheck.overlappingParcels.map((o) => o.parcelRef).join(', '),
    gisCheck.overlappingParcels[0]?.overlapEstimatePct || 0,
    summary,
    approved ? 1 : 0,
    now
  );

  const nextStatus = approved ? 'Ownership verification pending' : 'Under review';
  const feedbackMsg = approved
    ? `Surveyor verified geometry (${gisCheck.areaSqm.toLocaleString()} m²). Forwarded to Ownership Verification Oracle.`
    : `GIS verification flagged issues: ${summary}`;

  db.prepare('UPDATE land_applications SET status = ?, feedback = ?, updated_at = ? WHERE id = ?').run(
    nextStatus,
    feedbackMsg,
    now,
    applicationId
  );

  logAudit(req, approved ? 'GIS_VERIFICATION_PASSED' : 'GIS_VERIFICATION_FLAGGED', 'application', String(app.application_ref), {
    stIsValid: gisCheck.stIsValid,
    stIntersects: gisCheck.stIntersects,
    overlapCount: gisCheck.overlappingParcels.length,
  });

  publishMqttEvent({
    topic: 'anagu/verification/gis',
    qos: 1,
    payload: { applicationRef: app.application_ref, approved, stIsValid: gisCheck.stIsValid, stIntersects: gisCheck.stIntersects },
    notifyUserIds: [String(app.applicant_user_id), 'usr-landadmin-1'],
    notificationTitle: approved ? 'GIS Spatial Verification Passed' : 'GIS Spatial Conflict Flagged',
    notificationMessage: feedbackMsg,
    notificationCategory: 'GIS Verification',
  });

  res.json({ surveyId, gisCheck, nextStatus });
});

// ==========================================
// MODULE E: OWNERSHIP VERIFICATION ORACLE
// ==========================================

apiRouter.get('/oracle/records', requireAuth, (_req, res) => {
  const institutionalRecords = db.prepare('SELECT * FROM institutional_records').all();
  const communityAttestations = db.prepare('SELECT * FROM community_attestations ORDER BY attested_at DESC').all();
  const verifications = db
    .prepare(`
      SELECT ov.*, a.application_ref, a.applicant_name, a.land_location, u.full_name as reviewer_name
      FROM ownership_verifications ov
      JOIN land_applications a ON a.id = ov.application_id
      LEFT JOIN users u ON u.id = ov.reviewer_id
      ORDER BY ov.verified_at DESC
    `)
    .all();

  res.json({ institutionalRecords, communityAttestations, verifications });
});

apiRouter.post(
  '/oracle/verify/:applicationId',
  requireAuth,
  requireRole('land_admin', 'registrar', 'sys_admin'),
  (req: AuthedRequest, res) => {
    const { applicationId } = req.params;
    const { institutionalMatchOverride, communityConfirmed, communityLeader, communityName, legalReviewNotes } = req.body || {};

    const app = db
      .prepare(`
        SELECT a.*, p.parcel_ref
        FROM land_applications a
        LEFT JOIN land_parcels p ON p.id = a.parcel_id
        WHERE a.id = ?
      `)
      .get(applicationId) as Record<string, unknown> | undefined;

    if (!app) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const docs = db
      .prepare('SELECT * FROM ownership_documents WHERE application_id = ?')
      .all(applicationId) as Array<{ sha256_hash: string }>;

    // Check for duplicate/forged document hash across other applications
    let docCollision = false;
    for (const d of docs) {
      const reused = db
        .prepare('SELECT id FROM ownership_documents WHERE sha256_hash = ? AND application_id != ?')
        .get(d.sha256_hash, applicationId);
      if (reused) docCollision = true;
    }

    // Match against institutional records
    const instMatches = db
      .prepare('SELECT * FROM institutional_records WHERE state_name = ? AND lga_name = ?')
      .all(app.state_name, app.lga_name) as Array<{
        record_ref: string;
        parcel_ref: string | null;
        registered_owner_name: string;
        encumbrance_status: string;
      }>;

    const exactParcelConflict = instMatches.find(
      (r) =>
        r.parcel_ref === app.parcel_ref &&
        r.registered_owner_name.toLowerCase() !== String(app.applicant_name).toLowerCase()
    );

    const ownerMatchedInst =
      institutionalMatchOverride === true ||
      instMatches.some(
        (r) => r.registered_owner_name.toLowerCase() === String(app.applicant_name).toLowerCase()
      );

    // Record community attestation if provided
    const now = new Date().toISOString();
    if (communityLeader || communityName) {
      db.prepare(`
        INSERT INTO community_attestations (id, application_id, community_name, council_leader_name, claimant_name, attestation_status, notes, attested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `comm-${crypto.randomUUID().slice(0, 8)}`,
        applicationId,
        communityName || `${app.lga_name} Land Council`,
        communityLeader || 'Traditional Council Representative',
        app.applicant_name,
        communityConfirmed ? 'Confirmed' : 'Pending',
        legalReviewNotes || 'Recorded during Oracle verification.',
        now
      );
    }

    // Determine exact outcome (community approval alone NEVER establishes legal ownership)
    let outcome = 'Successfully verified';
    let institutionalStatus = ownerMatchedInst ? 'Matched Institutional Registry' : 'Unmatched Institutional Record';
    const communityStatus = communityConfirmed ? 'Community Confirmed' : 'Community Pending';
    let conflictDetails: string | null = null;
    let nextAppStatus = 'Legal review';

    if (docCollision) {
      outcome = 'Ownership information conflict';
      institutionalStatus = 'Document Hash Anomaly';
      conflictDetails = 'Uploaded document SHA-256 hash matches a separate application record (potential duplicate/forged instrument).';
      nextAppStatus = 'Under review';
    } else if (exactParcelConflict) {
      outcome = 'Ownership information conflict';
      institutionalStatus = 'Owner Mismatch Conflict';
      conflictDetails = `Institutional record ${exactParcelConflict.record_ref} lists '${exactParcelConflict.registered_owner_name}', conflicting with applicant '${app.applicant_name}'.`;
      nextAppStatus = 'Under review';
    } else if (docs.length === 0) {
      outcome = 'Incomplete supporting documents';
      nextAppStatus = 'Under review';
      conflictDetails = 'No ownership deeds or survey plans attached.';
    } else if (!ownerMatchedInst) {
      // Even if communityConfirmed is true, statutory institutional verification is still required!
      outcome = 'Legal verification pending';
      nextAppStatus = 'Legal review';
      conflictDetails = communityConfirmed
        ? 'Community attestation recorded; awaiting statutory institutional clearance (community approval alone does not establish legal title).'
        : 'Awaiting institutional and community title chain verification.';
    }

    const verifId = `ov-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare('DELETE FROM ownership_verifications WHERE application_id = ?').run(applicationId);
    db.prepare(`
      INSERT INTO ownership_verifications (id, application_id, outcome, institutional_status, community_status, conflict_details, reviewer_id, legal_review_notes, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      verifId,
      applicationId,
      outcome,
      institutionalStatus,
      communityStatus,
      conflictDetails,
      req.user!.id,
      legalReviewNotes || `Oracle check completed by ${req.user!.fullName}.`,
      now
    );

    db.prepare('UPDATE land_applications SET status = ?, feedback = ?, updated_at = ? WHERE id = ?').run(
      nextAppStatus,
      conflictDetails || `Ownership Oracle outcome: ${outcome}. Forwarded for Registrar decision.`,
      now,
      applicationId
    );

    logAudit(req, 'ORACLE_VERIFICATION_EXECUTED', 'application', String(app.application_ref), {
      outcome,
      institutionalStatus,
      communityStatus,
    });

    publishMqttEvent({
      topic: 'anagu/verification/oracle',
      qos: 1,
      payload: { applicationRef: app.application_ref, outcome, institutionalStatus, communityStatus },
      notifyUserIds: [String(app.applicant_user_id), 'usr-registrar-1'],
      notificationTitle: `Ownership Oracle: ${outcome}`,
      notificationMessage: `Application ${app.application_ref} Oracle result: ${outcome}.`,
      notificationCategory: 'Ownership Verification',
    });

    res.json({
      verification: { id: verifId, outcome, institutionalStatus, communityStatus, conflictDetails },
      nextAppStatus,
    });
  }
);

// ==========================================
// MODULE F & G: REGISTRAR APPROVAL, BESU TX & ERC-721 NFT TITLES
// ==========================================

apiRouter.post(
  '/registrar/decision/:applicationId',
  requireAuth,
  requireRole('registrar'),
  (req: AuthedRequest, res) => {
    const { applicationId } = req.params;
    const { decision, notes } = req.body || {};
    if (!['approve', 'reject', 'request_correction'].includes(decision)) {
      res.status(400).json({ error: 'decision must be approve, reject, or request_correction.' });
      return;
    }

    const app = db
      .prepare(`
        SELECT a.*, p.id as pid, p.parcel_ref, p.geo_hash, p.status as parcel_status
        FROM land_applications a
        JOIN land_parcels p ON p.id = a.parcel_id
        WHERE a.id = ?
      `)
      .get(applicationId) as Record<string, unknown> | undefined;

    if (!app) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const now = new Date().toISOString();

    if (decision === 'reject' || decision === 'request_correction') {
      const nextStatus = decision === 'reject' ? 'Rejected' : 'Under review';
      db.prepare('UPDATE land_applications SET status = ?, feedback = ?, updated_at = ? WHERE id = ?').run(
        nextStatus,
        notes || (decision === 'reject' ? 'Application rejected by Registrar.' : 'Returned to applicant for correction.'),
        now,
        applicationId
      );
      if (decision === 'reject') {
        db.prepare("UPDATE land_parcels SET status = 'Rejected', updated_at = ? WHERE id = ?").run(now, app.pid);
      }

      logAudit(req, decision === 'reject' ? 'APPLICATION_REJECTED' : 'CORRECTION_REQUESTED', 'application', String(app.application_ref), { notes });
      publishMqttEvent({
        topic: 'anagu/applications/decision',
        qos: 1,
        payload: { applicationRef: app.application_ref, status: nextStatus },
        notifyUserIds: [String(app.applicant_user_id)],
        notificationTitle: `Application ${nextStatus}`,
        notificationMessage: `${app.application_ref}: ${notes || nextStatus}`,
        notificationCategory: 'Registrar Decision',
      });

      res.json({ status: nextStatus });
      return;
    }

    // Approve & Mint ERC-721 NFT on Hyperledger Besu
    const docs = db
      .prepare('SELECT sha256_hash FROM ownership_documents WHERE application_id = ?')
      .all(applicationId) as Array<{ sha256_hash: string }>;
    const merkleRoot = sha256(docs.map((d) => d.sha256_hash).join('|') || String(app.application_ref));

    try {
      const besuRes = recordBesuParcelRegistration({
        parcelRef: String(app.parcel_ref),
        parcelId: String(app.pid),
        ownerUserId: String(app.applicant_user_id),
        geoHash: String(app.geo_hash),
        documentMerkleRoot: merkleRoot,
        registrarUserId: req.user!.id,
        registrarRole: req.user!.role,
      });

      const titleNumber = `ANAGU-CT-2026-${String(besuRes.tokenId).padStart(4, '0')}`;
      const nftId = `nft-${crypto.randomUUID().slice(0, 8)}`;

      db.prepare(`
        INSERT INTO registrations (id, application_id, parcel_id, registrar_id, blockchain_tx_id, registered_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`reg-${crypto.randomUUID().slice(0, 8)}`, applicationId, app.pid, req.user!.id, besuRes.txId, now);

      db.prepare(`
        INSERT INTO nft_titles (id, title_number, token_id, parcel_id, owner_user_id, owner_name, owner_commitment_hash, tx_hash, status, issued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
      `).run(
        nftId,
        titleNumber,
        besuRes.tokenId,
        app.pid,
        app.applicant_user_id,
        app.applicant_name,
        besuRes.ownerCommitment,
        besuRes.txHash,
        now
      );

      db.prepare("UPDATE land_parcels SET status = 'Registered', updated_at = ? WHERE id = ?").run(now, app.pid);
      db.prepare("UPDATE land_applications SET status = 'Approved', feedback = ?, updated_at = ? WHERE id = ?").run(
        notes || `Approved by Registrar. Digital Land Title ${titleNumber} (Token #${besuRes.tokenId}) issued.`,
        now,
        applicationId
      );

      logAudit(req, 'TITLE_ISSUED', 'nft_title', titleNumber, {
        tokenId: besuRes.tokenId,
        parcelRef: app.parcel_ref,
        txHash: besuRes.txHash,
      });

      publishMqttEvent({
        topic: 'anagu/titles/issued',
        qos: 2,
        payload: {
          titleNumber,
          tokenId: besuRes.tokenId,
          parcelRef: app.parcel_ref,
          txHash: besuRes.txHash,
        },
        notifyUserIds: [String(app.applicant_user_id)],
        notificationTitle: 'Digital Land Title Issued',
        notificationMessage: `Congratulations! Title ${titleNumber} (NFT #${besuRes.tokenId}) has been issued for ${app.land_location}.`,
        notificationCategory: 'Title Issuance',
      });

      res.json({
        status: 'Approved',
        titleNumber,
        tokenId: besuRes.tokenId,
        txHash: besuRes.txHash,
        blockNumber: besuRes.blockNumber,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Blockchain registration failed.' });
    }
  }
);

apiRouter.get('/titles', requireAuth, (req: AuthedRequest, res) => {
  const isCitizen = req.user!.role === 'citizen';
  const titles = db
    .prepare(`
      SELECT t.*, p.parcel_ref, p.location_text, p.state_name, p.lga_name, p.area_sqm, p.ownership_category,
             g.coordinates_json, r.statutory_ground, r.gazette_order_ref, r.revoked_at
      FROM nft_titles t
      JOIN land_parcels p ON p.id = t.parcel_id
      JOIN gis_geometries g ON g.parcel_id = p.id
      LEFT JOIN revocation_requests r ON r.title_id = t.id
      ${isCitizen ? 'WHERE t.owner_user_id = ?' : ''}
      ORDER BY t.issued_at DESC
    `)
    .all(...(isCitizen ? [req.user!.id] : []));

  const transfers = db
    .prepare(`
      SELECT tt.*, u1.full_name as from_name, u2.full_name as to_name, ur.full_name as registrar_name
      FROM title_transfers tt
      JOIN users u1 ON u1.id = tt.from_user_id
      JOIN users u2 ON u2.id = tt.to_user_id
      JOIN users ur ON ur.id = tt.authorized_by_registrar_id
      ORDER BY tt.transferred_at DESC
    `)
    .all();

  const eligibleRecipients = db
    .prepare("SELECT id, full_name, email FROM users WHERE role_code = 'citizen' AND is_active = 1")
    .all();

  res.json({ titles, transfers, eligibleRecipients });
});

apiRouter.post('/titles/:id/transfer', requireAuth, requireRole('registrar'), (req: AuthedRequest, res) => {
  const { id } = req.params;
  const { newOwnerUserId, considerationNgn } = req.body || {};
  if (!newOwnerUserId) {
    res.status(400).json({ error: 'Recipient owner user ID is required.' });
    return;
  }

  const title = db
    .prepare(`
      SELECT t.*, p.parcel_ref
      FROM nft_titles t
      JOIN land_parcels p ON p.id = t.parcel_id
      WHERE t.id = ?
    `)
    .get(id) as Record<string, unknown> | undefined;

  if (!title) {
    res.status(404).json({ error: 'NFT Land Title not found.' });
    return;
  }

  const recipient = db
    .prepare('SELECT id, full_name FROM users WHERE id = ?')
    .get(newOwnerUserId) as { id: string; full_name: string } | undefined;
  if (!recipient) {
    res.status(404).json({ error: 'Recipient user not found.' });
    return;
  }

  try {
    const txRes = recordBesuTitleTransfer({
      titleId: String(title.id),
      parcelRef: String(title.parcel_ref),
      parcelId: String(title.parcel_id),
      tokenId: Number(title.token_id),
      titleStatus: String(title.status),
      newOwnerUserId: recipient.id,
      registrarUserId: req.user!.id,
      registrarRole: req.user!.role,
    });

    const now = new Date().toISOString();
    const prevOwnerId = String(title.owner_user_id);

    db.prepare(`
      INSERT INTO title_transfers (id, title_id, from_user_id, to_user_id, authorized_by_registrar_id, consideration_ngn, tx_hash, transferred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `trf-${crypto.randomUUID().slice(0, 8)}`,
      title.id,
      prevOwnerId,
      recipient.id,
      req.user!.id,
      Number(considerationNgn) || 0,
      txRes.txHash,
      now
    );

    db.prepare('UPDATE nft_titles SET owner_user_id = ?, owner_name = ?, owner_commitment_hash = ?, tx_hash = ? WHERE id = ?').run(
      recipient.id,
      recipient.full_name,
      txRes.newCommitment,
      txRes.txHash,
      title.id
    );

    logAudit(req, 'OWNERSHIP_TRANSFERRED', 'nft_title', String(title.title_number), {
      fromUserId: prevOwnerId,
      toUserId: recipient.id,
      txHash: txRes.txHash,
    });

    publishMqttEvent({
      topic: 'anagu/titles/transferred',
      qos: 2,
      payload: { titleNumber: title.title_number, toOwner: recipient.full_name, txHash: txRes.txHash },
      notifyUserIds: [prevOwnerId, recipient.id],
      notificationTitle: 'Title Ownership Transferred',
      notificationMessage: `Title ${title.title_number} has been lawfully transferred to ${recipient.full_name}.`,
      notificationCategory: 'Title Transfer',
    });

    res.json({ message: 'Title ownership transferred.', txHash: txRes.txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Transfer rejected by smart contract.' });
  }
});

// ==========================================
// MODULE H: STATUTORY REVOCATION (SECTION 28)
// ==========================================

apiRouter.get('/revocations', requireAuth, (_req, res) => {
  const revocations = db
    .prepare(`
      SELECT r.*, t.title_number, t.token_id, t.owner_name, p.parcel_ref, p.location_text, p.state_name,
             u.full_name as governor_name
      FROM revocation_requests r
      JOIN nft_titles t ON t.id = r.title_id
      JOIN land_parcels p ON p.id = r.parcel_id
      JOIN users u ON u.id = r.executed_by_governor_id
      ORDER BY r.revoked_at DESC
    `)
    .all();
  res.json({ revocations });
});

apiRouter.post('/revocations', requireAuth, requireRole('governor'), (req: AuthedRequest, res) => {
  const { titleId, statutoryGround, gazetteOrderRef, legalJustification, supportingDocRef } = req.body || {};

  if (!titleId || !statutoryGround || !gazetteOrderRef || !legalJustification) {
    res.status(400).json({
      error: 'titleId, statutoryGround (Section 28), gazetteOrderRef, and legalJustification are required.',
    });
    return;
  }

  if (
    statutoryGround !== 'Overriding public interest' &&
    statutoryGround !== 'Breach of statutory conditions'
  ) {
    res.status(400).json({
      error:
        'Statutory revocation is strictly restricted to Section 28 grounds: "Overriding public interest" or "Breach of statutory conditions". Ordinary ownership disputes must be routed through the Ownership Oracle.',
    });
    return;
  }

  const title = db
    .prepare(`
      SELECT t.*, p.parcel_ref, p.location_text
      FROM nft_titles t
      JOIN land_parcels p ON p.id = t.parcel_id
      WHERE t.id = ?
    `)
    .get(titleId) as Record<string, unknown> | undefined;

  if (!title) {
    res.status(404).json({ error: 'Title not found.' });
    return;
  }

  try {
    const txRes = recordBesuStatutoryRevocation({
      parcelRef: String(title.parcel_ref),
      tokenId: Number(title.token_id),
      currentStatus: String(title.status),
      ground: statutoryGround,
      gazetteOrderRef: String(gazetteOrderRef).trim(),
      governorUserId: req.user!.id,
      governorRole: req.user!.role,
    });

    const now = new Date().toISOString();
    const revId = `rev-${crypto.randomUUID().slice(0, 8)}`;
    const docHash = sha256(supportingDocRef || `${gazetteOrderRef}:${now}`);

    db.prepare(`
      INSERT INTO revocation_requests (
        id, title_id, parcel_id, statutory_ground, gazette_order_ref, legal_justification,
        supporting_doc_hash, executed_by_governor_id, tx_hash, status, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Executed', ?)
    `).run(
      revId,
      title.id,
      title.parcel_id,
      statutoryGround,
      String(gazetteOrderRef).trim(),
      String(legalJustification).trim(),
      docHash,
      req.user!.id,
      txRes.txHash,
      now
    );

    db.prepare("UPDATE nft_titles SET status = 'Revoked' WHERE id = ?").run(title.id);
    db.prepare("UPDATE land_parcels SET status = 'Revoked', updated_at = ? WHERE id = ?").run(now, title.parcel_id);

    logAudit(req, 'STATUTORY_REVOCATION', 'nft_title', String(title.title_number), {
      ground: statutoryGround,
      gazetteOrderRef,
      txHash: txRes.txHash,
    });

    publishMqttEvent({
      topic: 'anagu/revocations/executed',
      qos: 2,
      payload: {
        titleNumber: title.title_number,
        parcelRef: title.parcel_ref,
        ground: statutoryGround,
        gazetteOrderRef,
        txHash: txRes.txHash,
      },
      notifyUserIds: [String(title.owner_user_id), 'usr-registrar-1', 'usr-landadmin-1'],
      notificationTitle: 'Statutory Title Revocation Notice (Section 28)',
      notificationMessage: `Title ${title.title_number} (${title.location_text}) was statutorily revoked under ${statutoryGround} (Gazette ${gazetteOrderRef}).`,
      notificationCategory: 'Statutory Revocation',
    });

    res.status(201).json({
      revocationId: revId,
      txHash: txRes.txHash,
      blockNumber: txRes.blockNumber,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Revocation failed.' });
  }
});

// ==========================================
// MODULE I: MQTT STREAM, NOTIFICATIONS & OFFLINE SYNC
// ==========================================

apiRouter.get('/mqtt/stream', requireAuth, (req: AuthedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = registerMqttStreamClient(req.user!.id, res);
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, broker: 'ANAGU-MQTT-Bridge' })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unregisterMqttStreamClient(clientId);
  });
});

apiRouter.get('/mqtt/messages', requireAuth, (_req, res) => {
  const messages = db.prepare('SELECT * FROM mqtt_messages ORDER BY published_at DESC LIMIT 60').all();
  res.json({ messages });
});

apiRouter.post('/mqtt/ack/:id', requireAuth, (req, res) => {
  db.prepare("UPDATE mqtt_messages SET delivery_status = 'Acknowledged' WHERE id = ?").run(req.params.id);
  res.json({ acknowledged: true });
});

apiRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
    .all(req.user!.id);
  res.json({ notifications: rows });
});

apiRouter.post('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

apiRouter.post('/sync/batch', requireAuth, (req: AuthedRequest, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items array is required.' });
    return;
  }

  const synced: Array<{ id: string; status: string; detail: string }> = [];
  const existingParcels = getAllParcelsWithGeometry();
  const now = new Date().toISOString();

  for (const item of items) {
    if (item.type === 'application' && item.payload) {
      const p = item.payload;
      const coords: LatLng[] = Array.isArray(p.coordinates) ? p.coordinates : [];
      const gisCheck = evaluateParcelGeometry(coords, existingParcels);
      const appId = `app-${crypto.randomUUID().slice(0, 8)}`;
      const parcelId = `pcl-${crypto.randomUUID().slice(0, 8)}`;
      const seq = Math.floor(1000 + Math.random() * 9000);
      const appRef = `APP-ANAGU-2026-${seq}`;
      const parcelRef = `NG-SYNC-${seq}`;

      db.prepare(`
        INSERT INTO land_parcels (id, parcel_ref, location_text, state_name, lga_name, cadastral_zone, area_sqm, ownership_category, status, geo_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)
      `).run(
        parcelId,
        parcelRef,
        p.landLocation || 'Offline Synced Parcel',
        p.stateName || 'FCT Abuja',
        p.lgaName || 'AMAC',
        'Offline Sync',
        gisCheck.areaSqm || Number(p.landSizeSqm) || 0,
        p.ownershipCategory || 'Certificate of Occupancy',
        gisCheck.geoHash || sha256(parcelRef),
        now,
        now
      );

      db.prepare(`
        INSERT INTO gis_geometries (id, parcel_id, coordinates_json, geojson_text, wkt_text, is_valid, validation_notes, centroid_lat, centroid_lng, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `geom-${crypto.randomUUID().slice(0, 8)}`,
        parcelId,
        JSON.stringify(coords),
        JSON.stringify(gisCheck.geojson),
        gisCheck.wkt,
        gisCheck.stIsValid ? 1 : 0,
        gisCheck.validationReason,
        gisCheck.centroid[0],
        gisCheck.centroid[1],
        now
      );

      db.prepare(`
        INSERT INTO land_applications (
          id, application_ref, applicant_user_id, parcel_id, applicant_name, contact_email,
          contact_phone, id_details, land_location, state_name, lga_name, land_size_sqm,
          ownership_category, status, feedback, assigned_surveyor_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GIS verification pending', ?, 'usr-surveyor-1', ?, ?)
      `).run(
        appId,
        appRef,
        req.user!.id,
        parcelId,
        p.applicantName || req.user!.fullName,
        req.user!.email,
        p.contactPhone || '+234 800 000 0000',
        p.idDetails || 'NIN Verified',
        p.landLocation || 'Offline Synced Parcel',
        p.stateName || 'FCT Abuja',
        p.lgaName || 'AMAC',
        gisCheck.areaSqm || Number(p.landSizeSqm) || 0,
        p.ownershipCategory || 'Certificate of Occupancy',
        `Synchronised from offline queue (queued ${item.queuedAt}).`,
        now,
        now
      );

      synced.push({ id: item.id, status: 'Synced', detail: `Created ${appRef}` });
    }
  }

  publishMqttEvent({
    topic: 'anagu/sync/reconnected',
    qos: 1,
    payload: { userId: req.user!.id, syncedCount: synced.length },
    notifyUserIds: [req.user!.id],
    notificationTitle: 'Offline Queue Synchronised',
    notificationMessage: `${synced.length} offline submission(s) successfully synced upon reconnection.`,
    notificationCategory: 'Offline Sync',
  });

  res.json({ synced });
});

// ==========================================
// MODULE J: BLOCKCHAIN EXPLORER & AUDIT LOGS
// ==========================================

apiRouter.get('/blockchain/transactions', requireAuth, (_req, res) => {
  const transactions = db
    .prepare(`
      SELECT bt.*, u.full_name as initiator_name, u.role_code as initiator_role
      FROM blockchain_transactions bt
      LEFT JOIN users u ON u.id = bt.initiator_user_id
      ORDER BY bt.block_number DESC
    `)
    .all();
  res.json({ transactions });
});

apiRouter.get('/audit-logs', requireAuth, requireRole('land_admin', 'sys_admin', 'registrar', 'governor'), (_req, res) => {
  const logs = db
    .prepare(`
      SELECT al.*, u.full_name as actor_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      ORDER BY al.created_at DESC LIMIT 120
    `)
    .all();
  res.json({ logs });
});

// ==========================================
// MODULE K: REPORTS & ANALYTICS
// ==========================================

apiRouter.get('/reports/analytics', requireAuth, (_req, res) => {
  const applicationsByState = db
    .prepare('SELECT state_name, COUNT(*) as count FROM land_applications GROUP BY state_name')
    .all();
  const applicationsByCategory = db
    .prepare('SELECT ownership_category, COUNT(*) as count FROM land_applications GROUP BY ownership_category')
    .all();
  const gisOutcomes = db
    .prepare('SELECT st_is_valid, st_intersects, approved, COUNT(*) as count FROM survey_records GROUP BY st_is_valid, st_intersects, approved')
    .all();
  const oracleOutcomes = db
    .prepare('SELECT outcome, COUNT(*) as count FROM ownership_verifications GROUP BY outcome')
    .all();
  const mqttMetrics = db
    .prepare('SELECT delivery_status, COUNT(*) as count, AVG(latency_ms) as avg_latency FROM mqtt_messages GROUP BY delivery_status')
    .all();
  const totalDocsBytes = (db.prepare('SELECT COALESCE(SUM(file_size_bytes), 0) as bytes FROM ownership_documents').get() as { bytes: number }).bytes;
  const txCount = (db.prepare('SELECT COUNT(*) as c FROM blockchain_transactions').get() as { c: number }).c;
  const blockedSecurityEvents = (db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'UNAUTHORIZED_ACCESS_BLOCKED'").get() as { c: number }).c;

  res.json({
    applicationsByState,
    applicationsByCategory,
    gisOutcomes,
    oracleOutcomes,
    mqttMetrics,
    storageComparison: {
      offChainMinioBytes: totalDocsBytes,
      onChainCommitmentBytes: txCount * 256,
      savingsPct: totalDocsBytes > 0 ? Number((100 - ((txCount * 256) / totalDocsBytes) * 100).toFixed(2)) : 99.9,
    },
    securitySummary: {
      blockedUnauthorizedAttempts: blockedSecurityEvents,
      blockchainTransactionsConfirmed: txCount,
    },
  });
});

apiRouter.get('/reports/export', requireAuth, (req, res) => {
  const rows = db
    .prepare(`
      SELECT a.application_ref, a.applicant_name, a.state_name, a.lga_name, a.land_location,
             a.land_size_sqm, a.ownership_category, a.status, p.parcel_ref, t.title_number, t.token_id
      FROM land_applications a
      LEFT JOIN land_parcels p ON p.id = a.parcel_id
      LEFT JOIN nft_titles t ON t.parcel_id = p.id
      ORDER BY a.created_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  const headers = [
    'Application Ref',
    'Applicant Name',
    'State',
    'LGA',
    'Location',
    'Area (sqm)',
    'Ownership Category',
    'Application Status',
    'Parcel Ref',
    'Title Number',
    'NFT Token ID',
  ];
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.application_ref,
        r.applicant_name,
        r.state_name,
        r.lga_name,
        r.land_location,
        r.land_size_sqm,
        r.ownership_category,
        r.status,
        r.parcel_ref || '',
        r.title_number || '',
        r.token_id || '',
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="anagu-land-registry-report.csv"');
  res.send(csvLines.join('\n'));
});

// ==========================================
// SYSTEM ADMIN: USERS, SETTINGS & AUTOMATED TEST RUNNER
// ==========================================

apiRouter.get('/admin/users', requireAuth, requireRole('sys_admin'), (_req, res) => {
  const users = db
    .prepare('SELECT id, full_name, email, phone, role_code, license_no, wallet_address, is_active, created_at FROM users ORDER BY created_at ASC')
    .all();
  const roles = db.prepare('SELECT * FROM roles').all();
  const rolePermissions = db
    .prepare(`
      SELECT rp.role_code, p.code as permission_code, p.module, p.description
      FROM role_permissions rp
      JOIN permissions p ON p.code = rp.permission_code
    `)
    .all();

  res.json({ users, roles, rolePermissions });
});

apiRouter.patch('/admin/users/:id/role', requireAuth, requireRole('sys_admin'), (req: AuthedRequest, res) => {
  const { roleCode, isActive } = req.body || {};
  const validRole = db.prepare('SELECT code FROM roles WHERE code = ?').get(roleCode);
  if (!validRole) {
    res.status(400).json({ error: 'Invalid role code.' });
    return;
  }
  db.prepare('UPDATE users SET role_code = ?, is_active = COALESCE(?, is_active) WHERE id = ?').run(
    roleCode,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
    req.params.id
  );
  logAudit(req, 'USER_ROLE_UPDATED', 'user', req.params.id, { roleCode, isActive });
  res.json({ message: 'User role updated.' });
});

apiRouter.get('/admin/settings', requireAuth, requireRole('sys_admin', 'land_admin'), (_req, res) => {
  const settings = db.prepare('SELECT * FROM system_settings').all();
  res.json({ settings });
});

apiRouter.patch('/admin/settings', requireAuth, requireRole('sys_admin'), (req: AuthedRequest, res) => {
  const { key, value } = req.body || {};
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required.' });
    return;
  }
  db.prepare('UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?').run(
    String(value),
    new Date().toISOString(),
    String(key)
  );
  logAudit(req, 'SYSTEM_SETTING_UPDATED', 'setting', String(key), { value });
  res.json({ message: 'System setting updated.' });
});

apiRouter.post('/tests/run', requireAuth, requireRole('sys_admin'), (req: AuthedRequest, res) => {
  const summary = runAnaguVerificationSuite();
  logAudit(req, 'VERIFICATION_SUITE_EXECUTED', 'system', 'test-suite', {
    passed: summary.passed,
    total: summary.total,
  });
  res.json({ summary });
});

apiRouter.get('/supabase/status', requireAuth, requireRole('sys_admin', 'land_admin'), async (_req, res) => {
  const status = await getSupabaseStatus();
  res.json({ supabase: status });
});

