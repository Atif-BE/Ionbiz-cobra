import { app, InvocationContext, Timer } from '@azure/functions';
import { createCobraClient } from '../clients/cobraClient';
import { createIonBizAuth } from '../clients/ionbizAuth';
import { createIonBizClient } from '../clients/ionbizClient';
import { loadConfig } from '../config';
import { createLeaveSyncService } from '../services/leaveSync';
import { createSyncStateStore } from '../state/syncStateStore';

app.timer('dailyLeaveSync', {
  schedule: '0 0 2 * * *',
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const config = loadConfig();

    const ionBizAuth = createIonBizAuth({
      tokenUrl: `${config.ionBiz.baseUrl}/Oauth/Token`,
      clientId: config.ionBiz.clientId,
      clientSecret: config.ionBiz.clientSecret,
      scope: config.ionBiz.scope,
    });

    const service = createLeaveSyncService({
      ionBiz: createIonBizClient({ baseUrl: config.ionBiz.baseUrl }, ionBizAuth),
      cobra: createCobraClient(config.cobra),
      state: createSyncStateStore(config.storage),
      log: context,
      initialLookbackDays: config.initialLookbackDays,
    });

    const summary = await service.syncLeaves();
    context.info(`Leave sync summary: ${JSON.stringify(summary)}`);
  },
});
