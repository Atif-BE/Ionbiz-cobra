import type { MappingEntry } from './types/mapping';
import { createSecretSource } from './secrets/keyVault';

export type Config = {
  ionBiz: { baseUrl: string; clientId: string; clientSecret: string; scope: string };
  cobra: { baseUrl: string; tokenUrl: string; clientId: string; clientSecret: string; scope: string };
  storage: { connectionString: string; tableName: string };
  queue: { connectionString: string; queueName: string };
  webhook: { secret: string; insertAction: string; updateAction: string; deleteAction: string };
  mapping: MappingEntry[];
  initialLookbackDays: number;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const parseMapping = (raw: string | undefined): MappingEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('MAPPING_TABLE_JSON must be a JSON array');
    return parsed as MappingEntry[];
  } catch (err) {
    throw new Error(`Invalid MAPPING_TABLE_JSON: ${(err as Error).message}`);
  }
};

export const loadConfig = async (): Promise<Config> => {
  const secrets = createSecretSource({ keyVaultUrl: process.env.KEY_VAULT_URL });

  // Non-secret base settings (env only). Strip any trailing slash so that
  // `${baseUrl}/path` never produces a double slash (the staging COBRA_BASE_URL
  // ends with `/`).
  const stripSlash = (u: string): string => u.replace(/\/+$/, '');
  const ionBizBaseUrl = stripSlash(requireEnv('IONBIZ_BASE_URL'));
  const cobraBaseUrl = stripSlash(requireEnv('COBRA_BASE_URL'));
  const storageConn = requireEnv('AzureWebJobsStorage');

  // Secrets via SecretSource (Key Vault in Azure, env locally).
  const [
    ionBizClientId,
    ionBizClientSecret,
    ionBizScope,
    ionBizWebhookSecret,
    cobraClientId,
    cobraClientSecret,
  ] = await Promise.all([
    secrets.get('IONBIZ_CLIENT_ID'),
    secrets.get('IONBIZ_CLIENT_SECRET'),
    secrets.get('IONBIZ_SCOPE'),
    secrets.get('IONBIZ_WEBHOOK_SECRET'),
    secrets.get('COBRA_CLIENT_ID'),
    secrets.get('COBRA_CLIENT_SECRET'),
  ]);

  const missing: string[] = [];
  if (!ionBizClientId) missing.push('IONBIZ_CLIENT_ID');
  if (!ionBizClientSecret) missing.push('IONBIZ_CLIENT_SECRET');
  if (!ionBizScope) missing.push('IONBIZ_SCOPE');
  if (!ionBizWebhookSecret) missing.push('IONBIZ_WEBHOOK_SECRET');
  if (!cobraClientId) missing.push('COBRA_CLIENT_ID');
  if (!cobraClientSecret) missing.push('COBRA_CLIENT_SECRET');
  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }

  return {
    ionBiz: {
      baseUrl: ionBizBaseUrl,
      clientId: ionBizClientId!,
      clientSecret: ionBizClientSecret!,
      scope: ionBizScope!,
    },
    cobra: {
      baseUrl: cobraBaseUrl,
      // TODO(SD Worx): confirm Cobra OAuth2 token endpoint path (PDF section 11 open point).
      tokenUrl: process.env.COBRA_TOKEN_URL ?? `${cobraBaseUrl}/OAuth/Token`,
      clientId: cobraClientId!,
      clientSecret: cobraClientSecret!,
      // TODO(SD Worx): confirm Cobra client_credentials scope value (default 'customer').
      scope: process.env.COBRA_SCOPE ?? 'customer',
    },
    storage: {
      connectionString: storageConn,
      tableName: process.env.SYNC_STATE_TABLE_NAME ?? 'LeaveSyncState',
    },
    queue: {
      connectionString: process.env.QUEUE_CONNECTION_STRING ?? storageConn,
      queueName: process.env.DEFERRED_QUEUE_NAME ?? 'deferred-salary',
    },
    webhook: {
      secret: ionBizWebhookSecret!,
      insertAction: process.env.IONBIZ_LEAVE_INSERT_ACTION ?? 'Leave_I',
      updateAction: process.env.IONBIZ_LEAVE_UPDATE_ACTION ?? 'Leave_U',
      deleteAction: process.env.IONBIZ_LEAVE_DELETE_ACTION ?? 'Leave_D',
    },
    mapping: parseMapping(process.env.MAPPING_TABLE_JSON),
    initialLookbackDays: Number(process.env.INITIAL_LOOKBACK_DAYS ?? 7),
  };
};
