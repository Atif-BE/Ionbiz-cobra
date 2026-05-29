import { IonBizLeave } from '../types/ionbiz';

export type IonBizClient = {
  listLeavesSince: (since: Date) => Promise<IonBizLeave[]>;
};

export const createIonBizClient = (_cfg: { baseUrl: string; apiKey: string }): IonBizClient => ({
  listLeavesSince: async (_since) => {
    // Replace this stub with the real IonBiz call. Expected shape:
    //
    //   const url = `${_cfg.baseUrl}/leaves?updatedSince=${_since.toISOString()}`;
    //   const res = await fetch(url, {
    //     headers: { Authorization: `Bearer ${_cfg.apiKey}` },
    //   });
    //   if (!res.ok) throw new Error(`IonBiz listLeavesSince failed: ${res.status}`);
    //   return (await res.json()) as IonBizLeave[];
    return [];
  },
});
