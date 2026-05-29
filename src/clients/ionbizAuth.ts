export type IonBizAuthConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
};

export type IonBizAuth = {
  getToken: () => Promise<string>;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export const createIonBizAuth = (cfg: IonBizAuthConfig): IonBizAuth => {
  let cached: { token: string; expiresAt: number } | null = null;

  return {
    getToken: async () => {
      const now = Date.now();
      if (cached && cached.expiresAt > now + 60_000) return cached.token;

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: cfg.scope,
      });

      const res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        throw new Error(`IonBiz auth failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as TokenResponse;
      cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
      return cached.token;
    },
  };
};
