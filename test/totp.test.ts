import { describe, it, expect } from 'vitest';
import { generateSecret, generateTOTP, verifyTOTP, base32Decode, base32Encode, getTOTPUri } from '../src/totp.js';

describe('base32', () => {
  it('round-trips', () => {
    const buf = Buffer.from('Hello World');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it('encodes known vector', () => {
    expect(base32Encode(Buffer.from('foobar')).replace(/=+$/, '')).toBe('MZXW6YTBOI');
  });

  it('decodes known vector', () => {
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });
});

describe('TOTP', () => {
  it('generates 6-digit numeric code', () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies own code', () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyTOTP(secret, code)).toBe(true);
  });

  it('rejects wrong code', () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, '000000')).toBe(false);
  });

  it('rejects empty string', () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, '')).toBe(false);
  });

  it('rejects code from different secret', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    const code = generateTOTP(s2);
    expect(verifyTOTP(s1, code)).toBe(false);
  });

  it('is consistent within same time step', () => {
    const secret = generateSecret();
    expect(generateTOTP(secret)).toBe(generateTOTP(secret));
  });

  it('accepts with window=0', () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyTOTP(secret, code, 0)).toBe(true);
  });
});

describe('TOTP URI', () => {
  it('has correct format', () => {
    const secret = generateSecret();
    const uri = getTOTPUri(secret, 'user@example.com', 'TestApp');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=TestApp');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
