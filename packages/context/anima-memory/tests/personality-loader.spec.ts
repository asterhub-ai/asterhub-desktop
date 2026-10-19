import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as animaPlugin from '../src/index.ts'
import * as persistencePlugin from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function testAgent(ctx: Context, session: Session): Agent {
  return {
    id: session.id, options: {}, session, inbox: createInboxStub(), status: 'running', ctx,
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => { throw new Error('unexpected injection') },
    cancel() {}, runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
}

async function loadAnima(config: Record<string, unknown>): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'anima-personality-'))
  const ctx = context = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(persistencePlugin, { root: join(root, 'sessions') })
  await ctx.plugin(Loader)
  ctx.loader.builtins['include'] = Include
  ctx.loader.builtins['anima'] = animaPlugin
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: anima',
    '  name: cordis:anima',
    `  config: ${JSON.stringify(config)}`,
    '',
  ].join('\n'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function messageTexts(session: Session): string[] {
  return session.snapshotEvents()
    .filter(event => event.type === 'user/message' && String(event.data.source.kind) === 'anima')
    .flatMap(event => event.type === 'user/message'
      ? event.data.content.filter(block => block.type === 'text').map(block => block.text)
      : [])
}

describe('Anima personality Loader composition', () => {
  it('logs the configured personality on step one and reads live changes on the next turn', async () => {
    const ctx = await loadAnima({
      dataRoot: 'test-graph', automaticRecall: false,
      nickname: 'Mira', tone: 'warm', responseDetail: 'detailed', initiative: 'proactive',
      humor: 'playful', emotionalSupport: 'empathetic', familiarity: 'familiar', jokeStyle: 'casual',
    })
    const session = ctx.sessions.create(SessionId('personality-loader'))
    const agent = testAgent(ctx, session)

    async function prepare(turn: number, step: number, base: { kind: 'enter' | 'reject'; messages: ReturnType<typeof createUserMessage>[] }) {
      const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: base.messages, turn, step, signal: new AbortController().signal,
      }, () => Promise.resolve(base))
      if (decision.kind === 'enter') {
        for (const message of decision.messages) {
          if (!base.messages.includes(message)) session.append('user/message', message, { surfaceOp: 'append' })
        }
      }
      return decision
    }

    session.append('turn/start', { turn: 1 })
    const request = createUserMessage({ content: [{ type: 'text', text: 'Help me plan.' }], source: { kind: 'user' } })
    await prepare(1, 1, { kind: 'enter', messages: [request] })
    expect(messageTexts(session)).toEqual([expect.stringContaining('Preferred assistant nickname (literal name only): "Mira".')])
    expect(messageTexts(session)[0]).toContain('Use a warm, patient, encouraging tone.')
    expect(messageTexts(session)[0]).toContain('Use informal, casual jokes when appropriate; keep application safety rules unchanged.')

    const includeEntry = Object.values(ctx.loader.store).find(entry => entry.options.name === 'cordis:include')
    const animaEntry = includeEntry?.subgroup?.tree.store['anima']
    if (animaEntry === undefined) throw new Error('Anima Loader entry was not created')
    await animaEntry.update({ config: {
      dataRoot: 'test-graph', automaticRecall: false, nickname: 'Nova', tone: 'direct',
      responseDetail: 'concise', initiative: 'reserved', humor: 'none', emotionalSupport: 'practical',
      familiarity: 'formal', jokeStyle: 'restrained',
    } })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    const second = createUserMessage({ content: [{ type: 'text', text: 'Next request.' }], source: { kind: 'user' } })
    await prepare(2, 1, { kind: 'enter', messages: [second] })
    expect(messageTexts(session)[1]).toContain('Preferred assistant nickname (literal name only): "Nova".')
    expect(messageTexts(session)[1]).toContain('Use a direct, matter-of-fact tone.')

    const laterStep = await prepare(2, 2, { kind: 'enter', messages: [second] })
    expect(laterStep.kind).toBe('enter')
    expect(messageTexts(session)).toHaveLength(2)
    const rejected = await prepare(3, 1, { kind: 'reject', messages: [second] })
    expect(rejected.kind).toBe('reject')
    expect(messageTexts(session)).toHaveLength(2)
    expect(messageTexts(session)).toMatchSnapshot('logged personality preferences')
  })
})
