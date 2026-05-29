export type Config = {
  ionBiz: { baseUrl: string; apiKey: string };
  cobra: { baseUrl: string; apiKey: string };
  storage: { connectionString: string; tableName: string };
  initialLookbackDays: number;
};

const requireAll = (keys: string[]): Record<string, string> => {
  const missing: string[] = [];
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (!value) missing.push(key);
    else values[key] = value;
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return values;
};

export const loadConfig = (): Config => {
  const env = requireAll([
    'IONBIZ_BASE_URL',
    'IONBIZ_API_KEY',
    'COBRA_BASE_URL',
    'COBRA_API_KEY',
    'AzureWebJobsStorage',
  ]);

  return {
    ionBiz: {
      baseUrl: env.IONBIZ_BASE_URL,
      apiKey: env.IONBIZ_API_KEY,
    },
    cobra: {
      baseUrl: env.COBRA_BASE_URL,
      apiKey: env.COBRA_API_KEY,
    },
    storage: {
      connectionString: env.AzureWebJobsStorage,
      tableName: process.env.SYNC_STATE_TABLE_NAME ?? 'LeaveSyncState',
    },
    initialLookbackDays: Number(process.env.INITIAL_LOOKBACK_DAYS ?? 7),
  };
};
