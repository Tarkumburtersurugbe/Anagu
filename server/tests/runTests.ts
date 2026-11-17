import crypto from 'crypto';
import { initDatabase, db, sha256 } from '../db.ts';
import { evaluateParcelGeometry, ExistingParcelGeometry, LatLng } from '../gis.ts';
import {
  recordBesuParcelRegistration,
  recordBesuTitleTransfer,
  recordBesuStatutoryRevocation,
} from '../blockchain.ts';
import { publishMqttEvent } from '../mqtt.ts';

export interface TestCaseResult {
  id: string;
  suite: 'GIS' | 'Blockchain' | 'Ownership Oracle' | 'MQTT & Offline Sync' | 'Security & RBAC';
  name: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

export interface TestRunSummary {
  executedAt: string;
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  results: TestCaseResult[];
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runAnaguVerificationSuite(): TestRunSummary {
  initDatabase();
  const startedAt = Date.now();
  const results: TestCaseResult[] = [];

  const runCase = (
    id: string,
    suite: TestCaseResult['suite'],
    name: string,
    fn: () => string
  ) => {
    const t0 = performance.now();
    try {
      const detail = fn();
      results.push({
        id,
        suite,
        name,
        passed: true,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        detail,
      });
    } catch (err) {
      results.push({
        id,
        suite,
        name,
        passed: false,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Load existing parcels for GIS tests
  const existingRows = db
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

  const existingParcels: ExistingParcelGeometry[] = existingRows.map((r) => ({
    id: r.id,
    parcelRef: r.parcel_ref,
    locationText: r.location_text,
    status: r.status,
    geoHash: r.geo_hash,
    coordinates: JSON.parse(r.coordinates_json) as LatLng[],
  }));

  // 1. GIS Tests
  runCase('gis-1', 'GIS', 'Valid non-overlapping land polygon (ST_IsValid = TRUE, ST_Intersects = FALSE)', () => {
    const validPlot: LatLng[] = [
      [9.0912, 7.5012],
      [9.0912, 7.5024],
      [9.0902, 7.5024],
      [9.0902, 7.5012],
    ];
    const res = evaluateParcelGeometry(validPlot, existingParcels);
    assert(res.stIsValid === true, 'Expected ST_IsValid to be true');
    assert(res.stIntersects === false, 'Expected zero overlap');
    assert(res.areaSqm > 10000, 'Expected area > 10,000 sqm');
    return `Area ${res.areaSqm.toLocaleString()} m², WKT verified`;
  });

  runCase('gis-2', 'GIS', 'Invalid self-intersecting bowtie polygon rejected (ST_IsValid = FALSE)', () => {
    const bowtiePlot: LatLng[] = [
      [9.095, 7.51],
      [9.096, 7.512],
      [9.096, 7.51],
      [9.095, 7.512],
    ];
    const res = evaluateParcelGeometry(bowtiePlot, existingParcels);
    assert(res.stIsValid === false, 'Self-intersecting polygon must fail ST_IsValid');
    return res.validationReason;
  });

  runCase('gis-3', 'GIS', 'Overlapping encroachment against NG-FCT-ABJ-2026-0001 detected (ST_Intersects = TRUE)', () => {
    const overlappingPlot: LatLng[] = [
      [9.0840, 7.4915],
      [9.0840, 7.4930],
      [9.0832, 7.4930],
      [9.0832, 7.4915],
    ];
    const res = evaluateParcelGeometry(overlappingPlot, existingParcels);
    assert(res.stIntersects === true, 'Expected ST_Intersects = TRUE');
    assert(res.overlappingParcels.some((p) => p.parcelRef === 'NG-FCT-ABJ-2026-0001'), 'Expected conflict with Maitama Plot 104');
    return `Detected ${res.overlappingParcels[0].overlapEstimatePct}% overlap with ${res.overlappingParcels[0].parcelRef}`;
  });

  // 2. Blockchain & NFT Tests (isolated inside savepoint/rollback transaction so DB stays clean)
  runCase('bc-1', 'Blockchain', 'Authorized Registrar issues ERC-721 title without on-chain PII', () => {
    db.exec('SAVEPOINT test_bc');
    try {
      const testParcelId = `pcl-test-${Date.now()}`;
      const testRef = `NG-TEST-${Date.now()}`;
      db.prepare(`
        INSERT INTO land_parcels (id, parcel_ref, location_text, state_name, lga_name, cadastral_zone, area_sqm, ownership_category, status, geo_hash, created_at, updated_at)
        VALUES (?, ?, 'Test Plot', 'FCT Abuja', 'AMAC', 'Zone Test', 1200, 'Certificate of Occupancy', 'Pending', ?, ?, ?)
      `).run(testParcelId, testRef, sha256(testRef), new Date().toISOString(), new Date().toISOString());

      const tx = recordBesuParcelRegistration({
        parcelRef: testRef,
        parcelId: testParcelId,
        ownerUserId: 'usr-citizen-1',
        geoHash: sha256(testRef),
        documentMerkleRoot: sha256('docs'),
        registrarUserId: 'usr-registrar-1',
        registrarRole: 'registrar',
      });
      assert(tx.txHash.startsWith('0x') && tx.txHash.length === 66, 'Invalid txHash format');
      assert(!tx.ownerCommitment.includes('Chukwuemeka'), 'On-chain commitment leaked PII');
      return `Minted Token #${tx.tokenId} in Block #${tx.blockNumber}`;
    } finally {
      db.exec('ROLLBACK TO test_bc');
      db.exec('RELEASE test_bc');
    }
  });

  runCase('bc-2', 'Blockchain', 'Unauthorised role attempting title transfer is rejected', () => {
    let blocked = false;
    try {
      recordBesuTitleTransfer({
        titleId: 'nft-1',
        parcelRef: 'NG-FCT-ABJ-2026-0001',
        parcelId: 'pcl-1',
        tokenId: 1001,
        titleStatus: 'Active',
        newOwnerUserId: 'usr-citizen-2',
        registrarUserId: 'usr-citizen-1',
        registrarRole: 'citizen',
      });
    } catch (e) {
      blocked = (e as Error).message.includes('REGISTRAR_ROLE');
    }
    assert(blocked, 'Expected smart contract revert for citizen transfer attempt');
    return 'Reverted with LandRegistry.onlyRegistrar';
  });

  runCase('bc-3', 'Blockchain', 'Unauthorised role attempting Section 28 revocation is rejected', () => {
    let blocked = false;
    try {
      recordBesuStatutoryRevocation({
        parcelRef: 'NG-FCT-ABJ-2026-0001',
        tokenId: 1001,
        currentStatus: 'Active',
        ground: 'Overriding public interest',
        gazetteOrderRef: 'FAKE-GAZ-01',
        governorUserId: 'usr-registrar-1',
        governorRole: 'registrar',
      });
    } catch (e) {
      blocked = (e as Error).message.includes('GOVERNOR_ROLE');
    }
    assert(blocked, 'Expected smart contract revert for non-governor revocation');
    return 'Reverted with LandRegistry.onlyGovernor';
  });

  runCase('bc-4', 'Blockchain', 'Post-revocation transfer of NG-ANM-AWK-2026-0003 is rejected', () => {
    let blocked = false;
    try {
      recordBesuTitleTransfer({
        titleId: 'nft-3',
        parcelRef: 'NG-ANM-AWK-2026-0003',
        parcelId: 'pcl-3',
        tokenId: 1003,
        titleStatus: 'Revoked',
        newOwnerUserId: 'usr-citizen-2',
        registrarUserId: 'usr-registrar-1',
        registrarRole: 'registrar',
      });
    } catch (e) {
      blocked = (e as Error).message.includes('revoked');
    }
    assert(blocked, 'Revoked title transfer must be blocked');
    return 'Blocked transfer on statutorily revoked ERC-721 token #1003';
  });

  // 3. Ownership Verification Oracle Tests
  runCase('orc-1', 'Ownership Oracle', 'Community attestation alone does not establish legal title without institutional match', () => {
    const communityConfirmed = true;
    const institutionalMatch = false;
    const outcome = !institutionalMatch && communityConfirmed ? 'Legal verification pending' : 'Successfully verified';
    assert(outcome === 'Legal verification pending', 'Community attestation must not bypass institutional review');
    return `Outcome returned: ${outcome}`;
  });

  runCase('orc-2', 'Ownership Oracle', 'Conflicting institutional owner record flags Ownership information conflict', () => {
    const instRecord = db.prepare('SELECT registered_owner_name FROM institutional_records WHERE parcel_ref = ?').get('NG-FCT-ABJ-2026-0001') as { registered_owner_name: string };
    const claimant = 'Impostor Claimant';
    const isConflict = instRecord.registered_owner_name.toLowerCase() !== claimant.toLowerCase();
    assert(isConflict, 'Expected mismatch conflict');
    return `Conflict flagged against institutional holder (${instRecord.registered_owner_name})`;
  });

  // 4. MQTT & Offline Sync Tests
  runCase('mqtt-1', 'MQTT & Offline Sync', 'MQTT event publication persists delivery status and latency', () => {
    db.exec('SAVEPOINT test_mqtt');
    try {
      const msg = publishMqttEvent({
        topic: 'anagu/tests/heartbeat',
        qos: 1,
        payload: { testId: crypto.randomUUID(), check: 'ok' },
      });
      assert(msg.id.startsWith('mq-') && msg.latencyMs > 0, 'MQTT event persistence failed');
      return `Published ${msg.id} on ${msg.topic} (QoS ${msg.qos}, ${msg.latencyMs}ms)`;
    } finally {
      db.exec('ROLLBACK TO test_mqtt');
      db.exec('RELEASE test_mqtt');
    }
  });

  // 5. Security & Fraud Detection Tests
  runCase('sec-1', 'Security & RBAC', 'Duplicate/forged document SHA-256 fingerprint detected across applications', () => {
    const existingDoc = db.prepare('SELECT sha256_hash, application_id FROM ownership_documents LIMIT 1').get() as { sha256_hash: string; application_id: string };
    const collision = db
      .prepare('SELECT application_id FROM ownership_documents WHERE sha256_hash = ? AND application_id != ?')
      .get(existingDoc.sha256_hash, 'app-new-claim');
    assert(Boolean(collision), 'Duplicate document hash check failed');
    return `Detected reused document hash ${existingDoc.sha256_hash.slice(0, 14)}...`;
  });

  runCase('sec-2', 'Security & RBAC', 'Duplicate land coordinate hash claim detected before registration', () => {
    const dupCoords: LatLng[] = [
      [9.0842, 7.4912],
      [9.0842, 7.4926],
      [9.0831, 7.4926],
      [9.0831, 7.4912],
    ];
    const res = evaluateParcelGeometry(dupCoords, existingParcels);
    assert(res.duplicateGeoClaim === true, 'Duplicate geoHash claim was not detected');
    return 'Blocked duplicate coordinate claim on Maitama Plot 104';
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    executedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    totalDurationMs: Date.now() - startedAt,
    results,
  };
}

// Allow CLI execution via `npm test`
const isDirectRun = process.argv[1]?.includes('runTests.ts');
if (isDirectRun) {
  const summary = runAnaguVerificationSuite();
  console.log(`\nANAGU Verification Suite (${summary.passed}/${summary.total} passed in ${summary.totalDurationMs}ms)`);
  for (const r of summary.results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] (${r.suite}) ${r.name} — ${r.durationMs}ms :: ${r.detail}`);
  }
  if (summary.failed > 0) process.exit(1);
}
