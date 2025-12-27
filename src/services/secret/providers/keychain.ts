/**
 * System Keychain Secret Provider
 *
 * Uses the system's native credential storage:
 * - macOS: Keychain (via `security` command)
 * - Linux: Secret Service (via `secret-tool` command)
 * - Windows: Credential Manager (via PowerShell)
 *
 * This is the most secure option as credentials are stored
 * encrypted by the OS and protected by user authentication.
 */

import { $ } from 'bun';
import { debugLog } from '../../../debug.ts';
import type { SecretProvider, SecretOptions, SecretInfo } from '../types.ts';

const SERVICE_NAME = 'ultra-editor';

type Platform = 'darwin' | 'linux' | 'win32' | 'unsupported';

/**
 * Get the current platform.
 */
function getPlatform(): Platform {
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform;
  }
  return 'unsupported';
}

/**
 * Check if required keychain tools are available.
 */
async function checkAvailability(): Promise<boolean> {
  const platform = getPlatform();

  try {
    switch (platform) {
      case 'darwin':
        // Check if security command exists
        await $`which security`.quiet();
        return true;

      case 'linux':
        // Check if secret-tool exists (part of libsecret)
        await $`which secret-tool`.quiet();
        return true;

      case 'win32':
        // PowerShell is always available on Windows
        return true;

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * System keychain secret provider.
 */
export class KeychainSecretProvider implements SecretProvider {
  readonly id = 'keychain';
  readonly name = 'System Keychain';
  readonly isReadOnly = false;
  readonly supportsExpiry = false;

  private _isAvailable: boolean | null = null;
  private platform: Platform;

  constructor() {
    this.platform = getPlatform();
  }

  get isAvailable(): boolean {
    // Return cached value or assume available until checked
    return this._isAvailable ?? this.platform !== 'unsupported';
  }

  async init(): Promise<void> {
    this._isAvailable = await checkAvailability();
    debugLog(`[KeychainProvider] Available: ${this._isAvailable} (platform: ${this.platform})`);
  }

  async get(key: string): Promise<string | null> {
    if (!this._isAvailable) {
      return null;
    }

    try {
      switch (this.platform) {
        case 'darwin':
          return await this.getMacOS(key);
        case 'linux':
          return await this.getLinux(key);
        case 'win32':
          return await this.getWindows(key);
        default:
          return null;
      }
    } catch (error) {
      debugLog(`[KeychainProvider] Failed to get "${key}": ${error}`);
      return null;
    }
  }

  async set(key: string, value: string, _options?: SecretOptions): Promise<void> {
    if (!this._isAvailable) {
      throw new Error('Keychain is not available');
    }

    try {
      switch (this.platform) {
        case 'darwin':
          await this.setMacOS(key, value);
          break;
        case 'linux':
          await this.setLinux(key, value);
          break;
        case 'win32':
          await this.setWindows(key, value);
          break;
        default:
          throw new Error('Unsupported platform');
      }
    } catch (error) {
      debugLog(`[KeychainProvider] Failed to set "${key}": ${error}`);
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this._isAvailable) {
      return false;
    }

    try {
      switch (this.platform) {
        case 'darwin':
          return await this.deleteMacOS(key);
        case 'linux':
          return await this.deleteLinux(key);
        case 'win32':
          return await this.deleteWindows(key);
        default:
          return false;
      }
    } catch (error) {
      debugLog(`[KeychainProvider] Failed to delete "${key}": ${error}`);
      return false;
    }
  }

  async list(_prefix?: string): Promise<string[]> {
    // Keychain listing is platform-specific and complex
    // For now, return empty array - secrets must be accessed by known key
    debugLog('[KeychainProvider] list() not fully implemented - keychain enumeration is limited');
    return [];
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async getInfo(key: string): Promise<SecretInfo | null> {
    const exists = await this.has(key);
    if (!exists) {
      return null;
    }

    return {
      key,
      provider: this.id,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // macOS Implementation
  // ─────────────────────────────────────────────────────────────────────────

  private async getMacOS(key: string): Promise<string | null> {
    try {
      const result = await $`security find-generic-password -s ${SERVICE_NAME} -a ${key} -w`.quiet();
      return result.text().trim();
    } catch {
      // Item not found
      return null;
    }
  }

  private async setMacOS(key: string, value: string): Promise<void> {
    // Delete existing entry first (if any)
    await this.deleteMacOS(key);

    // Add new entry
    await $`security add-generic-password -s ${SERVICE_NAME} -a ${key} -w ${value}`.quiet();
  }

  private async deleteMacOS(key: string): Promise<boolean> {
    try {
      await $`security delete-generic-password -s ${SERVICE_NAME} -a ${key}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Linux Implementation (using secret-tool / libsecret)
  // ─────────────────────────────────────────────────────────────────────────

  private async getLinux(key: string): Promise<string | null> {
    try {
      const result = await $`secret-tool lookup service ${SERVICE_NAME} key ${key}`.quiet();
      return result.text().trim() || null;
    } catch {
      return null;
    }
  }

  private async setLinux(key: string, value: string): Promise<void> {
    // secret-tool reads from stdin
    await $`echo ${value} | secret-tool store --label="${SERVICE_NAME}: ${key}" service ${SERVICE_NAME} key ${key}`.quiet();
  }

  private async deleteLinux(key: string): Promise<boolean> {
    try {
      await $`secret-tool clear service ${SERVICE_NAME} key ${key}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Windows Implementation (using PowerShell Credential Manager)
  // ─────────────────────────────────────────────────────────────────────────

  private async getWindows(key: string): Promise<string | null> {
    try {
      const target = `${SERVICE_NAME}:${key}`;
      const script = `
        $cred = Get-StoredCredential -Target "${target}" -ErrorAction SilentlyContinue
        if ($cred) { $cred.GetNetworkCredential().Password }
      `;
      const result = await $`powershell -NoProfile -Command ${script}`.quiet();
      const output = result.text().trim();
      return output || null;
    } catch {
      return null;
    }
  }

  private async setWindows(key: string, value: string): Promise<void> {
    const target = `${SERVICE_NAME}:${key}`;
    // Use cmdkey for simpler credential management
    await $`cmdkey /generic:${target} /user:ultra /pass:${value}`.quiet();
  }

  private async deleteWindows(key: string): Promise<boolean> {
    try {
      const target = `${SERVICE_NAME}:${key}`;
      await $`cmdkey /delete:${target}`.quiet();
      return true;
    } catch {
      return false;
    }
  }
}

export const keychainSecretProvider = new KeychainSecretProvider();
export default keychainSecretProvider;
