import { IonBizAuth } from './ionbizAuth';
import { IonBizLeave } from '../types/ionbiz';

export type IonBizClient = {
  getLeaveById: (id: number | string) => Promise<IonBizLeave>;
};

// Shape of the OData Leaves entity. Columns are PascalCase and the exact
// names must be confirmed against the live OData metadata / a Postman call.
type ODataLeave = {
  Id: number | string;
  EmployeeId: string;
  StartDate: string;
  EndDate: string;
  LeaveType: string;
  Status: string;
  CreatedAt: string;
  UpdatedAt: string;
};

const odataToIonBizLeave = (raw: ODataLeave): IonBizLeave => ({
  id: String(raw.Id),
  employeeId: raw.EmployeeId,
  startDate: raw.StartDate,
  endDate: raw.EndDate,
  leaveType: raw.LeaveType,
  status: raw.Status,
  createdAt: raw.CreatedAt,
  updatedAt: raw.UpdatedAt,
});

export const createIonBizClient = (cfg: { baseUrl: string }, auth: IonBizAuth): IonBizClient => ({
  getLeaveById: async (id) => {
    const token = await auth.getToken();
    const url = `${cfg.baseUrl}/odata/Leaves(${id})`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`IonBiz getLeaveById(${id}) failed: ${res.status} ${await res.text()}`);
    }
    return odataToIonBizLeave((await res.json()) as ODataLeave);
  },
});
