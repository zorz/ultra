/**
 * Encrypted File Secret Provider
 *
 * Fallback provider that stores secrets in an encrypted JSON file.
 * Uses AES-256-GCM encryption with a key derived from a master password.
 *
 * The master password can be:
 * 1. Provided via ULTRA_MASTER_PASSWORD environment variable
 * 2. Derived from machine-specific info (less secure, but works without password)
 *
 * File location: ~/.ultra/secrets.enc
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { debugLog } from '../../../debug.ts';
import type { SecretProvider, SecretOptions, SecretInfo } from '../types.ts';

const SECRETS_DIR = join(homedir(), '.ultra');
const SECRETS_FILE = join(SECRETS_DIR, 'secrets.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

/**
 * Stored secret with metadata.
 */
interface StoredSecret {
  value: string;
  createdAt: string;
  expiresAt?: string;
  description?: string;
}

/**
 * Encrypted file structure.
 */
interface SecretsFile {
  version: 1;
  salt: string;  // Base64 encoded
  secrets: Record<string, StoredSecret>;
}

/**
 * Encrypted data format: salt (16) + iv (16) + authTag (16) + ciphertext
 */
interface EncryptedData {
  salt: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

/**
 * Derive encryption key from password and salt.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  // Use PBKDF2-like derivation with SHA-256
  const iterations = 100000;
  let key = Buffer.concat([Buffer.from(password, 'utf8'), salt]);

  for (let i = 0; i < iterations; i++) {
    key = createHash('sha256').update(key).digest();
  }

  return key.subarray(0, KEY_LENGTH);
}

/**
 * Get master password.
 * Falls back to machine-derived key if not provided.
 */
function getMasterPassword(): string {
  // Check environment variable
  const envPassword = process.env.ULTRA_MASTER_PASSWORD;
  if (envPassword) {
    return envPassword;
  }

  // Fall back to machine-derived key (less secure but works without config)
  // Uses hostname + homedir + a constant as the seed
  const machineInfo = `${process.env.HOSTNAME || 'unknown'}:${homedir()}:ultra-secrets-v1`;
  return createHash('sha256').update(machineInfo).digest('hex');
}

/**
 * Encrypt data.
 */
function encrypt(plaintext: string, password: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

/**
 * Decrypt data.
 */
function decrypt(encrypted: Buffer, password: string): string {
  const salt = encrypted.subarray(0, SALT_LENGTH);
  const iv = encrypted.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encrypted.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/**
 * Encrypted file secret provider.
 */
export class EncryptedFileSecretProvider implements SecretProvider {
  readonly id = 'encrypted-file';
  readonly name = 'Encrypted File';
  readonly isReadOnly = false;
  readonly supportsExpiry = true;
  readonly isAvailable = true;

  private cache: Map<string, StoredSecret> | null = null;
  private password: string | null = null;
  private dirty = false;

  async init(): Promise<void> {
    this.password = getMasterPassword();
    await this.load();
  }

  async get(key: string): Promise<string | null> {
    await this.ensureLoaded();

    const secret = this.cache?.get(key);
    if (!secret) {
      return null;
    }

    // Check expiration
    if (secret.expiresAt) {
      const expiry = new Date(secret.expiresAt);
      if (expiry < new Date()) {
        // Secret has expired - delete it
        await this.delete(key);
        return null;
      }
    }

    return secret.value;
  }

  async set(key: string, value: string, options?: SecretOptions): Promise<void> {
    await this.ensureLoaded();

    const secret: StoredSecret = {
      value,
      createdAt: new Date().toISOString(),
    };

    if (options?.expiresAt) {
      secret.expiresAt = options.expiresAt.toISOString();
    }

    if (options?.description) {
      secret.description = options.description;
    }

    this.cache!.set(key, secret);
    this.dirty = true;
    await this.save();
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureLoaded();

    const deleted = this.cache!.delete(key);
    if (deleted) {
      this.dirty = true;
      await this.save();
    }

    return deleted;
  }

  async list(prefix?: string): Promise<string[]> {
    await this.ensureLoaded();

    const keys = Array.from(this.cache!.keys());

    if (prefix) {
      return keys.filter(k => k.startsWith(prefix));
    }

    return keys;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async getInfo(key: string): Promise<SecretInfo | null> {
    await this.ensureLoaded();

    const secret = this.cache?.get(key);
    if (!secret) {
      return null;
    }

    return {
      key,
      provider: this.id,
      createdAt: new Date(secret.createdAt),
      expiresAt: secret.expiresAt ? new Date(secret.expiresAt) : undefined,
      description: secret.description,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache === null) {
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.cache = new Map();

    try {
      const file = Bun.file(SECRETS_FILE);
      const exists = await file.exists();

      if (!exists) {
        debugLog('[EncryptedFileProvider] No secrets file found, starting fresh');
        return;
      }

      const encrypted = Buffer.from(await file.arrayBuffer());
      const json = decrypt(encrypted, this.password!);
      const data: SecretsFile = JSON.parse(json);

      if (data.version !== 1) {
        throw new Error(`Unsupported secrets file version: ${data.version}`);
      }

      for (const [key, secret] of Object.entries(data.secrets)) {
        this.cache.set(key, secret);
      }

      debugLog(`[EncryptedFileProvider] Loaded ${this.cache.size} secrets`);
    } catch (error) {
      debugLog(`[EncryptedFileProvider] Failed to load secrets: ${error}`);
      // Start fresh on error
      this.cache = new Map();
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty || !this.cache) {
      return;
    }

    try {
      // Ensure directory exists
      const dir = Bun.file(SECRETS_DIR);
      // Use mkdir through shell for simplicity
      await Bun.$`mkdir -p ${SECRETS_DIR}`.quiet();

      const data: SecretsFile = {
        version: 1,
        salt: randomBytes(SALT_LENGTH).toString('base64'),
        secrets: Object.fromEntries(this.cache),
      };

      const json = JSON.stringify(data, null, 2);
      const encrypted = encrypt(json, this.password!);

      await Bun.write(SECRETS_FILE, encrypted);
      // Set restrictive permissions (owner read/write only)
      await Bun.$`chmod 600 ${SECRETS_FILE}`.quiet();

      this.dirty = false;
      debugLog(`[EncryptedFileProvider] Saved ${this.cache.size} secrets`);
    } catch (error) {
      debugLog(`[EncryptedFileProvider] Failed to save secrets: ${error}`);
      throw error;
    }
  }
}

export const encryptedFileSecretProvider = new EncryptedFileSecretProvider();
export default encryptedFileSecretProvider;
