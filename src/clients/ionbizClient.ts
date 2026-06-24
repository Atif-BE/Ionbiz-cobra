import { IonBizAuth } from './ionbizAuth';
import { IonBizLeave } from '../types/ionbiz';

export type IonBizClient = {
  getLeaveById: (id: number | string) => Promise<IonBizLeave>;
  // CRON fallback source: ranged fetch over the IonBiz GetLeavesPerDay endpoint.
  getLeavesPerDay: (from: string, to: string) => Promise<IonBizLeave[]>;
};

// Shape of the OData Leaves entity. Columns are PascalCase and the exact
// names must be confirmed against the live OData metadata / a Postman call.
type ODataLeave = {
  Id: number | string;
  // TODO(SD Worx): confirm the employee email column name (OPEN POINT, PDF §11).
  // Assumed `Email`; may instead live on a related Employee navigation property.
  Email: string;
  // TODO(SD Worx): confirm the company key column name/casing (assumed `CompanyId`).
  CompanyId: string | number;
  EmployeeId: string;
  StartDate: string;
  EndDate: string;
  // TODO(SD Worx): confirm the leave type/code column (assumed `LeaveType`).
  LeaveType: string;
  // TODO(SD Worx): confirm the use-value (days) column name (assumed `Days`);
  // may be `Use`, `Value` or `NumberOfDays` against live metadata.
  Days: number;
  Status: string;
  CreatedAt: string;
  UpdatedAt: string;
};

const odataToIonBizLeave = (raw: ODataLeave): IonBizLeave => ({
  id: String(raw.Id),
  email: raw.Email,
  companyId: String(raw.CompanyId),
  employeeId: raw.EmployeeId,
  startDate: raw.StartDate,
  endDate: raw.EndDate,
  leaveType: raw.LeaveType,
  days: raw.Days,
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

  getLeavesPerDay: async (from, to) => {
    const token = await auth.getToken();
    // TODO(SD Worx): confirm the exact GetLeavesPerDay endpoint path and its
    // date parameter names/format. Assumed an OData function import taking
    // `from`/`to` ISO yyyy-mm-dd query params and returning an OData collection.
    const url =
      `${cfg.baseUrl}/odata/GetLeavesPerDay` +
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `IonBiz getLeavesPerDay(${from}..${to}) failed: ${res.status} ${await res.text()}`,
      );
    }
    // OData collections wrap rows under `value`; tolerate a bare array too.
    const data = (await res.json()) as { value?: ODataLeave[] } | ODataLeave[];
    const rows = Array.isArray(data) ? data : data.value ?? [];
    return rows.map(odataToIonBizLeave);
  },
});
