import { CobraHttp } from './cobraHttp';
import {
  CobraPerson,
  PersonLeaveEntitlement,
  PersonLeaveInput,
  PersonLeaveResult,
} from '../types/cobra';

// Domain client over the Cobra OData API. All entity/field/key casing follows
// the Solvify analysis; spots not yet confirmed against live metadata are
// flagged with TODO(SD Worx).
export type CobraClient = {
  findPersonByEmail: (email: string) => Promise<CobraPerson[]>;
  resolvePersonLeaveEntitlement: (
    personId: string,
    leaveEntitlementId: string,
  ) => Promise<PersonLeaveEntitlement | null>;
  createPersonLeave: (input: PersonLeaveInput) => Promise<PersonLeaveResult>;
  updatePersonLeave: (guid: string, patch: Partial<PersonLeaveInput>) => Promise<void>;
  deletePersonLeave: (guid: string) => Promise<void>;
  getCompanyProcessingState: (companyId: string) => Promise<number>;
};

// OData string literals must have single quotes escaped by doubling them.
const odataString = (v: string): string => `'${v.replace(/'/g, "''")}'`;

// OData GUID key segment, e.g. PersonLeave(guid'xxxxxxxx-...').
// TODO(SD Worx): confirm Cobra expects the `guid'...'` literal form vs a bare
// key segment `(xxxxxxxx-...)`; both occur in OData v3/v4 implementations.
const guidKey = (guid: string): string => `(guid'${guid}')`;

// OData rows for the entities we read. PascalCase per OData convention.
// TODO(SD Worx): confirm exact field names/casing against live $metadata.
type PersonRow = { Id: string; Email: string };
type PersonLeaveEntitlementRow = {
  Id: string;
  PersonId: string;
  LeaveEntitlementId: string;
  Remaining?: number;
};
type CompanyRow = { ProcessingState: number };

export const createCobraClient = (http: CobraHttp): CobraClient => ({
  findPersonByEmail: async (email) => {
    const normalized = email.trim().toLowerCase();
    // TODO(SD Worx): confirm the person email entity/collection name (assumed
    // `Email`) and that the address column is `Email`.
    const path = `/Email?$filter=${encodeURIComponent(
      `Email eq ${odataString(normalized)}`,
    )}`;
    const rows = await http.getList<PersonRow>(path);
    return rows.map((r): CobraPerson => ({ id: r.Id, email: r.Email }));
  },

  resolvePersonLeaveEntitlement: async (personId, leaveEntitlementId) => {
    // TODO(SD Worx): confirm filter field names PersonId / LeaveEntitlementId.
    const filter = `PersonId eq ${odataString(personId)} and LeaveEntitlementId eq ${odataString(
      leaveEntitlementId,
    )}`;
    const path = `/PersonLeaveEntitlement?$filter=${encodeURIComponent(filter)}`;
    const rows = await http.getList<PersonLeaveEntitlementRow>(path);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.Id,
      personId: r.PersonId,
      leaveEntitlementId: r.LeaveEntitlementId,
      remaining: r.Remaining,
    };
  },

  createPersonLeave: async (input) => {
    // TODO(SD Worx): confirm POST body property names (assumed PascalCase
    // PersonLeaveEntitlementId / PersonId / From / To / Use).
    const body = {
      PersonLeaveEntitlementId: input.personLeaveEntitlementId,
      PersonId: input.personId,
      From: input.from,
      To: input.to,
      Use: input.use,
    };
    // TODO(SD Worx): confirm the created entity returns its key as `Id`/`guid`.
    const created = await http.post<{ Id?: string; guid?: string }>('/PersonLeave', body);
    const guid = created.guid ?? created.Id;
    if (!guid) throw new Error('Cobra createPersonLeave: missing guid in response');
    return { guid };
  },

  updatePersonLeave: async (guid, patch) => {
    const body: Record<string, unknown> = {};
    if (patch.personLeaveEntitlementId !== undefined)
      body.PersonLeaveEntitlementId = patch.personLeaveEntitlementId;
    if (patch.personId !== undefined) body.PersonId = patch.personId;
    if (patch.from !== undefined) body.From = patch.from;
    if (patch.to !== undefined) body.To = patch.to;
    if (patch.use !== undefined) body.Use = patch.use;
    await http.patch(`/PersonLeave${guidKey(guid)}`, body);
  },

  deletePersonLeave: async (guid) => {
    await http.del(`/PersonLeave${guidKey(guid)}`);
  },

  getCompanyProcessingState: async (companyId) => {
    // TODO(SD Worx): confirm Company key type (GUID assumed) and that the
    // payroll lock field is named `ProcessingState`.
    const row = await http.get<CompanyRow>(`/Company${guidKey(companyId)}`);
    return row.ProcessingState;
  },
});
