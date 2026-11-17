import crypto from 'crypto';
import { db, sha256 } from './db.ts';

export const CONTRACT_ADDRESSES = {
  LandRegistry: '0x4B82E019C4A1D9920F118E4209A1B883C12D0001',
  LandTitleNFT: '0x9E31F884A201B773C109D44820E1A559D44E0721',
};

function getNextBlockNumber(): number {
  const row = db.prepare('SELECT MAX(block_number) as maxBlock FROM blockchain_transactions').get() as { maxBlock: number | null };
  return (row?.maxBlock || 10644) + 1;
}

export function getNextTokenId(): number {
  const row = db.prepare('SELECT MAX(token_id) as maxToken FROM nft_titles').get() as { maxToken: number | null };
  return (row?.maxToken || 1003) + 1;
}

export function createOwnerCommitment(userId: string, parcelId: string): string {
  // Never store PII on-chain; hash salted identity reference
  return sha256(`ANAGU-PRIVACY-COMMITMENT:${userId}:${parcelId}`);
}

export function recordBesuParcelRegistration(params: {
  parcelRef: string;
  parcelId: string;
  ownerUserId: string;
  geoHash: string;
  documentMerkleRoot: string;
  registrarUserId: string;
  registrarRole: string;
}) {
  if (params.registrarRole !== 'registrar') {
    throw new Error('Smart Contract Revert (LandRegistry.onlyRegistrar): Caller lacks REGISTRAR_ROLE.');
  }

  const existingTitle = db
    .prepare('SELECT id FROM nft_titles WHERE parcel_id = ?')
    .get(params.parcelId) as { id: string } | undefined;
  if (existingTitle) {
    throw new Error('Smart Contract Revert (LandRegistry): Parcel already registered.');
  }

  const tokenId = getNextTokenId();
  const blockNumber = getNextBlockNumber();
  const ownerCommitment = createOwnerCommitment(params.ownerUserId, params.parcelId);
  const now = new Date().toISOString();
  const txHash = sha256(`BESU:registerParcel:${params.parcelRef}:${tokenId}:${blockNumber}:${crypto.randomUUID()}`);
  const txId = `btx-${crypto.randomUUID().slice(0, 8)}`;

  const payload = {
    tokenId,
    parcelRef: params.parcelRef,
    ownerCommitment,
    geoBoundaryHash: params.geoHash,
    documentMerkleRoot: params.documentMerkleRoot,
  };

  db.prepare(`
    INSERT INTO blockchain_transactions (
      id, tx_hash, block_number, contract_name, contract_address, method_name,
      parcel_ref, initiator_user_id, event_name, event_payload, gas_used, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txId,
    txHash,
    blockNumber,
    'LandRegistry',
    CONTRACT_ADDRESSES.LandRegistry,
    'registerParcel',
    params.parcelRef,
    params.registrarUserId,
    'ParcelRegistered',
    JSON.stringify(payload),
    184620,
    'Confirmed',
    now
  );

  return { txId, txHash, blockNumber, tokenId, ownerCommitment };
}

export function recordBesuTitleTransfer(params: {
  titleId: string;
  parcelRef: string;
  parcelId: string;
  tokenId: number;
  titleStatus: string;
  newOwnerUserId: string;
  registrarUserId: string;
  registrarRole: string;
}) {
  if (params.registrarRole !== 'registrar') {
    throw new Error('Smart Contract Revert (LandRegistry.onlyRegistrar): Caller lacks REGISTRAR_ROLE.');
  }
  if (params.titleStatus === 'Revoked') {
    throw new Error('Smart Contract Revert (LandRegistry): Cannot transfer statutorily revoked title.');
  }

  const blockNumber = getNextBlockNumber();
  const newCommitment = createOwnerCommitment(params.newOwnerUserId, params.parcelId);
  const now = new Date().toISOString();
  const txHash = sha256(`BESU:authorizeTransfer:${params.parcelRef}:${params.tokenId}:${blockNumber}:${crypto.randomUUID()}`);
  const txId = `btx-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO blockchain_transactions (
      id, tx_hash, block_number, contract_name, contract_address, method_name,
      parcel_ref, initiator_user_id, event_name, event_payload, gas_used, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txId,
    txHash,
    blockNumber,
    'LandRegistry',
    CONTRACT_ADDRESSES.LandRegistry,
    'authorizeTransfer',
    params.parcelRef,
    params.registrarUserId,
    'OwnershipTransferred',
    JSON.stringify({ tokenId: params.tokenId, parcelRef: params.parcelRef, newOwnerCommitment: newCommitment }),
    96400,
    'Confirmed',
    now
  );

  return { txId, txHash, blockNumber, newCommitment };
}

export function recordBesuStatutoryRevocation(params: {
  parcelRef: string;
  tokenId: number;
  currentStatus: string;
  ground: string;
  gazetteOrderRef: string;
  governorUserId: string;
  governorRole: string;
}) {
  if (params.governorRole !== 'governor') {
    throw new Error('Smart Contract Revert (LandRegistry.onlyGovernor): Caller lacks GOVERNOR_ROLE.');
  }
  if (params.currentStatus === 'Revoked') {
    throw new Error('Smart Contract Revert (LandRegistry): Title is already revoked.');
  }
  if (params.ground !== 'Overriding public interest' && params.ground !== 'Breach of statutory conditions') {
    throw new Error('Smart Contract Revert (LandRegistry): Invalid Section 28 statutory ground.');
  }

  const blockNumber = getNextBlockNumber();
  const now = new Date().toISOString();
  const txHash = sha256(`BESU:revokeParcel:${params.parcelRef}:${params.tokenId}:${blockNumber}:${crypto.randomUUID()}`);
  const txId = `btx-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO blockchain_transactions (
      id, tx_hash, block_number, contract_name, contract_address, method_name,
      parcel_ref, initiator_user_id, event_name, event_payload, gas_used, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txId,
    txHash,
    blockNumber,
    'LandRegistry',
    CONTRACT_ADDRESSES.LandRegistry,
    'revokeParcel',
    params.parcelRef,
    params.governorUserId,
    'ParcelRevoked',
    JSON.stringify({ tokenId: params.tokenId, parcelRef: params.parcelRef, ground: params.ground, gazetteOrderRef: params.gazetteOrderRef }),
    114200,
    'Confirmed',
    now
  );

  return { txId, txHash, blockNumber };
}
