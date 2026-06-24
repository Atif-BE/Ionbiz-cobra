export type LeaveAction = 'insert' | 'update' | 'delete';

export type Leave = {
  ionBizId: string;
  email: string;
  companyId: string;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string; // ISO yyyy-mm-dd
  leaveType: string; // IonBiz source leave type/code
  days: number; // Use value, in days
  status: string;
  createdAt: string;
  updatedAt: string;
};
