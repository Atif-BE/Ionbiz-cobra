# Gap Analysis — IonBiz ↔ Cobra v2.0

Reference: Solvify "Technische Analyse IonBiz-Cobra v2.0".
Date: 2026-06-24.

This document compares the **current skeleton** (`main` @ `4bbd4e8`) with the **v2.0 spec**
and the authoritative CONTRACTS, and lists the concrete work per area.

## Current skeleton — what exists today

The repo today implements a thin **insert-only** webhook path:

- `src/functions/ionbizWebhook.ts` — HTTP-triggered Azure Function. Reads raw body once,
  verifies the `ms-signature` HMAC, parses the payload, and for each notification whose
  `Action === insertAction` fetches the leave from IonBiz and calls `cobra.createLeave`.
- `src/webhooks/signature.ts` — **HMAC-SHA256 `ms-signature` verification** (constant-time
  compare, hashes the raw bytes). **Stays as-is.**
- `src/clients/ionbizAuth.ts` — **IonBiz OAuth2 client_credentials** token client with a
  60s-skew cache. **Stays as-is** (no `invalidate()`, but adequate for the IonBiz side).
- `src/clients/ionbizClient.ts` — `getLeaveById` against IonBiz OData `Leaves(id)`.
- `src/clients/cobraClient.ts` — **stub**: `createLeave` throws `not implemented yet`,
  config takes `{ baseUrl; apiKey }` (API key, **not** OAuth2).
- `src/mappers/leaveMapper.ts` — `ionBizToInternal` (no `email`/`companyId`/`days`),
  `internalToCobra` (a 1:1 shape, no mapping engine).
- `src/state/syncStateStore.ts` — thin Table Storage state: a single `leave` partition with
  `{ cobraRef, syncedAt }` keyed by `ionBizId`, plus a `meta/lastRun` row.
  `hasSynced` / `markSynced` only — **no delta detection, no salary state, no status**.
- `src/config.ts` — loads IonBiz OAuth, Cobra `{baseUrl, apiKey}`, storage, single
  `leaveInsertAction`. **No Cobra OAuth, no queue, no mapping, no insert/update/delete actions.**

This skeleton covers steps that v2.0 **keeps**, but is missing the entire Cobra OData write
chain, the salary chain, delta detection, the expanded state model, the dual-target writer,
the deferred-salary queue/worker, retry, exceptions, the CRON fallback, and Key Vault.

## Gap table

