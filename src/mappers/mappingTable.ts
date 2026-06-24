import type { MappingEntry } from '../types/mapping';

export type MappingTable = { lookup: (ionBizLeaveType: string) => MappingEntry | null };

export const loadMappingTable = (entries: MappingEntry[]): MappingTable => {
  const byType = new Map<string, MappingEntry>();
  for (const entry of entries) byType.set(entry.ionBizLeaveType, entry);
  return {
    lookup: (ionBizLeaveType: string) => byType.get(ionBizLeaveType) ?? null,
  };
};
