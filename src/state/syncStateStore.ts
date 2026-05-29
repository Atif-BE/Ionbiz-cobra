import { RestError, TableClient, TableEntity } from '@azure/data-tables';

type LeaveEntity = TableEntity<{
  cobraRef: string;
  syncedAt: string;
}>;

type MetaEntity = TableEntity<{
  timestamp: string;
}>;

export type SyncStateStore = {
  init: () => Promise<void>;
  hasSynced: (ionBizId: string) => Promise<boolean>;
  markSynced: (ionBizId: string, cobraRef: string) => Promise<void>;
  getLastRunTimestamp: () => Promise<Date | null>;
  setLastRunTimestamp: (d: Date) => Promise<void>;
};

const LEAVE_PARTITION = 'leave';
const META_PARTITION = 'meta';
const LAST_RUN_ROW_KEY = 'lastRun';

const isNotFound = (err: unknown): boolean =>
  err instanceof RestError && (err.statusCode === 404 || err.code === 'ResourceNotFound');

export const createSyncStateStore = (cfg: {
  connectionString: string;
  tableName: string;
}): SyncStateStore => {
  const client = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName, {
    allowInsecureConnection: true,
  });

  return {
    init: async () => {
      await client.createTable();
    },
    hasSynced: async (ionBizId) => {
      try {
        await client.getEntity(LEAVE_PARTITION, ionBizId);
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
    markSynced: async (ionBizId, cobraRef) => {
      const entity: LeaveEntity = {
        partitionKey: LEAVE_PARTITION,
        rowKey: ionBizId,
        cobraRef,
        syncedAt: new Date().toISOString(),
      };
      await client.upsertEntity(entity, 'Replace');
    },
    getLastRunTimestamp: async () => {
      try {
        const entity = await client.getEntity<MetaEntity>(META_PARTITION, LAST_RUN_ROW_KEY);
        return new Date(entity.timestamp);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    setLastRunTimestamp: async (d) => {
      const entity: MetaEntity = {
        partitionKey: META_PARTITION,
        rowKey: LAST_RUN_ROW_KEY,
        timestamp: d.toISOString(),
      };
      await client.upsertEntity(entity, 'Replace');
    },
  };
};
