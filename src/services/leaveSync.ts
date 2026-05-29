import { InvocationContext } from '@azure/functions';
import { CobraClient } from '../clients/cobraClient';
import { IonBizClient } from '../clients/ionbizClient';
import { ionBizToInternal, internalToCobra } from '../mappers/leaveMapper';
import { SyncStateStore } from '../state/syncStateStore';

export type SyncSummary = {
  fetched: number;
  synced: number;
  skipped: number;
  failed: number;
};

export type LeaveSyncService = {
  syncLeaves: () => Promise<SyncSummary>;
};

const MS_PER_DAY = 86_400_000;

export const createLeaveSyncService = (deps: {
  ionBiz: IonBizClient;
  cobra: CobraClient;
  state: SyncStateStore;
  log: InvocationContext;
  initialLookbackDays: number;
}): LeaveSyncService => ({
  syncLeaves: async () => {
    const { ionBiz, cobra, state, log, initialLookbackDays } = deps;

    await state.init();

    const runStartedAt = new Date();
    const lastRun = await state.getLastRunTimestamp();
    const since = lastRun ?? new Date(Date.now() - initialLookbackDays * MS_PER_DAY);

    log.info(`Fetching IonBiz leaves since ${since.toISOString()}`);
    const raw = await ionBiz.listLeavesSince(since);

    const summary: SyncSummary = {
      fetched: raw.length,
      synced: 0,
      skipped: 0,
      failed: 0,
    };

    for (const item of raw) {
      try {
        const internal = ionBizToInternal(item);
        if (await state.hasSynced(internal.ionBizId)) {
          summary.skipped++;
          continue;
        }
        const result = await cobra.createLeave(internalToCobra(internal));
        await state.markSynced(internal.ionBizId, result.ref);
        summary.synced++;
      } catch (err) {
        summary.failed++;
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Failed to sync leave ${item.id}: ${message}`);
      }
    }

    await state.setLastRunTimestamp(runStartedAt);
    return summary;
  },
});
