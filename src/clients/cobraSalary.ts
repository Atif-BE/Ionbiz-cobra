import { CobraHttp } from './cobraHttp';
import {
  CobraValueType,
  CompanySalaryComponentDef,
  SalaryComponentInput,
  SalaryComponentResult,
  SalaryEmployment,
} from '../types/cobra';

export type CobraSalaryClient = {
  resolveSalaryEmployment: (personId: string, onDate: string) => Promise<SalaryEmployment | null>;
  getCompanySalaryComponent: (code: string) => Promise<CompanySalaryComponentDef | null>;
  createSalaryComponent: (input: SalaryComponentInput) => Promise<SalaryComponentResult>;
};

// OData rows come back with PascalCase property names and GUID keys.
// TODO(SD Worx): open point 1 - confirm the exact OData entity set names and
// field names below (SalaryEmployment / CompanySalaryComponent / SalaryComponent).
type SalaryEmploymentRow = {
  Id: string;
  PersonId: string;
  StartDate: string;
  EndDate?: string | null;
};

type CompanySalaryComponentRow = {
  Code: string;
  ValueType?: string;
  IsConstant?: boolean;
};

const odataEscape = (v: string): string => v.replace(/'/g, "''");

// Map a raw Cobra ValueType onto our narrowed union.
// TODO(SD Worx): open point 1 - confirm the catalog's ValueType enumeration
// (e.g. numeric codes vs the strings Hours/Days/Amount).
const toValueType = (raw: string | undefined): CobraValueType => {
  switch ((raw ?? '').toLowerCase()) {
    case 'hours':
      return 'Hours';
    case 'days':
      return 'Days';
    case 'amount':
      return 'Amount';
    default:
      throw new Error(`cobraSalary: unknown CompanySalaryComponent ValueType '${raw}'`);
  }
};

export const createCobraSalaryClient = (http: CobraHttp): CobraSalaryClient => ({
  resolveSalaryEmployment: async (personId, onDate) => {
    // Window: employment that started on/before onDate and has not ended before it.
    // TODO(SD Worx): open point 1 - confirm OData date literal handling; some Cobra
    // endpoints expect bare ISO dates, others a datetime'...' literal.
    const filter =
      `PersonId eq '${odataEscape(personId)}'` +
      ` and StartDate le ${onDate}` +
      ` and (EndDate eq null or EndDate ge ${onDate})`;
    const rows = await http.getList<SalaryEmploymentRow>(
      `/SalaryEmployment?$filter=${encodeURIComponent(filter)}`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.Id,
      personId: row.PersonId,
      startDate: row.StartDate,
      endDate: row.EndDate ?? undefined,
    };
  },

  getCompanySalaryComponent: async (code) => {
    const filter = `Code eq '${odataEscape(code)}'`;
    const rows = await http.getList<CompanySalaryComponentRow>(
      `/CompanySalaryComponent?$filter=${encodeURIComponent(filter)}`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      code: row.Code,
      valueType: toValueType(row.ValueType),
      // isConstant is DERIVED from the catalog, never hard-coded.
      // TODO(SD Worx): open point 1 - confirm the catalog field that flags a
      // constant component (assumed boolean IsConstant here).
      isConstant: row.IsConstant === true,
    };
  },

  createSalaryComponent: async (input) => {
    // The value lands in exactly one of Hours / Days / Amount per the value type.
    // TODO(SD Worx): open point 2 - the SalaryComponent write payload (field
    // names, period encoding, whether value goes in a single Value field vs a
    // typed Hours/Days/Amount field) is NOT confirmed. Best-effort payload below.
    const body: Record<string, unknown> = {
      SalaryEmploymentId: input.salaryEmploymentId,
      Code: input.code,
      // TODO(SD Worx): open point 1 - confirm the period field name/format
      // (Period vs StartPeriod, 'yyyy-mm' vs other encoding).
      Period: input.period,
      IsConstant: input.isConstant,
    };

    switch (input.valueType) {
      case 'Hours':
        body.Hours = input.value;
        break;
      case 'Days':
        body.Days = input.value;
        break;
      case 'Amount':
        body.Amount = input.value;
        break;
      default:
        // Refuse to write a payload we cannot responsibly shape.
        throw new Error(
          `cobraSalary.createSalaryComponent: value field for valueType '${input.valueType}' not confirmed`,
        );
    }

    const res = await http.post<SalaryComponentResult>('/SalaryComponent', body);
    return res;
  },
});
