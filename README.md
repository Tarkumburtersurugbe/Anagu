# ANAGU — Integrated Digital Land Administration & Title Registration System

ANAGU is a full-stack Nigerian digital land administration, spatial GIS verification, ownership oracle, Hyperledger Besu ERC-721 digital title registry, Section 28 statutory revocation, and MQTT offline-sync platform.

## Architecture & Key Modules

- **Web Application (`/src`)**: React 19 + TypeScript + Tailwind CSS v4 + Leaflet GIS + QR Code generator.
- **Backend API (`/server`)**: Express + TypeScript REST API, JWT authentication, bcryptjs hashing, strict backend Role-Based Access Control (RBAC), rate limiting, and SQLite relational storage (`better-sqlite3`).
- **GIS Spatial Engine (`/server/gis.ts`)**: Computational geometry engine mirroring PostGIS `ST_IsValid` and `ST_Intersects` (ring closure, self-intersection detection, geodesic polygon area, overlap % computation, duplicate GeoHash claim detection).
- **Ownership Verification Oracle (`/server/routes.ts`)**: Cross-references applicant claims and SHA-256 document fingerprints against institutional records (e.g., AGIS / State Land Registries) and community council attestations—strictly enforcing that community attestation alone does not establish statutory title.
- **Blockchain & ERC-721 Contracts (`/contracts/LandRegistry.sol`, `/contracts/LandTitleNFT.sol`, `/server/blockchain.ts`)**: Permissioned ledger recording privacy-preserving salted identity commitments (zero PII on-chain), registry-controlled transfers, and Section 28 revocations.
- **Statutory Revocation**: Strictly restricted to the `governor` role on the backend and smart contract, supporting only Section 28 grounds (`Overriding public interest` or `Breach of statutory conditions`).
- **MQTT & Offline Sync (`/server/mqtt.ts`, `/src/lib/api.ts`)**: Live SSE/MQTT topic stream with QoS delivery tracking and local offline submission queue with automatic reconnect synchronization.
- **Production Schema & Mobile Companion**: PostgreSQL + PostGIS DDL (`/infra/sql/schema.sql`), Docker Compose (`/compose.yaml`), and React Native Expo mobile client (`/apps/mobile/App.tsx`).

## Running Locally

```bash
npm install
npm run dev       # Starts full-stack Express + Vite server on http://localhost:3000
npm test          # Executes live GIS, Blockchain, Oracle, MQTT, and Security verification tests
npm run build     # Builds production frontend bundle
npm start         # Runs production server on port 3000
```

## Development Role Credentials

All seeded institutional accounts use password `Anagu@2026!`:
- `citizen@anagu.ng` — Citizen / Landowner
- `surveyor@anagu.ng` — Licensed Surveyor (`SURCON-NG-4492`)
- `registrar@anagu.ng` — Registrar of Titles
- `landadmin@anagu.ng` — Land Administrator
- `governor@anagu.ng` — Governor-Authorised Officer (Section 28 Revocation)
- `sysadmin@anagu.ng` — System Administrator
