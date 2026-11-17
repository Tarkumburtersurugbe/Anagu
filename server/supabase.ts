export interface SupabaseConfigStatus {
  configured: boolean;
  supabaseUrl: string | null;
  jwksUrl: string | null;
  projectRef: string | null;
  publishableKeyValid: boolean;
  secretKeyValid: boolean;
  jwksReachable: boolean;
  jwksKeyCount: number;
  error?: string;
}

export async function getSupabaseStatus(): Promise<SupabaseConfigStatus> {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim() || null;
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
  const jwksUrl =
    (process.env.SUPABASE_JWKS_URL || '').trim() ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : null);

  const publishableKeyValid =
    publishableKey.startsWith('sb_publishable_') || publishableKey.startsWith('eyJ');
  const secretKeyValid =
    secretKey.startsWith('sb_secret_') || secretKey.startsWith('eyJ');

  let projectRef: string | null = null;
  if (supabaseUrl) {
    try {
      const hostname = new URL(supabaseUrl).hostname;
      projectRef = hostname.split('.')[0] || null;
    } catch {
      projectRef = null;
    }
  }

  let jwksReachable = false;
  let jwksKeyCount = 0;
  let error: string | undefined;

  if (jwksUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(jwksUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as { keys?: unknown[] };
        jwksReachable = true;
        jwksKeyCount = Array.isArray(data.keys) ? data.keys.length : 0;
      } else {
        error = `JWKS endpoint returned HTTP ${res.status}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to reach Supabase JWKS endpoint';
    }
  }

  return {
    configured: Boolean(supabaseUrl && publishableKeyValid && secretKeyValid && jwksUrl),
    supabaseUrl,
    jwksUrl,
    projectRef,
    publishableKeyValid,
    secretKeyValid,
    jwksReachable,
    jwksKeyCount,
    error,
  };
}
