import { createHash } from 'node:crypto';
import type { Leave } from '../types/leave';

// One-way fingerprint over the delta-relevant fields only.
// Stable field order so equal leaves always hash identically.
// We never persist the source data itself, only this hash.
export const contentHash = (leave: Leave): string => {
  const stable = JSON.stringify([
    leave.startDate,
    leave.endDate,
    leave.leaveType,
    leave.days,
    leave.status,
  ]);
  return createHash('sha256').update(stable, 'utf8').digest('hex');
};
