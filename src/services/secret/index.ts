/**
 * Secret Service
 *
 * Provides secure credential storage with multiple backend providers.
 */

// Interface
export { SecretService } from './interface.ts';

// Types
export type {
  SecretOptions,
  SecretInfo,
  SecretProvider,
  RegisteredProvider,
  SecretChangeType,
  SecretChangeEvent,
  SecretChangeCallback,
  Unsubscribe,
} from './types.ts';

// Errors
export { SecretError, SecretErrorCode } from './errors.ts';

// Implementation
export { LocalSecretService, localSecretService } from './local.ts';

// Adapter
export { SecretServiceAdapter } from './adapter.ts';

// Providers
export { KeychainSecretProvider, keychainSecretProvider } from './providers/keychain.ts';
export { EnvSecretProvider, envSecretProvider } from './providers/env.ts';
export { EncryptedFileSecretProvider, encryptedFileSecretProvider } from './providers/encrypted-file.ts';

// Default export
export { localSecretService as default } from './local.ts';
