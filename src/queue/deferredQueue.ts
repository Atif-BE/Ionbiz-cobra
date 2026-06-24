import { QueueClient } from '@azure/storage-queue';

// Technical identifiers only — no personal data crosses the queue boundary.
export type DeferredMessage = {
  companyId: string;
  ionBizId: string;
  personId: string;
  salaryEmploymentId: string;
  codes: string[];
  period: string;
};

export type DeferredQueue = {
  enqueue: (msg: DeferredMessage, delaySeconds?: number) => Promise<void>;
};

export const createDeferredQueue = (cfg: {
  connectionString: string;
  queueName: string;
}): DeferredQueue => {
  const client = new QueueClient(cfg.connectionString, cfg.queueName);
  let ensured = false;

  const ensureQueue = async () => {
    if (ensured) return;
    await client.createIfNotExists();
    ensured = true;
  };

  return {
    enqueue: async (msg, delaySeconds) => {
      await ensureQueue();
      // Storage Queue convention: payloads are base64-encoded text.
      const encoded = Buffer.from(JSON.stringify(msg), 'utf8').toString('base64');
      await client.sendMessage(encoded, {
        visibilityTimeout: delaySeconds && delaySeconds > 0 ? delaySeconds : undefined,
      });
    },
  };
};
