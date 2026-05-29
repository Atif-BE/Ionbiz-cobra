import { CobraLeave } from '../types/cobra';
import { IonBizLeave } from '../types/ionbiz';
import { Leave } from '../types/leave';

export const ionBizToInternal = (raw: IonBizLeave): Leave => ({
  ionBizId: raw.id,
  employeeId: raw.employeeId,
  startDate: raw.startDate,
  endDate: raw.endDate,
  leaveType: raw.leaveType,
  status: raw.status,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

export const internalToCobra = (leave: Leave): CobraLeave => ({
  employeeId: leave.employeeId,
  startDate: leave.startDate,
  endDate: leave.endDate,
  leaveType: leave.leaveType,
});
