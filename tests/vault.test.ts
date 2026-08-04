import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  listSecretMetadata,
  resetVaultForTests,
  saveSecret
} from '../src/background/vault';

describe('device vault', () => {
  beforeEach(async () => {
    await resetVaultForTests();
  });

  it('round-trips a protected value without exposing it in metadata', async () => {
    const metadata = await saveSecret({
      label: 'Work email',
      value: 'private@example.com',
      purpose: 'task_variable',
      allowedOrigins: ['https://example.com'],
      fieldHints: ['email']
    });

    expect(await decryptSecret(metadata.id)).toBe('private@example.com');
    const listed = await listSecretMetadata();
    expect(listed).toEqual([metadata]);
    expect(JSON.stringify(listed)).not.toContain('private@example.com');
  });

  it('uses fresh authenticated encryption when updating a record', async () => {
    const first = await saveSecret({
      label: 'Token',
      value: 'first-value',
      purpose: 'task_variable',
      allowedOrigins: [],
      fieldHints: []
    });
    const updated = await saveSecret({
      id: first.id,
      label: 'Token',
      value: 'second-value',
      purpose: 'task_variable',
      allowedOrigins: [],
      fieldHints: []
    });

    expect(updated.createdAt).toBe(first.createdAt);
    expect(await decryptSecret(first.id)).toBe('second-value');
  });

  it('rejects values too short to scrub safely', async () => {
    await expect(saveSecret({
      label: 'Too short', value: 'x', purpose: 'task_variable', allowedOrigins: [], fieldHints: []
    })).rejects.toThrow(/three characters/);
  });
});
