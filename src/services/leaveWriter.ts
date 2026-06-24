import type { Leave } from '../types/leave';
import type { MappingEntry } from '../types/mapping';
import type {
  CompanySalaryComponentDef,
  PersonLeaveInput,
  SalaryComponentInput,
  SalaryEmployment,
} from '../types/cobra';
import type { CobraClient } from '../clients/cobraClient';
import type { CobraSalaryClient } from '../clients/cobraSalary';
import type { DeferredQueue } from '../queue/deferredQueue';
import type { ExceptionSink } from './exceptions';
import { contentHash } from '../utils/contentHash';
import { salaryPeriod } from '../utils/salaryPeriod';
import type { LeaveSyncRecord, SyncDecision, SyncStateStore } from '../state/syncStateStore';

export type WriteStatus = 'written' | 'deferred' | 'skipped' | 'failed';

export type WriteOutcome = { ionBizId: string; status: WriteStatus; detail?: string };

export type LeaveWriter = {
  write: (leave: Leave, mapping: MappingEntry, decision: SyncDecision) => Promise<WriteOutcome>;
};

// Cobra's processing state where 1 == unlocked/open for writing. Anything else is locked.
const PROCESSING_STATE_UNLOCKED = 1;

type Log = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };

type Deps = {
  cobra: CobraClient;
  salary: CobraSalaryClient;
  state: SyncStateStore;
  queue: DeferredQueue;
  exceptions: ExceptionSink;
  log: Log;
};

const wantsSalary = (target: MappingEntry['target']): boolean =>
  target === 'salary' || target === 'both';

