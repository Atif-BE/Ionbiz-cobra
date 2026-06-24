export type CobraAuth = {
  getToken: () => Promise<string>;
  invalidate: () => void;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export const createCobraAuth = (cfg: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}): CobraAuth => {
  let cached: { token: string; expiresAt: number } | null = null;

  // OAuth2 client_credentials with HTTP Basic client authentication.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  return {
    getToken: async () => {
      const now = Date.now();
      // Refresh ~60s before expiry to avoid using a token mid-flight that expires.
      if (cached && cached.expiresAt > now + 60_000) return cached.token;

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: cfg.scope,
      });

      const res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`Cobra auth failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as TokenResponse;
      cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
      return cached.token;
    },
    invalidate: () => {
      cached = null;
    },
  };
};
