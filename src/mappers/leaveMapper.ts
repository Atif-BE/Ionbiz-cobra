import type { IonBizLeave } from '../types/ionbiz';
import type { Leave } from '../types/leave';

export const ionBizToInternal = (raw: IonBizLeave): Leave => ({
  ionBizId: raw.id,
  email: raw.email.trim().toLowerCase(),
  companyId: raw.companyId,
  startDate: raw.startDate,
  endDate: raw.endDate,
  leaveType: raw.leaveType,
  days: raw.days,
  status: raw.status,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});