export const createLeaveWriter = (deps: Deps): LeaveWriter => {
  const { cobra, salary, state, queue, exceptions, log } = deps;

  const handleDelete = async (leave: Leave): Promise<WriteOutcome> => {
    const record = await state.get(leave.companyId, leave.ionBizId);
    if (!record) {
      log.info(`leaveWriter.delete: no state for ${leave.ionBizId}, nothing to remove`);
      await state.remove(leave.companyId, leave.ionBizId);
      return { ionBizId: leave.ionBizId, status: 'written' };
    }
    if (record.personLeaveGuid) {
      await cobra.deletePersonLeave(record.personLeaveGuid);
    }
    for (const guid of record.salaryComponentGuids) {
      // TODO(SD Worx): the CobraSalaryClient contract has no SalaryComponent delete
      // yet. We delete via the generic Cobra delete-by-guid path; confirm the correct
      // endpoint (and whether locked-period salary rows can be deleted at all).
      await cobra.deletePersonLeave(guid);
    }
    await state.remove(leave.companyId, leave.ionBizId);
    log.info(`leaveWriter.delete: removed ${leave.ionBizId}`);
    return { ionBizId: leave.ionBizId, status: 'written' };
  };

  const handleUpsert = async (
    leave: Leave,
    mapping: MappingEntry,
    decision: Extract<SyncDecision, 'insert' | 'update'>,
  ): Promise<WriteOutcome> => {
    const prior = await state.get(leave.companyId, leave.ionBizId);

    // 1) Resolve the person. Never guess: 0 or >1 matches is an exception.
    const persons = await cobra.findPersonByEmail(leave.email);
    if (persons.length !== 1) {
      const reason = persons.length === 0 ? 'no-person-match' : 'ambiguous-person-match';
      exceptions.record({
        ionBizId: leave.ionBizId,
        reason,
        detail: `${persons.length} Cobra persons for email ${leave.email}`,
      });
      return { ionBizId: leave.ionBizId, status: 'skipped', detail: reason };
    }
    const person = persons[0];

    const doSalary = wantsSalary(mapping.target);

    // 3a) Salary atomicity gate: if salary is in scope but the company is locked,
    // defer the WHOLE leave (HRM included) so Cobra never ends up half-written.
    if (doSalary) {
      const procState = await cobra.getCompanyProcessingState(leave.companyId);
      if (procState !== PROCESSING_STATE_UNLOCKED) {
        return deferWholeLeave(leave, mapping, person.id, prior, procState);
      }
    }

    // 2) HRM target (always done for insert/update).
    const entitlement = await cobra.resolvePersonLeaveEntitlement(
      person.id,
      mapping.leaveEntitlementId,
    );
    if (!entitlement) {
      exceptions.record({
        ionBizId: leave.ionBizId,
        reason: 'no-person-leave-entitlement',
        detail: `personId=${person.id} leaveEntitlementId=${mapping.leaveEntitlementId}`,
      });
      return { ionBizId: leave.ionBizId, status: 'skipped', detail: 'no-person-leave-entitlement' };
    }

    const leaveInput: PersonLeaveInput = {
      personLeaveEntitlementId: entitlement.id,
      personId: person.id,
      from: leave.startDate,
      to: leave.endDate,
      use: leave.days,
    };

    let personLeaveGuid: string | undefined = prior?.personLeaveGuid;
    if (decision === 'update' && personLeaveGuid) {
      await cobra.updatePersonLeave(personLeaveGuid, leaveInput);
    } else {
      const res = await cobra.createPersonLeave(leaveInput);
      personLeaveGuid = res.guid;
    }

    // 3b) Salary target (company already confirmed unlocked above).
    const salaryComponentGuids: string[] = [];
    let salaryEmploymentId: string | undefined = prior?.salaryEmploymentId;
    if (doSalary) {
      let employment: SalaryEmployment | null;
      try {
        employment = await salary.resolveSalaryEmployment(person.id, leave.startDate);
      } catch (err) {
        return compensate(leave, personLeaveGuid, [], asMsg(err));
      }
      if (!employment) {
        exceptions.record({
          ionBizId: leave.ionBizId,
          reason: 'no-salary-employment',
          detail: `personId=${person.id} onDate=${leave.startDate}`,
        });
        return compensate(leave, personLeaveGuid, [], 'no-salary-employment');
      }
      salaryEmploymentId = employment.id;
      const period = salaryPeriod(leave.startDate);

      for (const code of mapping.salaryCodes) {
        let def: CompanySalaryComponentDef | null;
        try {
          def = await salary.getCompanySalaryComponent(code);
        } catch (err) {
          return compensate(leave, personLeaveGuid, salaryComponentGuids, asMsg(err));
        }
        if (!def) {
          exceptions.record({
            ionBizId: leave.ionBizId,
            reason: 'unknown-salary-code',
            detail: `code=${code} companyId=${leave.companyId}`,
          });
          return compensate(leave, personLeaveGuid, salaryComponentGuids, `unknown-salary-code:${code}`);
        }
        // TODO(SD Worx): confirm the salary value mapping. We assume the leave's `days`
        // value carries straight through and is reinterpreted per the component's
        // valueType (Hours/Days/Amount) on the Cobra side. Hours/Amount conversions
        // (e.g. days*hoursPerDay) are an OPEN POINT and must be confirmed.
        const input: SalaryComponentInput = {
          salaryEmploymentId: employment.id,
          code: def.code,
          period,
          value: leave.days,
          valueType: def.valueType,
          isConstant: def.isConstant,
        };
        try {
          const res = await salary.createSalaryComponent(input);
          salaryComponentGuids.push(res.guid);
        } catch (err) {
          return compensate(leave, personLeaveGuid, salaryComponentGuids, asMsg(err));
        }
      }
    }

    // 5) Persist success.
    const record: LeaveSyncRecord = {
      companyId: leave.companyId,
      ionBizId: leave.ionBizId,
      personLeaveGuid,
      salaryComponentGuids,
      personLeaveEntitlementId: entitlement.id,
      salaryEmploymentId,
      status: 'done',
      contentHash: contentHash(leave),
      attemptCount: 0,
      lastTriedAt: new Date().toISOString(),
    };
    await state.upsert(record);
    log.info(`leaveWriter.${decision}: wrote ${leave.ionBizId}`);
    return { ionBizId: leave.ionBizId, status: 'written' };
  };

  // Defer everything for a locked company. We do not touch HRM (atomicity).
  const deferWholeLeave = async (
    leave: Leave,
    mapping: MappingEntry,
    personId: string,
    prior: LeaveSyncRecord | null,
    procState: number,
  ): Promise<WriteOutcome> => {
    // We need a SalaryEmployment id for the deferred message; resolve best-effort.
    let salaryEmploymentId = prior?.salaryEmploymentId ?? '';
    try {
      const employment = await salary.resolveSalaryEmployment(personId, leave.startDate);
      if (employment) salaryEmploymentId = employment.id;
    } catch {
      // Resolution will be retried when the deferred message is processed.
    }
    const msg = {
      companyId: leave.companyId,
      ionBizId: leave.ionBizId,
      personId,
      salaryEmploymentId,
      codes: mapping.salaryCodes,
      period: salaryPeriod(leave.startDate),
    };
    await queue.enqueue(msg);
    const record: LeaveSyncRecord = {
      companyId: leave.companyId,
      ionBizId: leave.ionBizId,
      personLeaveGuid: prior?.personLeaveGuid,
      salaryComponentGuids: prior?.salaryComponentGuids ?? [],
      personLeaveEntitlementId: prior?.personLeaveEntitlementId,
      salaryEmploymentId: salaryEmploymentId || undefined,
      status: 'pending-salary',
      contentHash: contentHash(leave),
      attemptCount: (prior?.attemptCount ?? 0) + 1,
      lastTriedAt: new Date().toISOString(),
    };
    await state.upsert(record);
    log.warn(
      `leaveWriter: company ${leave.companyId} locked (state=${procState}); deferred ${leave.ionBizId}`,
    );
    return { ionBizId: leave.ionBizId, status: 'deferred', detail: `company-locked:${procState}` };
  };

  // Compensation: roll back what was already written so Cobra never has HRM
  // without salary (or partial salary). Best-effort; on rollback failure we
  // surface an exception flagging the inconsistency.
  const compensate = async (
    leave: Leave,
    personLeaveGuid: string | undefined,
    salaryComponentGuids: string[],
    detail: string,
  ): Promise<WriteOutcome> => {
    log.error(`leaveWriter: write failed for ${leave.ionBizId} (${detail}); compensating`);
    try {
      for (const guid of salaryComponentGuids) {
        // TODO(SD Worx): use the dedicated SalaryComponent delete endpoint once the
        // salary client exposes it; until then compensation of salary rows is limited.
        await cobra.deletePersonLeave(guid);
      }
      if (personLeaveGuid) {
        await cobra.deletePersonLeave(personLeaveGuid);
      }
      await state.remove(leave.companyId, leave.ionBizId);
    } catch (rollbackErr) {
      exceptions.record({
        ionBizId: leave.ionBizId,
        reason: 'inconsistent-after-failed-write',
        detail: `original=${detail}; rollback=${asMsg(rollbackErr)}`,
      });
      return { ionBizId: leave.ionBizId, status: 'failed', detail: 'inconsistent-after-failed-write' };
    }
    return { ionBizId: leave.ionBizId, status: 'failed', detail };
  };

  return {
    write: async (leave, mapping, decision) => {
      if (decision === 'noop') {
        return { ionBizId: leave.ionBizId, status: 'skipped' };
      }
      try {
        if (decision === 'delete') {
          return await handleDelete(leave);
        }
        return await handleUpsert(leave, mapping, decision);
      } catch (err) {
        const detail = asMsg(err);
        log.error(`leaveWriter.${decision}: failed for ${leave.ionBizId}: ${detail}`);
        return { ionBizId: leave.ionBizId, status: 'failed', detail };
      }
    },
  };
};

const asMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));
