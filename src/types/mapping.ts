export type LeaveTarget = 'hrm' | 'salary' | 'both';

export type MappingEntry = {
  ionBizLeaveType: string;
  target: LeaveTarget;
  leaveEntitlementId: string;
  salaryCodes: string[];
};
