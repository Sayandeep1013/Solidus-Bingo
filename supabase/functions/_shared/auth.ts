/**
 * supabase/functions/_shared/auth.ts
 *
 * Shared auth helper for all Edge Functions.
 * Verifies the caller's JWT and returns the authenticated user ID.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AuthResult {
  userId: string
  error: null
}
export interface AuthError {
  userId: null
  error: Response
}

/** Returns {userId} on success or {error: Response} on failure */
export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return {
      userId: null,
      error: new Response(
        JSON.stringify({ ok: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'Missing Authorization header' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return {
      userId: null,
      error: new Response(
        JSON.stringify({ ok: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    }
  }

  return { userId: user.id, error: null }
}

/** Standard CORS headers for all Edge Functions */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

/** Handle preflight OPTIONS requests */
export function handleCors(): Response {
  return new Response(null, { headers: CORS_HEADERS })
}

/** OK response wrapper */
export function ok(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data, error: null }),
    { status, headers: CORS_HEADERS }
  )
}

/** Error response wrapper */
export function err(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, data: null, error: { code, message } }),
    { status, headers: CORS_HEADERS }
  )
}
