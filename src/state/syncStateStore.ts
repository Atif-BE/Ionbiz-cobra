import { RestError, TableClient, TableEntity } from '@azure/data-tables';
import type { Leave, LeaveAction } from '../types/leave';
import { contentHash } from '../utils/contentHash';

export type LeaveSyncStatus = 'done' | 'pending-salary';
export type SyncDecision = 'insert' | 'update' | 'delete' | 'noop';

export type LeaveSyncRecord = {
  companyId: string;
  ionBizId: string;
  personLeaveGuid?: string;
  salaryComponentGuids: string[];
  personLeaveEntitlementId?: string;
  salaryEmploymentId?: string;
  status: LeaveSyncStatus;
  contentHash: string;
  attemptCount: number;
  lastTriedAt?: string;
};

export type SyncStateStore = {
  init: () => Promise<void>;
  get: (companyId: string, ionBizId: string) => Promise<LeaveSyncRecord | null>;
  decide: (leave: Leave, action: LeaveAction) => Promise<SyncDecision>;
  upsert: (record: LeaveSyncRecord) => Promise<void>;
  remove: (companyId: string, ionBizId: string) => Promise<void>;
};

// Only technical fields are persisted - never names/emails/leave content.
// salaryComponentGuids is serialized to a JSON string column.
type SyncEntity = TableEntity<{
  personLeaveGuid?: string;
  salaryComponentGuids: string; // JSON-encoded string[]
  personLeaveEntitlementId?: string;
  salaryEmploymentId?: string;
  status: LeaveSyncStatus;
  contentHash: string;
  attemptCount: number;
  lastTriedAt?: string;
}>;

const isNotFound = (err: unknown): boolean =>
  err instanceof RestError && (err.statusCode === 404 || err.code === 'ResourceNotFound');

const toRecord = (e: SyncEntity): LeaveSyncRecord => ({
  companyId: e.partitionKey,
  ionBizId: e.rowKey,
  personLeaveGuid: e.personLeaveGuid,
  salaryComponentGuids: parseGuids(e.salaryComponentGuids),
  personLeaveEntitlementId: e.personLeaveEntitlementId,
  salaryEmploymentId: e.salaryEmploymentId,
  status: e.status,
  contentHash: e.contentHash,
  attemptCount: e.attemptCount,
  lastTriedAt: e.lastTriedAt,
});

const parseGuids = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const createSyncStateStore = (cfg: {
  connectionString: string;
  tableName: string;
}): SyncStateStore => {
  const client = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName, {
    allowInsecureConnection: true,
  });

  const get = async (companyId: string, ionBizId: string): Promise<LeaveSyncRecord | null> => {
    try {
      const entity = await client.getEntity<SyncEntity>(companyId, ionBizId);
      return toRecord(entity);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  };

  return {
    init: async () => {
      try {
        await client.createTable();
      } catch (err) {
        // Ignore already-exists; rethrow anything else.
        if (err instanceof RestError && err.statusCode === 409) return;
        throw err;
      }
    },
    get,
    decide: async (leave, action) => {
      const existing = await get(leave.companyId, leave.ionBizId);
      if (action === 'delete') {
        return existing ? 'delete' : 'noop';
      }
      // insert | update
      if (!existing) return 'insert';
      return existing.contentHash === contentHash(leave) ? 'noop' : 'update';
    },
    upsert: async (record) => {
      const entity: SyncEntity = {
        partitionKey: record.companyId,
        rowKey: record.ionBizId,
        personLeaveGuid: record.personLeaveGuid,
        salaryComponentGuids: JSON.stringify(record.salaryComponentGuids ?? []),
        personLeaveEntitlementId: record.personLeaveEntitlementId,
        salaryEmploymentId: record.salaryEmploymentId,
        status: record.status,
        contentHash: record.contentHash,
        attemptCount: record.attemptCount,
        lastTriedAt: record.lastTriedAt,
      };
      await client.upsertEntity(entity, 'Replace');
    },
    remove: async (companyId, ionBizId) => {
      try {
        await client.deleteEntity(companyId, ionBizId);
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },
  };
};
