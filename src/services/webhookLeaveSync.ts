import { InvocationContext } from '@azure/functions';
import { CobraClient } from '../clients/cobraClient';
import { IonBizClient } from '../clients/ionbizClient';
import { ionBizToInternal, internalToCobra } from '../mappers/leaveMapper';
import { SyncStateStore } from '../state/syncStateStore';
import { IonBizWebhookPayload } from '../types/webhook';

export type SyncSummary = {
  fetched: number;
  synced: number;
  skipped: number;
  failed: number;
};

export type WebhookLeaveSyncService = {
  processPayload: (payload: IonBizWebhookPayload) => Promise<SyncSummary>;
};

export const createWebhookLeaveSyncService = (deps: {
  ionBiz: IonBizClient;
  cobra: CobraClient;
  state: SyncStateStore;
  log: InvocationContext;
  insertAction: string;
}): WebhookLeaveSyncService => ({
  processPayload: async (payload) => {
    const { ionBiz, cobra, state, log, insertAction } = deps;

    await state.init();

    const notifications = payload.Notifications ?? [];
    const summary: SyncSummary = {
      fetched: notifications.length,
      synced: 0,
      skipped: 0,
      failed: 0,
    };

    for (const notification of notifications) {
      // Insert-only: ignore updates/deletes and any non-leave actions.
      if (notification.Action !== insertAction) {
        summary.skipped++;
        continue;
      }

      try {
        const raw = await ionBiz.getLeaveById(notification.Id);
        const internal = ionBizToInternal(raw);
        // Dedupe also makes IonBiz's retries (3x / 1 min) idempotent.
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
        log.error(`Failed to sync leave ${notification.Id}: ${message}`);
      }
    }

    return summary;
  },
});
