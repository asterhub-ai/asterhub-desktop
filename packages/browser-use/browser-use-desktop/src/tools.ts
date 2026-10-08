/** Desktop browser tools exposing Sidebar Browser automation to models. */
import type { Context } from '@deepseek-ai/cordis'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS,
} from './protocol.ts'
import type {
  DesktopBrowserAction,
  DesktopBrowserCaller,
  DesktopBrowserLocator,
  DesktopBrowserObservation,
  DesktopBrowserOwnerGeneration,
  DesktopBrowserPoint,
  DesktopBrowserPointerAction,
  DesktopBrowserReadProperty,
  DesktopBrowserSemanticAction,
  DesktopBrowserSnapshotId,
  DesktopBrowserRef,
  DesktopBrowserTabId,
  DesktopBrowserTabInfo,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
  DesktopBrowserTransport,
  DesktopBrowserWaitCondition,
} from './types.ts'

export interface DesktopBrowserToolConfig {
  readonly operationTimeoutMs: number
  readonly navigationTimeoutMs: number
  readonly snapshotMaxChars: number
  readonly readResultMaxChars: number
}

const TARGET_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: true as const,
  properties: {
    tabId: { type: 'string' as const, required: true as const, description: 'Target tab ID.' },
    generation: { type: 'number' as const, required: true as const, description: 'Target generation.' },
  },
}

const TAB_INFO_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    target: TARGET_SCHEMA,
    url: { type: 'string' as const, required: true as const },
    title: { type: 'string' as const, required: true as const },
    active: { type: 'boolean' as const, required: true as const },
    ownership: { type: 'string' as const, enum: ['user', 'agent'] as const, required: true as const },
    attached: { type: 'boolean' as const, required: true as const },
  },
}

const READ_VALUE_SCHEMA = {
  oneOf: [
    { type: 'string' as const },
    { type: 'boolean' as const },
    { type: 'null' as const },
  ] as const,
}

const IMAGE_ATTACHMENT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    attachmentId: { type: 'string' as const, required: true as const },
    mediaType: {
      type: 'string' as const,
      required: true as const,
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
    },
    bytes: { type: 'number' as const, required: true as const },
    width: { type: 'number' as const, required: true as const },
    height: { type: 'number' as const, required: true as const },
  },
}

function imageAttachmentRef(value: {
  readonly attachmentId: string
  readonly mediaType: ImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
}): ImageAttachmentRef {
  return {
    ...value,
    attachmentId: AttachmentId(value.attachmentId),
  }
}

/** Owns monotonic owner generations across live Agent instances. */
export class AgentOwnerTracker {
  private readonly generations = new WeakMap<Agent, DesktopBrowserOwnerGeneration>()
  private nextGen = 1

  getCaller(agent: Agent): DesktopBrowserCaller {
    let gen = this.generations.get(agent)
    if (gen === undefined) {
      gen = brandNumber<DesktopBrowserOwnerGeneration>(this.nextGen++)
      this.generations.set(agent, gen)
    }
    return {
      sessionId: agent.session.id,
      ownerGeneration: gen,
    }
  }

  releaseAgent(agent: Agent): void {
    this.generations.delete(agent)
  }
}

/** Serializes browser tool calls per live Session. */
export class SessionOperationQueue {
  private readonly queues = new Map<string, Promise<unknown>>()

  enqueue<T>(sessionId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve()
    const run = async (): Promise<T> => {
      return await op()
    }
    const next = prev.then(run, run)
    this.queues.set(sessionId, next)
    next
      .finally(() => {
        if (this.queues.get(sessionId) === next) {
          this.queues.delete(sessionId)
        }
      })
      .catch(() => {})
    return next as Promise<T>
  }
}

