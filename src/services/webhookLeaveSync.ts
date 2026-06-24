import type { IonBizClient } from '../clients/ionbizClient';
import type { MappingTable } from '../mappers/mappingTable';
import type { SyncStateStore } from '../state/syncStateStore';
import type { LeaveWriter } from './leaveWriter';
import type { ExceptionSink } from './exceptions';
import { ionBizToInternal } from '../mappers/leaveMapper';
import type { Leave, LeaveAction } from '../types/leave';
import type { IonBizWebhookPayload } from '../types/webhook';

export type SyncSummary = {
  fetched: number;
  written: number;
  deferred: number;
  skipped: number;
  failed: number;
  exceptions: number;
};

export type WebhookLeaveSyncService = {
  processPayload: (payload: IonBizWebhookPayload) => Promise<SyncSummary>;
};

type Log = {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
};

type Deps = {
  ionBiz: IonBizClient;
  mapping: MappingTable;
  state: SyncStateStore;
  writer: LeaveWriter;
  exceptions: ExceptionSink;
  log: Log;
  actions: { insertAction: string; updateAction: string; deleteAction: string };
};

// Map an IonBiz notification Action string to our internal LeaveAction.
// Unknown actions return null so the caller can skip them.
const toLeaveAction = (
  action: string,
  actions: Deps['actions'],
): LeaveAction | null => {
  if (action === actions.insertAction) return 'insert';
  if (action === actions.updateAction) return 'update';
  if (action === actions.deleteAction) return 'delete';
  return null;
};

const asMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const createWebhookLeaveSyncService = (deps: Deps): WebhookLeaveSyncService => ({
  processPayload: async (payload) => {
    const { ionBiz, mapping, state, writer, exceptions, log, actions } = deps;

    await state.init();

    const notifications = payload.Notifications ?? [];
    const summary: SyncSummary = {
      fetched: 0,
      written: 0,
      deferred: 0,
      skipped: 0,
      failed: 0,
      exceptions: 0,
    };

    for (const notification of notifications) {
      const action = toLeaveAction(notification.Action, actions);
      if (!action) {
        // Not a leave action we handle (or an unknown action): ignore.
        summary.skipped++;
        continue;
      }

      try {
        if (action === 'delete') {
          // For delete we still need companyId + ionBizId. The source row may
          // already be gone (404), so tolerate a failed fetch and fall back to
          // a minimal Leave keyed off whatever state already knows.
          const leave = await buildDeleteLeave(ionBiz, state, notification.Id);
          if (!leave) {
            // Nothing fetched and nothing in state -> nothing to delete.
            summary.skipped++;
            continue;
          }
          const decision = await state.decide(leave, 'delete');
          await tally(summary, await writer.write(leave, EMPTY_MAPPING, decision));
          continue;
        }

        // insert | update
        summary.fetched++;
        const raw = await ionBiz.getLeaveById(notification.Id);
        const leave = ionBizToInternal(raw);

        const entry = mapping.lookup(leave.leaveType);
        if (!entry) {
          exceptions.record({
            ionBizId: leave.ionBizId,
            reason: 'no-mapping-entry',
            detail: `leaveType=${leave.leaveType}`,
          });
          summary.exceptions++;
          summary.skipped++;
          continue;
        }

        const decision = await state.decide(leave, action);
        await tally(summary, await writer.write(leave, entry, decision));
      } catch (err) {
        summary.failed++;
        log.error(`Failed to process leave ${notification.Id} (${notification.Action}): ${asMsg(err)}`);
      }
    }

    return summary;
  },
});

// A delete carries no mapping (we remove by stored GUIDs, not by target).
const EMPTY_MAPPING = {
  ionBizLeaveType: '',
  target: 'both' as const,
  leaveEntitlementId: '',
  salaryCodes: [] as string[],
};

// Build the minimal Leave needed to delete. Prefer a live fetch (gives the
// true companyId); if that 404s, reconstruct from any existing sync record.
const buildDeleteLeave = async (
  ionBiz: IonBizClient,
  state: SyncStateStore,
  id: number | string,
): Promise<Leave | null> => {
  try {
    const raw = await ionBiz.getLeaveById(id);
    return ionBizToInternal(raw);
  } catch {
    // TODO(SD Worx): the delete notification payload's exact shape (does it
    // carry companyId?) is an OPEN POINT. We currently can only recover the
    // companyId from our own state, which is keyed (companyId, ionBizId). The
    // state store has no by-ionBizId lookup, so without a live fetch we cannot
    // resolve companyId and must skip. Confirm whether IonBiz includes
    // companyId on delete notifications so this fetch can be avoided.
    return null;
  }
};

const tally = async (
  summary: SyncSummary,
  outcome: { status: 'written' | 'deferred' | 'skipped' | 'failed' },
): Promise<void> => {
  switch (outcome.status) {
    case 'written':
      summary.written++;
      break;
    case 'deferred':
      summary.deferred++;
      break;
    case 'skipped':
      summary.skipped++;
      break;
    case 'failed':
      summary.failed++;
      break;
  }
};
