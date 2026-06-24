import { app, InvocationContext, Timer } from '@azure/functions';
import { createCobraAuth } from '../clients/cobraAuth';
import { createCobraClient } from '../clients/cobraClient';
import { createCobraHttp } from '../clients/cobraHttp';
import { createCobraSalaryClient } from '../clients/cobraSalary';
import { createIonBizAuth } from '../clients/ionbizAuth';
import { createIonBizClient } from '../clients/ionbizClient';
import { loadConfig } from '../config';
import { ionBizToInternal } from '../mappers/leaveMapper';
import { loadMappingTable } from '../mappers/mappingTable';
import { createDeferredQueue } from '../queue/deferredQueue';
import { createExceptionSink } from '../services/exceptions';
import { createLeaveWriter } from '../services/leaveWriter';
import { createSyncStateStore } from '../state/syncStateStore';
import { createRetry } from '../utils/retry';
import type { LeaveAction } from '../types/leave';
import type { WriteStatus } from '../services/leaveWriter';

// CRON FALLBACK. The webhook (ionbizWebhook) is the primary, real-time path.
// TODO(spec §3): this timer is the safety net for missed/failed webhook
// deliveries — it re-pulls leaves over a window and runs the SAME
// decide -> write pipeline so any gaps eventually converge.
// Every 15 minutes (NCRONTAB: sec min hour day month day-of-week).
const SCHEDULE = '0 */15 * * * *';

// yyyy-mm-dd for an OData / GetLeavesPerDay date param.
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

app.timer('scheduledSync', {
  schedule: SCHEDULE,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const config = await loadConfig();

    // Dependency graph — identical to the webhook handler, only the trigger differs.
    const ionBizAuth = createIonBizAuth({
      tokenUrl: `${config.ionBiz.baseUrl}/Oauth/Token`,
      clientId: config.ionBiz.clientId,
      clientSecret: config.ionBiz.clientSecret,
      scope: config.ionBiz.scope,
    });
    const ionBiz = createIonBizClient({ baseUrl: config.ionBiz.baseUrl }, ionBizAuth);

    const cobraAuth = createCobraAuth(config.cobra);
    const retry = createRetry();
    const http = createCobraHttp({ baseUrl: config.cobra.baseUrl }, cobraAuth, retry);
    const cobra = createCobraClient(http);
    const salary = createCobraSalaryClient(http);

    const state = createSyncStateStore(config.storage);
    const queue = createDeferredQueue(config.queue);
    const exceptions = createExceptionSink(context);
    const writer = createLeaveWriter({ cobra, salary, state, queue, exceptions, log: context });
    const mapping = loadMappingTable(config.mapping);

    await state.init();

    // Compute the date window. The CONTRACT SyncStateStore exposes no
    // getLastRunTimestamp/setLastRunTimestamp, so we cannot persist a watermark
    // here and instead always look back `initialLookbackDays` from now.
    // TODO(SD Worx): add a last-run watermark to SyncStateStore so the fallback
    // can pull only `[lastRun - initialLookbackDays, now]` instead of a fixed
    // lookback every run (per spec §3 / gap analysis). The fixed window is safe
    // (re-pulled leaves with an unchanged contentHash decide to `noop`), just
    // less efficient.
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setUTCDate(fromDate.getUTCDate() - config.initialLookbackDays);
    const from = isoDate(fromDate);
    const to = isoDate(now);

    const summary: Record<WriteStatus | 'fetched' | 'noop' | 'unmapped', number> = {
      fetched: 0,
      written: 0,
      deferred: 0,
      skipped: 0,
      failed: 0,
      noop: 0,
      unmapped: 0,
    };

    const leaves = await ionBiz.getLeavesPerDay(from, to);
    summary.fetched = leaves.length;

    for (const raw of leaves) {
      const leave = ionBizToInternal(raw);

      const entry = mapping.lookup(leave.leaveType);
      if (!entry) {
        summary.unmapped++;
        exceptions.record({
          ionBizId: leave.ionBizId,
          reason: 'unmapped-leave-type',
          detail: `leaveType=${leave.leaveType}`,
        });
        continue;
      }

      // The fallback only ever sees the current snapshot of a leave, so it acts
      // as insert/update; deletes are driven by the webhook. decide() compares
      // the contentHash and returns insert | update | noop.
      const action: LeaveAction = 'update';
      const decision = await state.decide(leave, action);
      if (decision === 'noop') {
        summary.noop++;
        continue;
      }

      const outcome = await writer.write(leave, entry, decision);
      summary[outcome.status]++;
    }

    context.info(
      `scheduledSync run [${from}..${to}] summary: ${JSON.stringify(summary)}; ` +
        `exceptions=${exceptions.items().length}`,
    );
  },
});
