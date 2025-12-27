/**
 * Secret Service ECP Adapter
 *
 * Maps ECP JSON-RPC methods to SecretService operations.
 */

import { debugLog } from '../../debug.ts';
import type { SecretService } from './interface.ts';
import type { SecretOptions } from './types.ts';
import { SecretError } from './errors.ts';

/**
 * ECP method parameters and results.
 */
interface SecretGetParams {
  key: string;
}

interface SecretGetResult {
  value: string | null;
}

interface SecretSetParams {
  key: string;
  value: string;
  options?: {
    expiresAt?: string;  // ISO date string
    description?: string;
    provider?: string;
  };
}

interface SecretSetResult {
  success: boolean;
}

interface SecretDeleteParams {
  key: string;
}

interface SecretDeleteResult {
  deleted: boolean;
}

interface SecretListParams {
  prefix?: string;
}

interface SecretListResult {
  keys: string[];
}

interface SecretHasParams {
  key: string;
}

interface SecretHasResult {
  exists: boolean;
}

interface SecretInfoParams {
  key: string;
}

interface SecretInfoResult {
  info: {
    key: string;
    provider: string;
    createdAt?: string;
    expiresAt?: string;
    description?: string;
  } | null;
}

interface SecretProvidersResult {
  providers: Array<{
    id: string;
    name: string;
    priority: number;
    isReadOnly: boolean;
  }>;
}

/**
 * Secret Service ECP Adapter.
 */
export class SecretServiceAdapter {
  constructor(private service: SecretService) {}

  /**
   * Handle an ECP request.
   */
  async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'secret/get':
        return this.get(params as SecretGetParams);

      case 'secret/set':
        return this.set(params as SecretSetParams);

      case 'secret/delete':
        return this.deleteSecret(params as SecretDeleteParams);

      case 'secret/list':
        return this.list(params as SecretListParams);

      case 'secret/has':
        return this.has(params as SecretHasParams);

      case 'secret/info':
        return this.getInfo(params as SecretInfoParams);

      case 'secret/providers':
        return this.getProviders();

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Get list of methods this adapter handles.
   */
  getMethods(): string[] {
    return [
      'secret/get',
      'secret/set',
      'secret/delete',
      'secret/list',
      'secret/has',
      'secret/info',
      'secret/providers',
    ];
  }

  private async get(params: SecretGetParams): Promise<SecretGetResult> {
    const value = await this.service.get(params.key);
    return { value };
  }

  private async set(params: SecretSetParams): Promise<SecretSetResult> {
    const options: SecretOptions | undefined = params.options
      ? {
          expiresAt: params.options.expiresAt ? new Date(params.options.expiresAt) : undefined,
          description: params.options.description,
          provider: params.options.provider,
        }
      : undefined;

    await this.service.set(params.key, params.value, options);
    return { success: true };
  }

  private async deleteSecret(params: SecretDeleteParams): Promise<SecretDeleteResult> {
    const deleted = await this.service.delete(params.key);
    return { deleted };
  }

  private async list(params: SecretListParams): Promise<SecretListResult> {
    const keys = await this.service.list(params.prefix);
    return { keys };
  }

  private async has(params: SecretHasParams): Promise<SecretHasResult> {
    const exists = await this.service.has(params.key);
    return { exists };
  }

  private async getInfo(params: SecretInfoParams): Promise<SecretInfoResult> {
    const info = await this.service.getInfo(params.key);

    if (!info) {
      return { info: null };
    }

    return {
      info: {
        key: info.key,
        provider: info.provider,
        createdAt: info.createdAt?.toISOString(),
        expiresAt: info.expiresAt?.toISOString(),
        description: info.description,
      },
    };
  }

  private getProviders(): SecretProvidersResult {
    return {
      providers: this.service.getProviders(),
    };
  }
}
