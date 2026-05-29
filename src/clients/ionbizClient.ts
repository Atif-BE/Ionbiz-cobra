import { IonBizAuth } from './ionbizAuth';
import { IonBizLeave } from '../types/ionbiz';

export type IonBizClient = {
  listLeavesSince: (since: Date) => Promise<IonBizLeave[]>;
};

export const createIonBizClient = (cfg: { baseUrl: string }, auth: IonBizAuth): IonBizClient => ({
  listLeavesSince: async (_since) => {
    const token = await auth.getToken();
    // Replace this stub with the real IonBiz call. Expected shape:
    //
    //   const url = `${cfg.baseUrl}/leaves?updatedSince=${_since.toISOString()}`;
    //   const res = await fetch(url, {
    //     headers: { Authorization: `Bearer ${token}` },
    //   });
    //   if (!res.ok) throw new Error(`IonBiz listLeavesSince failed: ${res.status}`);
    //   return (await res.json()) as IonBizLeave[];
    void token;
    void cfg;
    return [];
  },
});