| Area | Current | v2.0 spec | Action |
|------|---------|-----------|--------|
| **Cobra auth** | `cobra: { baseUrl, apiKey }`; API key passed to client. No token flow. | Cobra is OData REST behind **OAuth2 client_credentials** (tokenUrl, clientId, clientSecret, scope). | Add `src/clients/cobraAuth.ts` → `createCobraAuth` returning `{ getToken, invalidate }` with cached token + skew; `invalidate()` to force-refresh on 401. Config gains `cobra.{tokenUrl,clientId,clientSecret,scope}`; drop `apiKey`. |
| **Cobra HTTP transport** | None (stub throws). | All Cobra calls are JSON OData over HTTPS with bearer token, GUID keys, list responses under OData envelope. | Add `src/clients/cobraHttp.ts` → `createCobraHttp({baseUrl}, auth, retry)` with `get/getList/post/patch/del`. Inject token, unwrap OData `value` arrays in `getList`, run every call through the retry runner, and treat 401 by `auth.invalidate()` + one retry. |
| **Person resolver (`/Email`)** | None. | Resolve the Cobra Person by employee **email** (OData filter / `/Email` lookup); may return 0..n. | `cobraClient.findPersonByEmail(email) → CobraPerson[]`. 0 results → exception "person not found"; >1 → exception "ambiguous person". |
| **PersonLeaveEntitlement resolve** | None. | Each person has leave entitlements; resolve the `personLeaveEntitlementId` for the target `leaveEntitlementId` before writing leave. | `cobraClient.resolvePersonLeaveEntitlement(personId, leaveEntitlementId) → PersonLeaveEntitlement \| null`. Null → exception "no entitlement". |
| **PersonLeave write (HRM)** | `createLeave` stub. | `POST` PersonLeave `{personLeaveEntitlementId, personId, from, to, use}` → returns GUID; updates via `PATCH`; removals via `DELETE` on GUID. | `createPersonLeave(input) → {guid}`, `updatePersonLeave(guid, patch)`, `deletePersonLeave(guid)`. Store returned GUID in state (`personLeaveGuid`). |
| **Company ProcessingState** | None. | A company that is **mid-payroll-run** must not receive salary writes; check Company ProcessingState first. | `cobraClient.getCompanyProcessingState(companyId) → number`. Writer treats a "locked/processing" state as a signal to **defer** salary writes to the queue. TODO(SD Worx): confirm which numeric ProcessingState values mean "locked" (OPEN POINT, PDF §11). |
| **Salary employment resolve** | None. | Salary writes target a `SalaryEmployment` valid on the leave date (start/end window). | `cobraSalaryClient.resolveSalaryEmployment(personId, onDate) → SalaryEmployment \| null`. Pick the employment whose `[startDate, endDate]` contains `onDate`; null → exception. |
| **CompanySalaryComponent catalog** | None. | Each salary code is defined per company with a `valueType` (Hours/Days/Amount) and an `isConstant` flag; writes must match the catalog definition. | `cobraSalaryClient.getCompanySalaryComponent(code) → CompanySalaryComponentDef \| null`. Use the catalog `valueType`/`isConstant` to build the write; unknown code → exception. |
| **SalaryComponent write** | None. | `POST` SalaryComponent `{salaryEmploymentId, code, period, value, valueType, isConstant}` → GUID. | `cobraSalaryClient.createSalaryComponent(input) → {guid}`. Append GUID to state `salaryComponentGuids`. |
| **Salary period (25th rule)** | None. | The salary period is `yyyy-mm`; **on/after the 25th** of a month, the leave rolls into the **next** month's period. | `src/utils/salaryPeriod.ts` → `salaryPeriod(isoDate)`: day ≥ 25 ⇒ next month (year rollover handled). |
| **IsConstant derivation** | None. | `isConstant` on the SalaryComponent comes from the company catalog definition for that code. | Writer reads `def.isConstant` from `getCompanySalaryComponent` and passes it through. TODO(SD Worx): confirm whether IonBiz can ever override catalog `isConstant` (OPEN POINT, PDF §11) — default to catalog value. |
| **Internal Leave model** | `Leave` = `{ionBizId, employeeId, startDate, endDate, leaveType, status, createdAt, updatedAt}`. | CONTRACT `Leave` adds `email`, `companyId`, `days` (use value), drops `employeeId` from the canonical key set. | Update `src/types/leave.ts` to the CONTRACT shape; add `LeaveAction = insert\|update\|delete`. |
| **Mapping engine** | `internalToCobra` 1:1; no lookup. | A mapping table maps an IonBiz leave type → `{target: hrm\|salary\|both, leaveEntitlementId, salaryCodes[]}`. | Add `src/types/mapping.ts`, `src/mappers/mappingTable.ts` (`loadMappingTable(entries).lookup`). Unknown type → exception "unmapped leave type". Mapping comes from config. |
| **leaveMapper** | maps without email/companyId/days. | `ionBizToInternal(raw: IonBizLeave) → Leave` per CONTRACT (carries email, companyId, days). | Rewrite `ionBizToInternal`; remove `internalToCobra` (replaced by writer + mapping). |
| **Delta detection** | `hasSynced` boolean only. | Re-deliveries/updates compared via a one-way **contentHash** fingerprint; no change ⇒ `noop`. | Add `src/utils/contentHash.ts` → `contentHash(leave)`. State stores the last hash; `decide()` compares. |
| **Sync decision** | Insert-only; dedupe by existence. | `decide(leave, action) → insert \| update \| delete \| noop` based on prior record + hash + action. | `SyncStateStore.decide`. insert+exists+same hash ⇒ noop; insert/update+changed ⇒ update/insert; delete ⇒ delete; etc. |
| **State store model** | partition `leave`, row `ionBizId`, `{cobraRef, syncedAt}`. | `PartitionKey = CompanyId`, `RowKey = leaveId`, fields: `personLeaveGuid?`, `salaryComponentGuids[]`, `personLeaveEntitlementId?`, `salaryEmploymentId?`, `status: done\|pending-salary`, `contentHash`, `attemptCount`, `lastTriedAt?`. | Replace store with CONTRACT `SyncStateStore` (`init/get/decide/upsert/remove`) over `LeaveSyncRecord`. Serialize `salaryComponentGuids[]` (Table Storage has no array column) as JSON. |
| **Dual-target writer + atomicity** | None. | One leave may write **both** HRM and salary. Partial failure must not leave silent inconsistency → compensation / clear status. | Add `src/services/leaveWriter.ts` → `createLeaveWriter(deps).write(leave, mapping, decision) → WriteOutcome`. On HRM-ok/salary-deferred ⇒ status `pending-salary`. On failure after HRM write ⇒ record GUIDs already written so a retry/compensation can clean up; never half-commit silently. TODO(SD Worx): confirm whether Cobra supports a transactional `$batch` for true atomicity (OPEN POINT, PDF §11); current best-effort is write-HRM-then-salary with state-tracked compensation. |
| **Deferred salary queue** | None. | When a company is mid-run (ProcessingState locked), salary writes are **queued** and retried later by a worker. | Add `src/queue/deferredQueue.ts` → `createDeferredQueue(cfg).enqueue(msg, delaySeconds?)` (Azure Storage Queue, `DeferredMessage`). Writer enqueues when ProcessingState blocks salary; sets state `pending-salary`. |
| **Deferred salary worker** | None. | A queue-triggered worker drains deferred salary writes once the company is processable. | (Assigned to Queue agent for the queue client; the worker function consumes `DeferredMessage`, re-checks ProcessingState, writes SalaryComponents, flips state to `done`. TODO(SD Worx): confirm re-queue delay/backoff policy, PDF §11.) |
| **Retry (backoff + jitter)** | None. | Transient failures (429, 5xx) retried with exponential backoff + jitter, ~10s budget. | Add `src/utils/retry.ts` → `TransientError`, `createRetry({budgetMs})`, `isTransientStatus` (429 + 5xx). Wired into `cobraHttp`. |
| **Exception list + alerts** | `context.error` per failure; counts only. | Failures collected as structured exception items (reason/detail) for an end-of-run alert/report. | Add `src/services/exceptions.ts` → `createExceptionSink(log)` with `record`/`items`. Writer + sync service push items; webhook/CRON emit a summary alert. |
| **CRON fallback** | `meta/lastRun` row exists but no timer function. | A scheduled `GetLeavesPerDay` CRON pulls leaves since the last run as a safety net for missed webhooks. | Add a timer-triggered function (IonBizClient gains a list/range fetch) that fetches leaves in `[lastRun − initialLookbackDays, now]`, runs them through the same decide→write pipeline, and advances `lastRun`. |
| **IonBiz client** | `getLeaveById` only. | CRON needs ranged/list fetch of leaves; webhook keeps by-id. | Extend `IonBizClient` with a list-by-date fetch; keep `getLeaveById`. Map OData PascalCase → `IonBizLeave` (now incl. `email`, `companyId`, `days`). TODO(SD Worx): confirm exact OData field names for email/company/use-value (OPEN POINT, PDF §11). |
| **Config** | partial (no Cobra OAuth/queue/mapping/actions). | CONTRACT `Config`: full ionBiz + cobra OAuth, storage, queue, webhook {secret, insert/update/delete actions}, mapping[], initialLookbackDays. `loadConfig` is now **async** (Key Vault). | Rewrite `src/config.ts` to CONTRACT shape; `loadConfig(): Promise<Config>`; resolve secrets through `SecretSource`. |
| **Key Vault + managed identity** | None; secrets via env only. | Secrets sourced from Azure Key Vault using managed identity in cloud; env fallback locally. | Add `src/secrets/keyVault.ts` → `createSecretSource({keyVaultUrl?})`. With a URL, use `DefaultAzureCredential` (managed identity); without, fall back to `process.env`. **No secrets in code.** |
| **Webhook actions** | single `leaveInsertAction`. | insert / update / delete actions all handled. | Webhook maps each notification `Action` → `LeaveAction`, runs decide→write for all three. |

## What already exists and stays

- **IonBiz OAuth2 client_credentials** (`src/clients/ionbizAuth.ts`) — kept; only consumed by
  the IonBiz client, unaffected by the new Cobra auth.
- **`ms-signature` HMAC verification** (`src/webhooks/signature.ts`) — kept verbatim; the
  raw-body-once pattern in the webhook handler is preserved.
- The **read-raw-body-then-verify-then-parse** ordering in `ionbizWebhook.ts` — preserved;
  the handler is only re-wired to the new pipeline (decide → leaveWriter → exceptions).

## Open points (PDF §11) carried as TODO(SD Worx)

1. Exact OData field names on the IonBiz Leaves entity for `email`, `companyId`, and the
   use-value (`days`).
2. Which numeric Company `ProcessingState` values mean "locked / mid-run" (defer salary).
3. Whether `isConstant` is ever overridden by IonBiz vs always taken from the company catalog.
4. Whether Cobra exposes a transactional `$batch` enabling true HRM+salary atomicity (else
   write-then-compensate via state).
5. Re-queue delay / backoff policy for the deferred salary worker.

Each of these is implemented with a typed signature and best-effort code, marked inline with
`TODO(SD Worx): ...`, and never silently no-ops.
