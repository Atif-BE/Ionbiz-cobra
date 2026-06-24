# Agent Assignments — IonBiz ↔ Cobra v2.0 build

This file records the multi-agent build of the v2.0 refactor. One row per agent, listing the
files it owns, the v2.0 spec section it implements, and whether each file is fully implemented
or a stub carrying `TODO(SD Worx)` markers for OPEN POINTs (PDF §11).

All exported types/functions match the authoritative CONTRACTS verbatim so the modules compile
together. Shared types live in `src/types/*` and are imported, never re-declared.

| Agent | Files owned | Spec section | Status |
|-------|-------------|--------------|--------|
| **Analysis** | `docs/gap-analysis.md`, `docs/agent-assignments.md` | §1–§11 (whole doc) | implemented (documentation) |
| **Config + Secrets** | `src/config.ts`, `src/secrets/keyVault.ts` | §3 Config, §10 Key Vault / managed identity | implemented; `loadConfig` async via `SecretSource`. `keyVault` uses `DefaultAzureCredential` when `keyVaultUrl` set, env fallback otherwise |
| **CobraAuth** | `src/clients/cobraAuth.ts` | §4 Cobra OAuth2 client_credentials | implemented (`getToken` cached + skew, `invalidate`) |
| **Utils** | `src/utils/retry.ts`, `src/utils/salaryPeriod.ts`, `src/utils/contentHash.ts` | §8 retry backoff+jitter, §6 25th-day salary period, §7 delta/contentHash | implemented (`isTransientStatus` = 429/5xx; `salaryPeriod` rolls on/after the 25th) |
| **CobraHttp + Client-HRM** | `src/clients/cobraHttp.ts`, `src/clients/cobraClient.ts` | §5 OData write path: `/Email` resolver, PersonLeaveEntitlement, PersonLeave POST/PATCH/DELETE, Company ProcessingState | implemented; `getCompanyProcessingState` carries TODO(SD Worx) on which states mean "locked" |
| **CobraSalary** | `src/clients/cobraSalary.ts` | §6 salary chain: SalaryEmployment, CompanySalaryComponent catalog, SalaryComponent | implemented; `isConstant`/`valueType` from catalog, TODO(SD Worx) on override |
| **Mapping** | `src/types/mapping.ts`, `src/mappers/mappingTable.ts`, `src/mappers/leaveMapper.ts`, `src/types/leave.ts`, `src/types/ionbiz.ts` | §7 mapping engine + internal model | implemented; `lookup` returns null for unmapped types |
| **StateStore** | `src/state/syncStateStore.ts` | §7 expanded state (PK=CompanyId, RK=leaveId, personLeaveGuid, salaryComponentGuids, status, attemptCount/lastTriedAt, contentHash, decide) | implemented; `salaryComponentGuids[]` JSON-encoded in Table Storage |
| **LeaveWriter** | `src/services/leaveWriter.ts`, `src/services/exceptions.ts` | §7–§8 dual-target writer + compensation/atomicity; exception list | implemented; atomicity is write-HRM-then-salary with state-tracked compensation, TODO(SD Worx) on Cobra `$batch` |
| **Queue** | `src/queue/deferredQueue.ts` | §8 deferred salary queue + worker | implemented (`enqueue` with optional delay); worker re-queue/backoff policy TODO(SD Worx) |
| **Exceptions** | (shared with LeaveWriter) `src/services/exceptions.ts` | §8 exception list + alerts | implemented (`createExceptionSink` record/items) |
| **Webhook + SyncService** | `src/functions/ionbizWebhook.ts`, `src/services/webhookLeaveSync.ts`, `src/types/webhook.ts`, `src/webhooks/signature.ts` | §2 webhook trigger (insert/update/delete), HMAC signature (kept) | implemented; `signature.ts` + raw-body-once ordering kept verbatim; handler rewired to decide→write pipeline |
| **CRON + IonBizClient** | `src/functions/getLeavesPerDay.ts`, `src/clients/ionbizClient.ts`, `src/clients/ionbizAuth.ts` | §9 CRON GetLeavesPerDay fallback; IonBiz OAuth (kept) | implemented; `ionbizAuth.ts` kept; client gains ranged list fetch, TODO(SD Worx) on OData field names |

## Notes

- **Kept verbatim from the existing skeleton:** `src/clients/ionbizAuth.ts` (IonBiz OAuth2
  client_credentials) and `src/webhooks/signature.ts` (`ms-signature` HMAC). These are owned by
  the CRON+IonBizClient and Webhook+SyncService agents respectively, but their logic is
  preserved — only surrounding wiring changes.
- **Type ownership:** `src/types/cobra.ts` is consumed by CobraHttp/Client-HRM, CobraSalary,
  and LeaveWriter; it is updated to the CONTRACT shapes (Person, PersonLeaveEntitlement,
  PersonLeave I/O, SalaryEmployment, CompanySalaryComponentDef, SalaryComponent I/O,
  `CobraValueType`). The agent that first writes it owns it; others import.
- **Stub policy:** every stub throws a clear `Error` and never silently no-ops. OPEN POINTs are
  implemented with the correct typed signature plus reasonable best-effort code and an inline
  `TODO(SD Worx): ...` comment.
