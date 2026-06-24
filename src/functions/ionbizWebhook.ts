import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { createCobraClient } from '../clients/cobraClient';
import { createIonBizAuth } from '../clients/ionbizAuth';
import { createIonBizClient } from '../clients/ionbizClient';
import { loadConfig } from '../config';
import { createWebhookLeaveSyncService } from '../services/webhookLeaveSync';
import { createSyncStateStore } from '../state/syncStateStore';
import { IonBizWebhookPayload } from '../types/webhook';
import { verifyIonbizSignature } from '../webhooks/signature';

app.http('ionbizWebhook', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const config = loadConfig();

    // Read the raw body once and use it for BOTH signature verification and
    // parsing — never re-serialize before hashing or the HMAC won't match.
    const raw = await request.text();

    if (!verifyIonbizSignature(raw, request.headers.get('ms-signature'), config.webhook.secret)) {
      context.warn('Rejected IonBiz webhook: invalid ms-signature');
      return { status: 401 };
    }

    let payload: IonBizWebhookPayload;
    try {
      payload = JSON.parse(raw) as IonBizWebhookPayload;
    } catch {
      return { status: 400 };
    }

    const ionBizAuth = createIonBizAuth({
      tokenUrl: `${config.ionBiz.baseUrl}/Oauth/Token`,
      clientId: config.ionBiz.clientId,
      clientSecret: config.ionBiz.clientSecret,
      scope: config.ionBiz.scope,
    });

    const service = createWebhookLeaveSyncService({
      ionBiz: createIonBizClient({ baseUrl: config.ionBiz.baseUrl }, ionBizAuth),
      cobra: createCobraClient(config.cobra),
      state: createSyncStateStore(config.storage),
      log: context,
      insertAction: config.webhook.leaveInsertAction,
    });

    const summary = await service.processPayload(payload);
    context.info(`Webhook ${payload.Id} (attempt ${payload.Attempt}) summary: ${JSON.stringify(summary)}`);

    // Signal failure so IonBiz retries (3x / 1 min). Synced rows are recorded
    // in state, so retries skip them and only re-attempt the failures.
    if (summary.failed > 0) return { status: 500 };
    return { status: 200 };
  },
});
