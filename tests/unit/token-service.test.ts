import { TokenService } from '../../src/infrastructure/crypto/token-service';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('TokenService (AES-256-GCM)', () => {
  const service = new TokenService(KEY_A);

  it('round-trips plaintext through encrypt/decrypt', () => {
    const secret = 'xoxb-1234567890-secret-token';
    const ciphertext = service.encrypt(secret);
    expect(ciphertext).toMatch(/^gcm1:/);
    expect(ciphertext).not.toContain(secret);
    expect(service.decrypt(ciphertext)).toBe(secret);
  });

  it('produces a fresh IV so identical plaintext yields different ciphertext', () => {
    const a = service.encrypt('same');
    const b = service.encrypt('same');
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('same');
    expect(service.decrypt(b)).toBe('same');
  });

  it('handles empty and unicode plaintext', () => {
    expect(service.decrypt(service.encrypt(''))).toBe('');
    const unicode = 'café — 🔐 токен';
    expect(service.decrypt(service.encrypt(unicode))).toBe(unicode);
  });

  it('rejects tampered ciphertext via the auth tag', () => {
    const ciphertext = service.encrypt('integrity');
    const packed = ciphertext.slice('gcm1:'.length);
    const bytes = Buffer.from(packed, 'base64');
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0xff;
    const tampered = `gcm1:${bytes.toString('base64')}`;
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const ciphertext = service.encrypt('cross-key');
    const other = new TokenService(KEY_B);
    expect(() => other.decrypt(ciphertext)).toThrow();
  });

  it('rejects malformed input and unsupported versions', () => {
    expect(() => service.decrypt('not-encrypted')).toThrow(/version prefix/);
    expect(() => service.decrypt('gcm9:abcd')).toThrow(/unsupported ciphertext version/);
    expect(() => service.decrypt('gcm1:AAAA')).toThrow(/truncated/);
  });

  it('preserves null/undefined for optional helpers', () => {
    expect(service.encryptOptional(null)).toBeNull();
    expect(service.encryptOptional(undefined)).toBeNull();
    expect(service.decryptOptional(null)).toBeNull();
    const enc = service.encryptOptional('value');
    expect(enc).not.toBeNull();
    expect(service.decryptOptional(enc)).toBe('value');
  });

  it('rejects an invalid key length', () => {
    expect(() => new TokenService('00')).toThrow(/32-byte/);
  });
});
