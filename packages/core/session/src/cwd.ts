/**
 * Session execution-directory resolution without changing persisted headers.
 * @module @deepseek-ai/dsh-session/cwd
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader } from './types.ts'

/** Resolves the trusted, current execution directory for an immutable Session header. */
export class SessionCwd extends Service {
  private provider: { resolve: (header: SessionHeader) => string | undefined } | undefined
  private everBound = false

  /** @param ctx - Context receiving the Session cwd service. */
  constructor(ctx: Context) {
    super(ctx, 'sessionCwd')
  }

  /**
   * Resolve the current directory; a registered provider's absence or error is authoritative.
   * After provider disposal, resolution fails until another provider registers.
   * @param header - Immutable Session header identifying the execution resource.
   * @returns The provider's directory, or the historical cwd before any provider registers.
   */
  resolve(header: SessionHeader): string | undefined {
    if (this.provider !== undefined) return this.provider.resolve(header)
    if (this.everBound) throw new Error('Session cwd provider is unavailable')
    return header.cwd
  }

  /**
   * Register the single authoritative resolver; its disposer cannot clear a later provider.
   * @param resolver - Directory lookup owned by the current persistence composition.
   * @returns An idempotent disposer that removes only this registration.
   */
  registerResolver(resolver: (header: SessionHeader) => string | undefined): () => void {
    if (this.provider !== undefined) throw new Error('Session cwd resolver is already registered')
    const provider = { resolve: resolver }
    this.provider = provider
    this.everBound = true
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.provider === provider) this.provider = undefined
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionCwd: SessionCwd
  }
}
export default SessionCwd
