export type CobraPerson = { id: string; email: string };

export type PersonLeaveEntitlement = {
  id: string;
  personId: string;
  leaveEntitlementId: string;
  remaining?: number;
};

export type PersonLeaveInput = {
  personLeaveEntitlementId: string;
  personId: string;
  from: string;
  to: string;
  use: number;
};

export type PersonLeaveResult = { guid: string };

export type SalaryEmployment = {
  id: string;
  personId: string;
  startDate: string;
  endDate?: string;
};

export type CobraValueType = 'Hours' | 'Days' | 'Amount';

export type CompanySalaryComponentDef = {
  code: string;
  valueType: CobraValueType;
  isConstant: boolean;
};

export type SalaryComponentInput = {
  salaryEmploymentId: string;
  code: string;
  period: string;
  value: number;
  valueType: CobraValueType;
  isConstant: boolean;
};

export type SalaryComponentResult = { guid: string };
