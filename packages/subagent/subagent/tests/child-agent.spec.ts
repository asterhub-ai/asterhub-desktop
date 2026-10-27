import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionCwd from '@deepseek-ai/dsh-session/cwd'
import { childSessionMeta, resolveChildAgentOptions } from '../src/child-agent.ts'

const sessionCwds = new WeakMap<Agent, Context['sessionCwd']>()

function sessionCwdFor(parent: Agent): Context['sessionCwd'] {
  return sessionCwds.get(parent)!
}

async function parentAgent(cwd?: string): Promise<Agent> {
  const id = SessionId('parent')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1,
    ...cwd === undefined ? {} : { cwd },
    isSeeded: false,
  })
  const ctx = new Context()
  await ctx.plugin(SessionCwd)
  let agentCtx: Context | undefined
  await ctx.inject(['sessionCwd'], function captureSessionCwd(scoped: Context) {
    agentCtx = scoped
  })
  const parent = {
    id,
    options: {
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 512,
    },
    ctx: agentCtx!,
    session,
  } as Agent
  sessionCwds.set(parent, ctx.sessionCwd)
  return parent
}

describe('child Agent options', () => {
  it('inherits the parent effort while the exact route is unchanged', async () => {
    const parent = await parentAgent()
    expect(resolveChildAgentOptions(parent, undefined, 1, sessionCwdFor(parent))).toEqual({
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: 'high',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('clears an inherited effort when the child route changes', async () => {
    const parent = await parentAgent()
    expect(resolveChildAgentOptions(parent, { model: 'child-model' }, 1, sessionCwdFor(parent))).toEqual({
      provider: 'parent-provider',
      model: 'child-model',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('keeps an explicit child effort when the child route changes', async () => {
    const parent = await parentAgent()
    expect(resolveChildAgentOptions(parent, {
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: ReasoningEffortId('max'),
    }, 1, sessionCwdFor(parent))).toEqual({
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: 'max',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('inherits the latest logged request selection over creation-time values', async () => {
    const parent = await parentAgent()
    parent.session.append('request/header', {
      header: {
        config: {
          provider: 'current-provider',
          model: 'current-model',
          reasoningEffort: ReasoningEffortId('low'),
        },
      },
      reason: 'initial',
    })

    expect(resolveChildAgentOptions(parent, undefined, 1, sessionCwdFor(parent))).toEqual({
      provider: 'current-provider',
      model: 'current-model',
      reasoningEffort: 'low',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('uses SessionCwd for child runtime options and new child metadata after a project move', async () => {
    const parent = await parentAgent('/historical/project')
    const dispose = sessionCwdFor(parent).registerResolver(() => '/moved/project')
    try {
      expect(sessionCwdFor(parent).resolve(parent.session.header)).toBe('/moved/project')
      expect(resolveChildAgentOptions(parent, undefined, 1, sessionCwdFor(parent)).cwd).toBe('/moved/project')
      expect(childSessionMeta(parent, 1, false, sessionCwdFor(parent)).cwd).toBe('/moved/project')
      expect(parent.session.header.cwd).toBe('/historical/project')
    } finally {
      dispose()
    }
  })
})
