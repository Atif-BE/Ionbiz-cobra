export type ExceptionItem = { ionBizId: string; reason: string; detail?: string };
export type ExceptionSink = { record: (item: ExceptionItem) => void; items: () => ExceptionItem[] };

// Escalation/alert hook for non-fatal-but-must-notice cases:
// non-matchable person, missing entitlement, unknown salary code, etc.
// Collected in memory so a run summary can report on the full set.
export const createExceptionSink = (log: { warn: (m: string) => void }): ExceptionSink => {
  const list: ExceptionItem[] = [];
  return {
    record: (item) => {
      list.push(item);
      log.warn(`[exception] ${item.ionBizId}: ${item.reason}${item.detail ? ` (${item.detail})` : ''}`);
      // TODO(alert): wire an out-of-band alert here (e.g. email/Teams/PagerDuty)
      // for items that require human follow-up so they are not lost in logs.
    },
    items: () => list.slice(),
  };
};
