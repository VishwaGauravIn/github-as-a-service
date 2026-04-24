// ─── AES-256-GCM Encryption ─────────────────────────────────────────────────
//
// Optional encryption layer. When enabled, all data is encrypted before
// being written to GitHub and decrypted on read. Uses Node.js built-in crypto.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { EncryptionError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

export class Encryption {
  private key: Buffer;

  constructor(key: string) {
    // Derive a 32-byte key from the user's key using scrypt
    const salt = 'gaas-encryption-salt'; // Fixed salt for deterministic key derivation
    this.key = scryptSync(key, salt, 32);
  }

  /**
   * Encrypt plaintext to a base64 string.
   * Format: base64(iv + authTag + ciphertext)
   */
  encrypt(plaintext: string): string {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.key, iv);

      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      const authTag = cipher.getAuthTag();

      // Pack: iv (16) + authTag (16) + ciphertext
      const packed = Buffer.concat([iv, authTag, encrypted]);
      return packed.toString('base64');
    } catch (err) {
      throw new EncryptionError(`Encryption failed: ${err}`);
    }
  }

  /**
   * Decrypt a base64-encoded ciphertext back to plaintext.
   */
  decrypt(ciphertext: string): string {
    try {
      const packed = Buffer.from(ciphertext, 'base64');

      // Unpack: iv (16) + authTag (16) + ciphertext
      const iv = packed.subarray(0, IV_LENGTH);
      const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (err) {
      throw new EncryptionError(`Decryption failed. Check your encryption key. ${err}`);
    }
  }
}
