/**
 * OAuth sign-in with GitHub and Google (authorization-code flow). Each provider is enabled only when its
 * client id and secret are configured in the environment.
 */
export interface OAuthProvider {
  id: "github" | "google";
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  profile(
    accessToken: string,
    fetchImpl: typeof fetch,
  ): Promise<{ id: string; email: string; name: string } | null>;
}

export function oauthProviders(env: NodeJS.ProcessEnv): OAuthProvider[] {
  const out: OAuthProvider[] = [];
  if (env.VELLUM_OAUTH_GITHUB_ID && env.VELLUM_OAUTH_GITHUB_SECRET) {
    out.push({
      id: "github",
      label: "GitHub",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      clientId: env.VELLUM_OAUTH_GITHUB_ID,
      clientSecret: env.VELLUM_OAUTH_GITHUB_SECRET,
      async profile(token, f) {
        const headers = {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "Vellum",
        };
        const user = (await (await f("https://api.github.com/user", { headers })).json()) as {
          id: number;
          name?: string;
          login: string;
        };
        // The profile's public email isn't necessarily verified; accounts are linked by email, so only a
        // verified primary address will do.
        const emails = (await (await f("https://api.github.com/user/emails", { headers })).json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const email = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified)?.email : undefined;
        return email ? { id: String(user.id), email, name: user.name || user.login } : null;
      },
    });
  }
  if (env.VELLUM_OAUTH_GOOGLE_ID && env.VELLUM_OAUTH_GOOGLE_SECRET) {
    out.push({
      id: "google",
      label: "Google",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      clientId: env.VELLUM_OAUTH_GOOGLE_ID,
      clientSecret: env.VELLUM_OAUTH_GOOGLE_SECRET,
      async profile(token, f) {
        const p = (await (
          await f("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json()) as {
          sub: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
        };
        return p.email && p.email_verified
          ? { id: p.sub, email: p.email, name: p.name || p.email.split("@")[0]! }
          : null;
      },
    });
  }
  return out;
}

export async function exchangeCode(
  p: OAuthProvider,
  code: string,
  redirectUri: string,
  f: typeof fetch,
): Promise<string | null> {
  const res = await f(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}
