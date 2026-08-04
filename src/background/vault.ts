import type { SecretMetadata, SecretPurpose, SecretRecord } from '../shared/types';
import { nowId } from '../shared/utils';

const DB_NAME = 'rerunly-vault';
const DB_VERSION = 1;
const KEY_STORE = 'keyring';
const SECRET_STORE = 'secrets';
const MASTER_KEY_ID = 'device-master-key';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Vault transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Vault transaction aborted.'));
  });
}

async function openVault(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    if (!db.objectStoreNames.contains(SECRET_STORE)) {
      db.createObjectStore(SECRET_STORE, { keyPath: 'id' });
    }
  };
  return requestResult(request);
}

async function getMasterKey(db: IDBDatabase): Promise<CryptoKey> {
  const read = db.transaction(KEY_STORE, 'readonly');
  const existing = await requestResult(
    read.objectStore(KEY_STORE).get(MASTER_KEY_ID) as IDBRequest<CryptoKey | undefined>
  );
  if (existing) return existing;

  const generated = (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )) as CryptoKey;
  const write = db.transaction(KEY_STORE, 'readwrite');
  write.objectStore(KEY_STORE).put(generated, MASTER_KEY_ID);
  await transactionComplete(write);
  return generated;
}

function metadataFrom(record: SecretRecord): SecretMetadata {
  return {
    id: record.id,
    label: record.label,
    purpose: record.purpose,
    allowedOrigins: [...record.allowedOrigins],
    fieldHints: [...record.fieldHints],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function buildAad(metadata: SecretMetadata): string {
  return JSON.stringify({
    id: metadata.id,
    label: metadata.label,
    purpose: metadata.purpose,
    allowedOrigins: metadata.allowedOrigins,
    fieldHints: metadata.fieldHints,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt
  });
}

export interface SaveSecretInput {
  id?: string;
  label: string;
  value: string;
  purpose: SecretPurpose;
  allowedOrigins: string[];
  fieldHints: string[];
}

export async function saveSecret(input: SaveSecretInput): Promise<SecretMetadata> {
  if (input.value.length < 3) throw new Error('Protected values must contain at least three characters.');
  const db = await openVault();
  try {
    const key = await getMasterKey(db);
    const existing = input.id ? await getSecretRecord(db, input.id) : undefined;
    const timestamp = Date.now();
    const metadata: SecretMetadata = {
      id: input.id ?? nowId('secret'),
      label: input.label.trim(),
      purpose: input.purpose,
      allowedOrigins: [...new Set(input.allowedOrigins)],
      fieldHints: [...new Set(input.fieldHints.map((value) => value.trim()).filter(Boolean))],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const aad = buildAad(metadata);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 },
      key,
      encoder.encode(input.value)
    );
    const record: SecretRecord = { ...metadata, ciphertext, iv, aad };
    const transaction = db.transaction(SECRET_STORE, 'readwrite');
    transaction.objectStore(SECRET_STORE).put(record);
    await transactionComplete(transaction);
    return metadata;
  } finally {
    db.close();
  }
}

async function getSecretRecord(
  db: IDBDatabase,
  id: string
): Promise<SecretRecord | undefined> {
  const transaction = db.transaction(SECRET_STORE, 'readonly');
  return requestResult(
    transaction.objectStore(SECRET_STORE).get(id) as IDBRequest<SecretRecord | undefined>
  );
}

export async function decryptSecret(id: string): Promise<string> {
  const db = await openVault();
  try {
    const record = await getSecretRecord(db, id);
    if (!record) throw new Error('Secret not found.');
    const key = await getMasterKey(db);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: record.iv,
        additionalData: encoder.encode(record.aad),
        tagLength: 128
      },
      key,
      record.ciphertext
    );
    return decoder.decode(plaintext);
  } finally {
    db.close();
  }
}

export async function listSecretMetadata(): Promise<SecretMetadata[]> {
  const db = await openVault();
  try {
    const transaction = db.transaction(SECRET_STORE, 'readonly');
    const records = await requestResult(
      transaction.objectStore(SECRET_STORE).getAll() as IDBRequest<SecretRecord[]>
    );
    return records.map(metadataFrom).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function deleteSecret(id: string): Promise<void> {
  const db = await openVault();
  try {
    const transaction = db.transaction(SECRET_STORE, 'readwrite');
    transaction.objectStore(SECRET_STORE).delete(id);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

export async function resetVaultForTests(): Promise<void> {
  const db = await openVault();
  db.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete test vault.'));
  });
}
