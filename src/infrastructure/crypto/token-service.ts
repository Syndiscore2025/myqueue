import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config';

/**
 * Authenticated encryption for sensitive values (Slack OAuth tokens).
 *
 * Algorithm: AES-256-GCM with a random 96-bit IV per message and a 128-bit auth
 * tag. The serialized form is `<version>:<base64(iv|tag|ciphertext)>`, where the
 * version prefix allows the encryption scheme/key to be rotated in future
 * without ambiguity. Decryption is integrity-checked: any tampering or use of
 * the wrong key fails loudly rather than returning corrupt plaintext.
 */
const ALGORITHM = 'aes-256-gcm';
const VERSION = 'gcm1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenService {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new Error(`TokenService requires a ${KEY_BYTES}-byte hex key (got ${key.length} bytes)`);
    }
    this.key = key;
  }

  /** Encrypt UTF-8 plaintext into the serialized, authenticated form. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64');
    return `${VERSION}:${packed}`;
  }

  /** Decrypt a value produced by {@link encrypt}. Throws on tampering/format. */
  decrypt(payload: string): string {
    const separator = payload.indexOf(':');
    if (separator === -1) {
      throw new Error('TokenService: malformed ciphertext (missing version prefix)');
    }
    const version = payload.slice(0, separator);
    if (version !== VERSION) {
      throw new Error(`TokenService: unsupported ciphertext version "${version}"`);
    }

    const packed = Buffer.from(payload.slice(separator + 1), 'base64');
    if (packed.length < IV_BYTES + TAG_BYTES) {
      throw new Error('TokenService: malformed ciphertext (truncated payload)');
    }

    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Encrypt an optional value, preserving null/undefined as null. */
  encryptOptional(value: string | null | undefined): string | null {
    return value === null || value === undefined ? null : this.encrypt(value);
  }

  /** Decrypt an optional value, preserving null/undefined as null. */
  decryptOptional(payload: string | null | undefined): string | null {
    return payload === null || payload === undefined ? null : this.decrypt(payload);
  }
}

/** Process-wide token service bound to the validated ENCRYPTION_KEY. */
export const tokenService = new TokenService(env.ENCRYPTION_KEY);
