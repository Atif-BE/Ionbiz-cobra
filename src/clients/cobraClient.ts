import { CobraCreateLeaveResult, CobraLeave } from '../types/cobra';

export type CobraClient = {
  createLeave: (leave: CobraLeave) => Promise<CobraCreateLeaveResult>;
};

export const createCobraClient = (_cfg: { baseUrl: string; apiKey: string }): CobraClient => ({
  createLeave: async (_leave) => {
    throw new Error('cobraClient.createLeave: not implemented yet');
  },
});
