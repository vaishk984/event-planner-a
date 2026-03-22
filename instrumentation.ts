/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts (both Node.js and Edge runtimes)
 *
 * Optional local-only TLS relaxation for environments behind a corporate proxy.
 * Enable by setting ALLOW_INSECURE_TLS_DEV=true in local development.
 */
export async function register() {
  const isLocalDevelopment = process.env.NODE_ENV === 'development' && !process.env.VERCEL
  const allowInsecureTls = process.env.ALLOW_INSECURE_TLS_DEV === 'true'

  // Opt-in only: avoids insecure TLS settings leaking into hosted environments.
  if (isLocalDevelopment && allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
}
