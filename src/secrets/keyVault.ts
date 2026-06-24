import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

export type SecretSource = { get: (name: string) => Promise<string | undefined> };

// Maps a logical secret name to an env var name (used for both fallback and KV-name resolution).
const envName = (name: string): string => name;

// Azure Key Vault secret names allow only alphanumerics and dashes; env vars commonly use underscores.
const kvSecretName = (name: string): string => name.replace(/_/g, '-');

export const createSecretSource = (cfg: { keyVaultUrl?: string }): SecretSource => {
  if (!cfg.keyVaultUrl) {
    // Local dev: read straight from process.env.
    return { get: async (name) => process.env[envName(name)] };
  }

  const client = new SecretClient(cfg.keyVaultUrl, new DefaultAzureCredential());
  const cache = new Map<string, string | undefined>();

  return {
    get: async (name) => {
      if (cache.has(name)) return cache.get(name);
      let value: string | undefined;
      try {
        const secret = await client.getSecret(kvSecretName(name));
        value = secret.value;
      } catch {
        // Not present in KV: fall back to env so mixed setups keep working.
        value = process.env[envName(name)];
      }
      cache.set(name, value);
      return value;
    },
  };
};
