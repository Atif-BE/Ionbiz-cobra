export type Config = {
  ionBiz: { baseUrl: string; clientId: string; clientSecret: string; scope: string };
  cobra: { baseUrl: string; apiKey: string };
  storage: { connectionString: string; tableName: string };
  webhook: { secret: string; leaveInsertAction: string };
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
    'IONBIZ_CLIENT_ID',
    'IONBIZ_CLIENT_SECRET',
    'IONBIZ_SCOPE',
    'IONBIZ_WEBHOOK_SECRET',
    'COBRA_BASE_URL',
    'COBRA_API_KEY',
    'AzureWebJobsStorage',
  ]);

  return {
    ionBiz: {
      baseUrl: env.IONBIZ_BASE_URL,
      clientId: env.IONBIZ_CLIENT_ID,
      clientSecret: env.IONBIZ_CLIENT_SECRET,
      scope: env.IONBIZ_SCOPE,
    },
    cobra: {
      baseUrl: env.COBRA_BASE_URL,
      apiKey: env.COBRA_API_KEY,
    },
    storage: {
      connectionString: env.AzureWebJobsStorage,
      tableName: process.env.SYNC_STATE_TABLE_NAME ?? 'LeaveSyncState',
    },
    webhook: {
      secret: env.IONBIZ_WEBHOOK_SECRET,
      leaveInsertAction: process.env.IONBIZ_LEAVE_INSERT_ACTION ?? 'Leave_I',
    },
    initialLookbackDays: Number(process.env.INITIAL_LOOKBACK_DAYS ?? 7),
  };
};
