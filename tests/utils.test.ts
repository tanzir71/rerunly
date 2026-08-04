import { describe, expect, it } from 'vitest';
import { interpolateVariables, sanitizeText } from '../src/shared/utils';

describe('safe text utilities', () => {
  it('interpolates only ordinary task variables', () => {
    expect(interpolateVariables('Use {{var:region}} and {{secret:email}}', { region: 'Dhaka' })).toBe('Use Dhaka and {{secret:email}}');
  });

  it('redacts known and likely credential values from summaries', () => {
    const result = sanitizeText('Token top-secret and api_key=abcdefghijklm', ['top-secret']);
    expect(result).not.toContain('top-secret');
    expect(result).not.toContain('abcdefghijklm');
  });
});
