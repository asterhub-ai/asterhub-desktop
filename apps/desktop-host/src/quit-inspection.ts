/** Quit-time inspection of interruptible work and armed native automation tasks for the Electron shell. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-asterhub-automation'
import { hasDesktopActiveTasks } from './update-tasks.ts'

/** What quitting the Host now would affect. */
export interface DesktopQuitInspection {
  /** Work the shared update-restart check also counts: running agents, queued messages, live jobs. */
  readonly activeTasks: boolean
  /** The native automation service has armed scheduled tasks across all accounts. */
  readonly scheduledTasks: boolean
}


/**
 * Register the quit inspector on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
 * @returns Inspector reporting active tasks together with armed native automation
 *   tasks. The native `asterhubAutomation` service exposes a global
 *   `inspectLifecycle()` that reports armed tasks across cold sessions, so the
 *   inspector does not enumerate loaded sessions. When the native service is
 *   absent (for example, before the automation Host plugin has loaded), the
 *   inspector reports no scheduled tasks and only counts active work.
 */
export function installDesktopQuitInspection(ctx: Context): () => Promise<DesktopQuitInspection> {
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  return async () => {
    if (stopped) throw new Error('desktop quit: Host is stopping')
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) throw new Error('desktop quit: task services are unavailable')
    const liveAgents = agents.list()
    const activeTasks = hasDesktopActiveTasks(liveAgents, jobs)
    let scheduledTasks = false
    const automation = ctx.get('asterhubAutomation')
    if (automation !== undefined && typeof automation.inspectLifecycle === 'function') {
      const lifecycle = await automation.inspectLifecycle()
      if (lifecycle.armed || lifecycle.active) scheduledTasks = true
    }
    if (!scheduledTasks) {
      for (const agent of liveAgents) {
        const activity = await ctx.waterfall('workspace/session-activity', { sessionId: agent.id }, () => Promise.resolve([]))
        if (activity.some(entry => (entry.kind as string) === 'schedule')) { scheduledTasks = true; break }
      }
    }
    return { activeTasks, scheduledTasks }
  }
}