/** Ensure the routed model for the execution context declares image/vision capability. */
export async function assertImageCapableRoute(ctx: Context, exec: ToolRunContext): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('cannot capture screenshot: the current model route could not be resolved')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot capture screenshot: model "${model}" does not declare image input; switch to an image-capable model to view screenshots`)
  }
}

function parseTarget(target: { readonly tabId: string; readonly generation: number }): DesktopBrowserTarget {
  if (!target || typeof target.tabId !== 'string' || !Number.isInteger(target.generation) || target.generation < 1) {
    throw new Error('Target must specify valid tabId and positive generation')
  }
  return {
    tabId: brandString<DesktopBrowserTabId>(target.tabId),
    generation: brandNumber<DesktopBrowserTargetGeneration>(target.generation),
  }
}

function parseLocator(loc: {
  readonly kind: string
  readonly snapshotId: string
  readonly ref?: string | undefined
  readonly role?: string | undefined
  readonly name?: string | undefined
  readonly exact?: boolean | undefined
}): DesktopBrowserLocator {
  if (!loc || typeof loc.snapshotId !== 'string' || loc.snapshotId.trim().length === 0) {
    throw new Error('Locator must specify a non-empty snapshotId')
  }
  const snapshotId = brandString<DesktopBrowserSnapshotId>(loc.snapshotId)
  if (loc.kind === 'ref') {
    if (!loc.ref || typeof loc.ref !== 'string' || loc.ref.trim().length === 0) {
      throw new Error('Ref locator requires non-empty ref')
    }
    return { kind: 'ref', snapshotId, ref: brandString<DesktopBrowserRef>(loc.ref) }
  }
  if (loc.kind === 'role') {
    if (!loc.role || typeof loc.role !== 'string' || !loc.name || typeof loc.name !== 'string') {
      throw new Error('Role locator requires role and name')
    }
    return { kind: 'role', snapshotId, role: loc.role, name: loc.name, exact: true }
  }
  throw new Error(`Invalid locator kind: ${String(loc.kind)}`)
}

function parseWaitCondition(cond: {
  readonly kind: string
  readonly url?: string | undefined
  readonly locator?: {
    readonly kind: string
    readonly snapshotId: string
    readonly ref?: string | undefined
    readonly role?: string | undefined
    readonly name?: string | undefined
    readonly exact?: boolean | undefined
  } | undefined
  readonly state?: string | undefined
}): DesktopBrowserWaitCondition {
  if (!cond || typeof cond.kind !== 'string') throw new Error('Wait condition requires a kind')
  if (cond.kind === 'load') {
    return { kind: 'load', state: 'domcontentloaded' }
  }
  if (cond.kind === 'url') {
    if (!cond.url || typeof cond.url !== 'string') throw new Error('Wait condition url requires string url')
    return { kind: 'url', url: cond.url }
  }
  if (cond.kind === 'element') {
    if (!cond.locator) throw new Error('Wait condition element requires locator')
    const locator = parseLocator(cond.locator)
    const validStates = ['visible', 'hidden', 'enabled', 'checked']
    if (!cond.state || !validStates.includes(cond.state)) {
      throw new Error(`Wait condition element state must be one of: ${validStates.join(', ')}`)
    }
    return { kind: 'element', locator, state: cond.state as 'visible' | 'hidden' | 'enabled' | 'checked' }
  }
  throw new Error(`Unknown wait condition kind: ${cond.kind}`)
}

/** Construct the eight standard model tools for Sidebar Browser automation. */
export function createDesktopBrowserTools(
  ctx: Context,
  transport: DesktopBrowserTransport,
  config: DesktopBrowserToolConfig,
  tracker: AgentOwnerTracker,
  queue: SessionOperationQueue,
): ToolDefinition[] {
  const requireAgent = (exec: ToolRunContext): Agent => {
    if (!exec.agent) {
      throw new Error('Desktop browser tools require an active Agent session')
    }
    return exec.agent
  }

  // 1. browser_tabs
  const browserTabs = defineTool({
    name: 'browser_tabs',
    description: 'List open tabs in the Sidebar Browser for the current Session.',
    parameters: {},
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          backend: { type: 'string' as const, required: true as const },
          tabs: {
            type: 'array' as const,
            required: true as const,
            items: TAB_INFO_SCHEMA,
          },
          truncated: { type: 'boolean' as const, required: true as const },
        },
      },
      render: (_args, value) => {
        const lines = [`Sidebar Browser tabs (${value.tabs.length}):`]
        for (const t of value.tabs) {
          const activeFlag = t.active ? ' [active]' : ''
          lines.push(`- Tab ${t.target.tabId} (gen ${t.target.generation}): "${t.title}" <${t.url}>${activeFlag}`)
        }
        if (value.truncated) lines.push('  [tabs truncated]')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(caller, { kind: 'tabs.list' }, exec.signal)
        if (result.status === 'error') {
          throw new Error(`browser_tabs failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'tabs') {
          throw new Error('browser_tabs: unexpected result kind')
        }
        return {
          backend: 'desktop-internal',
          tabs: [...result.value.tabs],
          truncated: result.value.truncated,
        }
      })
    },
  })

  // 2. browser_open
  const browserOpen = defineTool({
    name: 'browser_open',
    description: 'Navigate the Sidebar Browser to a URL, optionally in a new tab.',
    parameters: {
      url: { type: 'string' as const, required: true as const, description: 'Target HTTP(S) URL.' },
      newTab: { type: 'boolean' as const, description: 'Whether to open in a new tab; defaults to reusing the active tab.' },
    },
    output: {
      schema: TAB_INFO_SCHEMA,
      render: (_args, tab) => [
        { type: 'text', text: `Opened tab ${tab.target.tabId} (gen ${tab.target.generation}): "${tab.title}" <${tab.url}>` },
      ],
    },
    async execute(args, exec): Promise<DesktopBrowserTabInfo> {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(
          caller,
          {
            kind: 'tabs.open',
            url: args.url,
            ...args.newTab !== undefined ? { newTab: args.newTab } : {},
          },
          exec.signal,
        )
        if (result.status === 'error') {
          throw new Error(`browser_open failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'tab') {
          throw new Error('browser_open: unexpected result kind')
        }
        return result.value.tab
      })
    },
  })

  // 3. browser_close
  const browserClose = defineTool({
    name: 'browser_close',
    description: 'Close an open tab in the Sidebar Browser.',
    parameters: {
      target: TARGET_SCHEMA,
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          closed: { type: 'boolean' as const, required: true as const },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Closed tab ${value.target.tabId} (gen ${value.target.generation})` },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(caller, { kind: 'tabs.close', target }, exec.signal)
        if (result.status === 'error') {
          throw new Error(`browser_close failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'closed') {
          throw new Error('browser_close: unexpected result kind')
        }
        return { target: result.value.target, closed: true }
      })
    },
  })

  // 4. browser_snapshot
  const browserSnapshot = defineTool({
    name: 'browser_snapshot',
    description: 'Capture the accessible DOM snapshot and assigned element refs for a tab.',
    parameters: {
      target: TARGET_SCHEMA,
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          snapshotId: { type: 'string' as const, required: true as const },
          text: { type: 'string' as const, required: true as const },
          truncated: { type: 'boolean' as const, required: true as const },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Snapshot ${value.snapshotId} for tab ${value.target.tabId} (gen ${value.target.generation})${value.truncated ? ' [truncated]' : ''}:\n${value.text}`,
        },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(caller, { kind: 'page.snapshot', target }, exec.signal)
        if (result.status === 'error') {
          throw new Error(`browser_snapshot failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'snapshot') {
          throw new Error('browser_snapshot: unexpected result kind')
        }
        const snapshot = result.value.snapshot
        let text = snapshot.text
        let truncated = snapshot.truncated
        if (text.length > config.snapshotMaxChars) {
          text = text.slice(0, config.snapshotMaxChars)
          truncated = true
        }
        return {
          target: snapshot.target,
          snapshotId: snapshot.snapshotId,
          text,
          truncated,
        }
      })
    },
  })

  // 5. browser_read
  const browserRead = defineTool({
    name: 'browser_read',
    description: 'Read an element property (text, attribute, visible, enabled, checked) by locator.',
    parameters: {
      target: TARGET_SCHEMA,
      locator: {
        type: 'object' as const,
        required: true as const,
        additionalProperties: false as const,
        description: 'Semantic locator (ref or role).',
        properties: {
          kind: { type: 'string' as const, required: true as const, enum: ['ref', 'role'] as const },
          snapshotId: { type: 'string' as const, required: true as const },
          ref: { type: 'string' as const },
          role: { type: 'string' as const },
          name: { type: 'string' as const },
          exact: { type: 'boolean' as const },
        },
      },
      property: {
        type: 'string' as const,
        required: true as const,
        enum: ['text', 'attribute', 'visible', 'enabled', 'checked'] as const,
        description: 'Property to read.',
      },
      attribute: { type: 'string' as const, description: 'Attribute name when property is "attribute".' },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          value: READ_VALUE_SCHEMA,
          truncated: { type: 'boolean' as const, required: true as const },
        },
      },
      render: (args, value) => [
        {
          type: 'text',
          text: `Read "${String(args.property)}"${typeof args.attribute === 'string' ? ` ("${args.attribute}")` : ''}: ${String(value.value)}${value.truncated ? ' [truncated]' : ''}`,
        },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })
      const locator = parseLocator(args.locator as never)
      const property = args.property as DesktopBrowserReadProperty
      const attribute = typeof args.attribute === 'string' && args.attribute.trim().length > 0
        ? args.attribute.trim()
        : undefined
      if (property === 'attribute' && attribute === undefined) {
        throw new Error('Attribute property read requires non-empty attribute name')
      }
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(
          caller,
          {
            kind: 'page.read',
            target,
            locator,
            property,
            maxChars: Math.min(config.readResultMaxChars, MAX_DESKTOP_BROWSER_TEXT_RESULT_CHARS),
            ...attribute !== undefined ? { attribute } : {},
          },
          exec.signal,
        )
        if (result.status === 'error') {
          throw new Error(`browser_read failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'read') {
          throw new Error('browser_read: unexpected result kind')
        }
        return {
          target: result.value.target,
          value: result.value.value,
          truncated: result.value.truncated,
        }
      })
    },
  })

  // 6. browser_act
  const browserAct = defineTool({
    name: 'browser_act',
    description: 'Perform a semantic action or coordinate pointer action on the page, with optional observation.',
    parameters: {
      target: TARGET_SCHEMA,
      action: {
        type: 'string' as const,
        required: true as const,
        enum: ['click', 'doubleClick', 'fill', 'type', 'press', 'check', 'uncheck', 'select', 'hover', 'move', 'scroll', 'drag'] as const,
        description: 'Semantic action or pointer action.',
      },
      locator: {
        type: 'object' as const,
        additionalProperties: false as const,
        description: 'Semantic locator for semantic actions.',
        properties: {
          kind: { type: 'string' as const, enum: ['ref', 'role'] as const },
          snapshotId: { type: 'string' as const },
          ref: { type: 'string' as const },
          role: { type: 'string' as const },
          name: { type: 'string' as const },
          exact: { type: 'boolean' as const },
        },
      },
      text: { type: 'string' as const, description: 'Text for fill or type.' },
      keys: { type: 'array' as const, items: { type: 'string' as const }, description: 'Keys for press.' },
      values: { type: 'array' as const, items: { type: 'string' as const }, description: 'Values for select.' },
      screenshotId: { type: 'string' as const, description: 'Screenshot ID for coordinate pointer actions.' },
      x: { type: 'number' as const, description: 'CSS pixel X coordinate for pointer actions.' },
      y: { type: 'number' as const, description: 'CSS pixel Y coordinate for pointer actions.' },
      deltaX: { type: 'number' as const, description: 'Horizontal scroll delta in CSS pixels.' },
      deltaY: { type: 'number' as const, description: 'Vertical scroll delta in CSS pixels.' },
      path: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          additionalProperties: false as const,
          properties: {
            x: { type: 'number' as const, required: true as const },
            y: { type: 'number' as const, required: true as const },
          },
        },
        description: 'Ordered path of points [{ x, y }] for drag.',
      },
      observe: {
        type: 'object' as const,
        additionalProperties: false as const,
        description: 'Optional post-action observation (wait and/or screenshot).',
        properties: {
          wait: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              kind: { type: 'string' as const, required: true as const, enum: ['load', 'url', 'element'] as const },
              url: { type: 'string' as const },
              state: { type: 'string' as const, enum: ['visible', 'hidden', 'enabled', 'checked'] as const },
            },
          },
          screenshot: { type: 'boolean' as const },
        },
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          delivered: { type: 'boolean' as const, required: true as const },
          observation: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              target: TARGET_SCHEMA,
              snapshotId: { type: 'string' as const, required: true as const },
              text: { type: 'string' as const, required: true as const },
              truncated: { type: 'boolean' as const, required: true as const },
            },
          },
          screenshot: IMAGE_ATTACHMENT_SCHEMA,
        },
      },
      render: (args, value) => {
        const blocks: ContentBlock[] = [
          { type: 'text', text: `Action "${String(args.action)}" delivered successfully to tab ${value.target.tabId}.` },
        ]
        if (value.observation) {
          blocks.push({
            type: 'text',
            text: `Observation snapshot ${value.observation.snapshotId}:\n${value.observation.text}`,
          })
        }
        if (value.screenshot) {
          blocks.push({ type: 'image', attachment: imageAttachmentRef(value.screenshot) })
        }
        return blocks
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })
      const action = args.action as DesktopBrowserAction

      let observe: DesktopBrowserObservation | undefined
      if (args.observe) {
        const obs = args.observe as { wait?: unknown; screenshot?: boolean }
        observe = {
          ...obs.wait ? { wait: parseWaitCondition(obs.wait as never) } : {},
          ...obs.screenshot ? { screenshot: true } : {},
        }
        if (observe.screenshot) {
          await assertImageCapableRoute(ctx, exec)
        }
      }

      const isPointerCoordinate = args.screenshotId !== undefined
        || args.x !== undefined || args.y !== undefined
        || ['move', 'scroll', 'drag'].includes(action)

      return await queue.enqueue(agent.session.id, async () => {
        if (isPointerCoordinate) {
          if (!args.screenshotId || typeof args.screenshotId !== 'string') {
            throw new Error(`Coordinate pointer action "${action}" requires screenshotId`)
          }
          const screenshotId = brandString<DesktopBrowserSnapshotId>(args.screenshotId)
          const x = typeof args.x === 'number' ? args.x : undefined
          const y = typeof args.y === 'number' ? args.y : undefined
          const deltaX = typeof args.deltaX === 'number' ? args.deltaX : undefined
          const deltaY = typeof args.deltaY === 'number' ? args.deltaY : undefined

          if (action === 'click' || action === 'doubleClick' || action === 'move') {
            if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
              throw new Error(`Pointer action "${action}" requires valid non-negative x and y coordinates`)
            }
          } else if (action === 'scroll') {
            if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
              throw new Error('Pointer scroll requires valid x and y coordinates')
            }
            if (deltaX === undefined && deltaY === undefined) {
              throw new Error('Pointer scroll requires deltaX or deltaY')
            }
          } else if (action === 'drag') {
            if (!args.path || !Array.isArray(args.path) || args.path.length < 2) {
              throw new Error('Pointer drag requires path with at least 2 points')
            }
            for (const pt of args.path as DesktopBrowserPoint[]) {
              if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.x < 0 || pt.y < 0) {
                throw new Error(`Invalid drag point: (${pt.x}, ${pt.y})`)
              }
            }
          }

          const parsedPath = Array.isArray(args.path) ? (args.path as DesktopBrowserPoint[]) : undefined

          const result = await transport.request(
            caller,
            {
              kind: 'page.actAt',
              target,
              screenshotId,
              action: action as DesktopBrowserPointerAction,
              ...x !== undefined ? { x } : {},
              ...y !== undefined ? { y } : {},
              ...deltaX !== undefined ? { deltaX } : {},
              ...deltaY !== undefined ? { deltaY } : {},
              ...parsedPath !== undefined ? { path: parsedPath } : {},
              ...observe !== undefined ? { observe } : {},
            },
            exec.signal,
          )

          if (result.status === 'error') {
            throw new Error(`browser_act failed: [${result.code}] ${result.message}`)
          }
          if (result.value.kind !== 'action') {
            throw new Error('browser_act: unexpected result kind')
          }

          let savedScreenshot: ImageAttachmentRef | undefined
          if (result.value.screenshot) {
            savedScreenshot = await ctx.attachments.saveImage({
              data: result.value.screenshot.bytes,
              mediaType: 'image/png',
            })
          }

          return {
            target: result.value.target,
            delivered: result.value.delivered,
            ...result.value.observation !== undefined ? { observation: result.value.observation } : {},
            ...savedScreenshot !== undefined ? { screenshot: savedScreenshot } : {},
          }
        }

        // Semantic action
        if (!args.locator) {
          throw new Error(`Semantic action "${action}" requires locator`)
        }
        const locator = parseLocator(args.locator as never)
        const text = typeof args.text === 'string' ? args.text : undefined
        const keys = Array.isArray(args.keys) ? (args.keys as string[]) : undefined
        const values = Array.isArray(args.values) ? (args.values as string[]) : undefined

        if ((action === 'fill' || action === 'type') && text === undefined) {
          throw new Error(`Action "${action}" requires text parameter`)
        }
        if (action === 'press' && (keys === undefined || keys.length === 0)) {
          throw new Error('Action "press" requires keys parameter with at least one key')
        }
        if (action === 'select' && (values === undefined || values.length === 0)) {
          throw new Error('Action "select" requires values parameter with at least one value')
        }

        const result = await transport.request(
          caller,
          {
            kind: 'page.act',
            target,
            locator,
            action: action as DesktopBrowserSemanticAction,
            ...text !== undefined ? { text } : {},
            ...keys !== undefined ? { keys } : {},
            ...values !== undefined ? { values } : {},
            ...observe !== undefined ? { observe } : {},
          },
          exec.signal,
        )

        if (result.status === 'error') {
          throw new Error(`browser_act failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'action') {
          throw new Error('browser_act: unexpected result kind')
        }

        let savedScreenshot: ImageAttachmentRef | undefined
        if (result.value.screenshot) {
          savedScreenshot = await ctx.attachments.saveImage({
            data: result.value.screenshot.bytes,
            mediaType: 'image/png',
          })
        }

        return {
          target: result.value.target,
          delivered: result.value.delivered,
          ...result.value.observation !== undefined ? { observation: result.value.observation } : {},
          ...savedScreenshot !== undefined ? { screenshot: savedScreenshot } : {},
        }
      })
    },
  })

  // 7. browser_wait
  const browserWait = defineTool({
    name: 'browser_wait',
    description: 'Wait for a page load state, URL match, or element condition on the target tab.',
    parameters: {
      target: TARGET_SCHEMA,
      condition: {
        type: 'object' as const,
        required: true as const,
        additionalProperties: false as const,
        description: 'Wait condition (load, url, or element).',
        properties: {
          kind: { type: 'string' as const, required: true as const, enum: ['load', 'url', 'element'] as const },
          url: { type: 'string' as const },
          locator: {
            type: 'object' as const,
            additionalProperties: false as const,
            properties: {
              kind: { type: 'string' as const, required: true as const, enum: ['ref', 'role'] as const },
              snapshotId: { type: 'string' as const, required: true as const },
              ref: { type: 'string' as const },
              role: { type: 'string' as const },
              name: { type: 'string' as const },
              exact: { type: 'boolean' as const },
            },
          },
          state: { type: 'string' as const, enum: ['visible', 'hidden', 'enabled', 'checked'] as const },
        },
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          matched: { type: 'boolean' as const, required: true as const },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Condition satisfied on tab ${value.target.tabId} (gen ${value.target.generation}).` },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })
      const condition = parseWaitCondition(args.condition as never)
      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(caller, { kind: 'page.wait', target, condition }, exec.signal)
        if (result.status === 'error') {
          throw new Error(`browser_wait failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'wait') {
          throw new Error('browser_wait: unexpected result kind')
        }
        return { target: result.value.target, matched: true }
      })
    },
  })

  // 8. browser_screenshot
  const browserScreenshot = defineTool({
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the target tab and save it as a durable image attachment.',
    parameters: {
      target: TARGET_SCHEMA,
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false as const,
        properties: {
          target: TARGET_SCHEMA,
          screenshotId: { type: 'string' as const, required: true as const },
          image: { ...IMAGE_ATTACHMENT_SCHEMA, required: true as const },
          viewport: {
            type: 'object' as const,
            additionalProperties: false as const,
            required: true as const,
            properties: {
              width: { type: 'number' as const, required: true as const },
              height: { type: 'number' as const, required: true as const },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Captured screenshot ${value.screenshotId} (${value.viewport.width}x${value.viewport.height}) for tab ${value.target.tabId}`,
        },
        { type: 'image', attachment: imageAttachmentRef(value.image) },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const caller = tracker.getCaller(agent)
      const target = parseTarget(args.target as { tabId: string; generation: number })

      // Verify model vision capability before capturing
      await assertImageCapableRoute(ctx, exec)

      return await queue.enqueue(agent.session.id, async () => {
        const result = await transport.request(caller, { kind: 'page.screenshot', target }, exec.signal)
        if (result.status === 'error') {
          throw new Error(`browser_screenshot failed: [${result.code}] ${result.message}`)
        }
        if (result.value.kind !== 'screenshot') {
          throw new Error('browser_screenshot: unexpected result kind')
        }
        const screenshot = result.value.screenshot
        const image = await ctx.attachments.saveImage({
          data: screenshot.bytes,
          mediaType: 'image/png',
        })
        return {
          target: screenshot.target,
          screenshotId: screenshot.screenshotId,
          image,
          viewport: screenshot.viewport,
        }
      })
    },
  })

  return [
    browserTabs,
    browserOpen,
    browserClose,
    browserSnapshot,
    browserRead,
    browserAct,
    browserWait,
    browserScreenshot,
  ]
}
