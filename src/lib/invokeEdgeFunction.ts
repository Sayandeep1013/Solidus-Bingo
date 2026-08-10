/**
 * src/lib/invokeEdgeFunction.ts
 *
 * Thin wrapper around supabase.functions.invoke() that guarantees the
 * returned promise settles within `timeoutMs`, even if the underlying fetch
 * never does (cold start, dropped connection, silent hang).
 *
 * supabase-js 2.39.7's FunctionsClient.invoke() does not forward an
 * AbortSignal to its internal fetch call, so this can't cancel the in-flight
 * request — it only bounds how long a caller can be left waiting on it.
 * Every Edge Function call in the app should go through this rather than
 * calling supabase.functions.invoke() directly, so no screen's loading
 * state can get stuck forever on a stalled network call.
 *
 * It also normalizes error responses. Every Edge Function in this app
 * returns its `{ ok: false, error: { code, message } }` body on a non-2xx
 * HTTP status (409, 403, ...), but supabase-js's invoke() only populates
 * `data` on a 2xx response — on any error status it leaves `data: null` and
 * puts a generic "Edge Function returned a non-2xx status code" message on
 * `error`, with the actual response body only reachable via
 * `error.context.json()`. Screens that pattern-match on `data?.error?.code`
 * (the natural thing to write, and what the 2xx `{ok:false}` shape needs
 * too) silently got that generic message instead of the real one on every
 * non-2xx error — found via a live join-queue ALREADY_IN_GAME test. Parsing
 * the body here and merging it into `data` fixes every call site at once.
 */
import { supabase } from './supabaseClient'

const DEFAULT_TIMEOUT_MS = 15_000

// `error` is intentionally `any`, matching supabase-js's own FunctionsResponse
// type — callers pattern-match on `.name`, `.context`, `.message` etc. exactly
// as they would on the raw supabase.functions.invoke() result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: { body?: Record<string, any> | string; timeoutMs?: number } = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: T | null; error: any }> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  let timer: ReturnType<typeof setTimeout>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timeout = new Promise<{ data: null; error: any }>((resolve) => {
    timer = setTimeout(
      () => resolve({ data: null, error: new Error(`${functionName} timed out after ${timeoutMs}ms`) }),
      timeoutMs
    )
  })

  let result: { data: T | null; error: any } // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    result = await Promise.race([
      supabase.functions.invoke<T>(functionName, { body }),
      timeout,
    ])
  } finally {
    clearTimeout(timer!)
  }

  if (result.error && result.data == null && typeof result.error?.context?.json === 'function') {
    try {
      result = { data: await result.error.context.json(), error: result.error }
    } catch {
      // Non-JSON error body (e.g. a network-level failure) — leave as-is,
      // callers fall back to error.message.
    }
  }

  return result
}
