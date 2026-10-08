import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  AgentOwnerTracker,
  SessionOperationQueue,
  createDesktopBrowserTools,
  type DesktopBrowserToolConfig,
} from '../src/tools.ts'
import type {
  DesktopBrowserCaller,
  DesktopBrowserOperation,
  DesktopBrowserSnapshotId,
  DesktopBrowserTabId,
  DesktopBrowserTarget,
  DesktopBrowserTargetGeneration,
  DesktopBrowserTransport,
} from '../src/types.ts'

const DEFAULT_CONFIG: DesktopBrowserToolConfig = {
  operationTimeoutMs: 3_000,
  navigationTimeoutMs: 30_000,
  snapshotMaxChars: 50,
  readResultMaxChars: 50,
}

const TAB_1 = brandString<DesktopBrowserTabId>('tab-1')
const GEN_1 = brandNumber<DesktopBrowserTargetGeneration>(1)
const TARGET_1: DesktopBrowserTarget = { tabId: TAB_1, generation: GEN_1 }
const SNAPSHOT_1 = brandString<DesktopBrowserSnapshotId>('snap-1')

function createTestHarness(config: DesktopBrowserToolConfig = DEFAULT_CONFIG) {
  const ctx = new Context()
  const tracker = new AgentOwnerTracker()
  const queue = new SessionOperationQueue()

  let lastRequest: { caller: DesktopBrowserCaller; operation: DesktopBrowserOperation; signal: AbortSignal } | undefined
  const requestMock = vi.fn<DesktopBrowserTransport['request']>(async (caller, operation, signal) => {
    lastRequest = { caller, operation, signal }

    switch (operation.kind) {
      case 'tabs.list':
        return {
          status: 'success',
          value: {
            kind: 'tabs',
            tabs: [
              {
                target: TARGET_1,
                url: 'https://example.com',
                title: 'Example',
                active: true,
                ownership: 'user',
                attached: true,
              },
            ],
            truncated: false,
          },
        }
      case 'tabs.open':
        return {
          status: 'success',
          value: {
            kind: 'tab',
            tab: {
              target: TARGET_1,
              url: operation.url,
              title: 'Opened Page',
              active: true,
              ownership: 'agent',
              attached: true,
            },
          },
        }
      case 'tabs.close':
        return {
          status: 'success',
          value: { kind: 'closed', target: operation.target, closed: true },
        }
      case 'page.snapshot':
        return {
          status: 'success',
          value: {
            kind: 'snapshot',
            snapshot: {
              target: operation.target,
              snapshotId: SNAPSHOT_1,
              text: 'A'.repeat(100), // Exceeds snapshotMaxChars (50)
              truncated: false,
            },
          },
        }
      case 'page.read':
        return {
          status: 'success',
          value: {
            kind: 'read',
            target: operation.target,
            value: 'read-value',
            truncated: false,
          },
        }
      case 'page.act':
      case 'page.actAt':
        return {
          status: 'success',
          value: {
            kind: 'action',
            target: operation.target,
            delivered: true,
          },
        }
      case 'page.wait':
        return {
          status: 'success',
          value: {
            kind: 'wait',
            target: operation.target,
            matched: true,
          },
        }
      case 'page.screenshot':
        return {
          status: 'success',
          value: {
            kind: 'screenshot',
            screenshot: {
              target: operation.target,
              screenshotId: SNAPSHOT_1,
              bytes: new Uint8Array([1, 2, 3, 4]),
              viewport: { width: 800, height: 600 },
            },
          },
        }
    }
  })

  const transport: DesktopBrowserTransport = {
    request: requestMock,
    releaseOwner: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }

  const savedImageRef: ImageAttachmentRef = {
    attachmentId: 'att-1' as never,
    mediaType: 'image/png',
    bytes: 4,
    width: 800,
    height: 600,
  }

  const attachments = {
    saveImage: vi.fn().mockResolvedValue(savedImageRef),
  }
  ctx.provide('attachments', attachments as never)

  let visionSupported = true
  const llm = {
    resolveModelInfo: vi.fn(async () => ({
      provider: 'mock',
      id: 'mock-model',
      inputModalities: visionSupported ? ['text', 'image'] : ['text'],
    })),
  }
  ctx.provide('llm', llm as never)

  const tools = createDesktopBrowserTools(ctx, transport, config, tracker, queue)
  const toolMap = new Map(tools.map(t => [t.name, t]))

  return {
    ctx,
    transport,
    attachments,
    tracker,
    queue,
    toolMap,
    getLastRequest: () => lastRequest,
    setVisionSupported: (supported: boolean) => { visionSupported = supported },
  }
}
function makeExec(sessionId = 'session-1'): ToolRunContext {
  const signal = new AbortController().signal
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 'token-1' as never,
    name: 'browser_tabs',
    arguments: {},
    signal,
    deferContext: () => {},
    concludeTurn: () => {},
    agent: {
      session: {
        id: sessionId,
        requestHeader: () => ({ config: { provider: 'mock', model: 'mock-model' } }),
      },
      options: { provider: 'mock', model: 'mock-model' },
    } as never,
  }
}

describe('Desktop browser tools', () => {
  it('enforces live agent caller identity and assigns monotonic owner generations', async () => {
    const { toolMap, getLastRequest } = createTestHarness()
    const browserTabs = toolMap.get('browser_tabs')!

    // Agentless invocation throws
    await expect(browserTabs.execute({}, { callId: 'c' as never, signal: new AbortController().signal } as never)).rejects.toThrow(
      'Desktop browser tools require an active Agent session',
    )

    // With agent, extracts caller and assigns monotonic ownerGeneration
    const exec1 = makeExec('session-A')
    await browserTabs.execute({}, exec1)
    const req1 = getLastRequest()!
    expect(req1.caller.sessionId).toBe('session-A')
    expect(req1.caller.ownerGeneration).toBe(1)

    // Second call with same agent keeps same generation
    await browserTabs.execute({}, exec1)
    const req2 = getLastRequest()!
    expect(req2.caller.ownerGeneration).toBe(1)

    // Different agent receives next generation
    const exec2 = makeExec('session-B')
    await browserTabs.execute({}, exec2)
    const req3 = getLastRequest()!
    expect(req3.caller.sessionId).toBe('session-B')
    expect(req3.caller.ownerGeneration).toBe(2)
  })

  it('serializes operations per live Session', async () => {
    const { toolMap } = createTestHarness()
    const browserTabs = toolMap.get('browser_tabs')!
    const exec = makeExec('session-serial')

    const sequence: number[] = []

    const p1 = browserTabs.execute({}, exec).then(() => sequence.push(1))
    const p2 = browserTabs.execute({}, exec).then(() => sequence.push(2))

    await Promise.all([p1, p2])
    expect(sequence).toEqual([1, 2])
  })

  it('browser_tabs lists open tabs with inventory and render view', async () => {
    const { toolMap } = createTestHarness()
    const tool = toolMap.get('browser_tabs')!
    const result = await tool.execute({}, makeExec())

    expect(result).toMatchObject({
      backend: 'desktop-internal',
      truncated: false,
    })
    const rendered = tool.output.render({}, result as never)
    expect(rendered[0]?.type === 'text' ? rendered[0].text : '').toContain('Sidebar Browser tabs (1)')
    expect(rendered[0]?.type === 'text' ? rendered[0].text : '').toContain('https://example.com')
  })

  it('browser_open navigates to URL and returns opened tab', async () => {
    const { toolMap, getLastRequest } = createTestHarness()
    const tool = toolMap.get('browser_open')!
    const result = await tool.execute({ url: 'https://new.example', newTab: true }, makeExec())

    expect(getLastRequest()?.operation).toEqual({
      kind: 'tabs.open',
      url: 'https://new.example',
      newTab: true,
    })
    expect(result).toMatchObject({
      title: 'Opened Page',
    })
  })

  it('browser_close closes target tab', async () => {
    const { toolMap, getLastRequest } = createTestHarness()
    const tool = toolMap.get('browser_close')!
    const result = await tool.execute({ target: { tabId: 'tab-1', generation: 1 } }, makeExec())

    expect(getLastRequest()?.operation).toEqual({
      kind: 'tabs.close',
      target: TARGET_1,
    })
    expect(result).toEqual({ target: TARGET_1, closed: true })
  })

  it('browser_snapshot truncates text exceeding snapshotMaxChars', async () => {
    const { toolMap } = createTestHarness({ ...DEFAULT_CONFIG, snapshotMaxChars: 50 })
    const tool = toolMap.get('browser_snapshot')!
    const result = (await tool.execute({ target: { tabId: 'tab-1', generation: 1 } }, makeExec())) as {
      text: string
      truncated: boolean
    }

    expect(result.text.length).toBe(50)
    expect(result.truncated).toBe(true)
  })

  it('browser_read validates locator and attribute parameters', async () => {
    const { toolMap } = createTestHarness()
    const tool = toolMap.get('browser_read')!

    // Attribute read requires attribute name
    await expect(
      tool.execute(
        {
          target: { tabId: 'tab-1', generation: 1 },
          locator: { kind: 'ref', snapshotId: 'snap-1', ref: 'ref-1' },
          property: 'attribute',
        },
        makeExec(),
      ),
    ).rejects.toThrow('Attribute property read requires non-empty attribute name')

    // Valid read returns property
    const res = await tool.execute(
      {
        target: { tabId: 'tab-1', generation: 1 },
        locator: { kind: 'ref', snapshotId: 'snap-1', ref: 'ref-1' },
        property: 'attribute',
        attribute: 'data-test',
      },
      makeExec(),
    )
    expect(res).toMatchObject({ value: 'read-value', truncated: false })
  })

  describe('browser_act', () => {
    it('validates semantic action parameters', async () => {
      const { toolMap } = createTestHarness()
      const tool = toolMap.get('browser_act')!

      // Fill requires text
      await expect(
        tool.execute(
          {
            target: { tabId: 'tab-1', generation: 1 },
            action: 'fill',
            locator: { kind: 'ref', snapshotId: 'snap-1', ref: 'ref-1' },
          },
          makeExec(),
        ),
      ).rejects.toThrow('Action "fill" requires text parameter')

      // Press requires keys
      await expect(
        tool.execute(
          {
            target: { tabId: 'tab-1', generation: 1 },
            action: 'press',
            locator: { kind: 'ref', snapshotId: 'snap-1', ref: 'ref-1' },
          },
          makeExec(),
        ),
      ).rejects.toThrow('Action "press" requires keys parameter with at least one key')
    })

    it('validates pointer action coordinates and bounds', async () => {
      const { toolMap } = createTestHarness()
      const tool = toolMap.get('browser_act')!

      // Pointer click requires screenshotId
      await expect(
        tool.execute(
          {
            target: { tabId: 'tab-1', generation: 1 },
            action: 'click',
            x: 10,
            y: 20,
          },
          makeExec(),
        ),
      ).rejects.toThrow('Coordinate pointer action "click" requires screenshotId')

      // Negative coordinates rejected
      await expect(
        tool.execute(
          {
            target: { tabId: 'tab-1', generation: 1 },
            action: 'click',
            screenshotId: 'snap-1',
            x: -5,
            y: 20,
          },
          makeExec(),
        ),
      ).rejects.toThrow('valid non-negative x and y coordinates')

      // Drag requires path >= 2 points
      await expect(
        tool.execute(
          {
            target: { tabId: 'tab-1', generation: 1 },
            action: 'drag',
            screenshotId: 'snap-1',
            path: [{ x: 1, y: 1 }],
          },
          makeExec(),
        ),
      ).rejects.toThrow('path with at least 2 points')
    })

    it('delivers valid pointer and semantic actions', async () => {
      const { toolMap } = createTestHarness()
      const tool = toolMap.get('browser_act')!

      const res = await tool.execute(
        {
          target: { tabId: 'tab-1', generation: 1 },
          action: 'click',
          screenshotId: 'snap-1',
          x: 100,
          y: 200,
        },
        makeExec(),
      )
      expect(res).toMatchObject({ delivered: true })
    })
  })

  it('browser_wait parses and delivers wait conditions', async () => {
    const { toolMap, getLastRequest } = createTestHarness()
    const tool = toolMap.get('browser_wait')!

    const res = await tool.execute(
      {
        target: { tabId: 'tab-1', generation: 1 },
        condition: { kind: 'load' },
      },
      makeExec(),
    )
    expect(res).toEqual({ target: TARGET_1, matched: true })
    expect(getLastRequest()?.operation).toEqual({
      kind: 'page.wait',
      target: TARGET_1,
      condition: { kind: 'load', state: 'domcontentloaded' },
    })
  })

  describe('browser_screenshot', () => {
    it('refuses capture when model does not support vision', async () => {
      const { toolMap, setVisionSupported } = createTestHarness()
      const tool = toolMap.get('browser_screenshot')!
      setVisionSupported(false)

      await expect(
        tool.execute({ target: { tabId: 'tab-1', generation: 1 } }, makeExec()),
      ).rejects.toThrow('does not declare image input; switch to an image-capable model to view screenshots')
    })

    it('persists screenshot through attachments and renders image block', async () => {
      const { toolMap, attachments } = createTestHarness()
      const tool = toolMap.get('browser_screenshot')!

      const res = (await tool.execute({ target: { tabId: 'tab-1', generation: 1 } }, makeExec())) as {
        screenshotId: string
        image: ImageAttachmentRef
        viewport: { width: number; height: number }
      }

      expect(attachments.saveImage).toHaveBeenCalledWith({
        data: expect.any(Uint8Array),
        mediaType: 'image/png',
      })
      expect(res.screenshotId).toBe(SNAPSHOT_1)
      expect(res.image.attachmentId).toBe('att-1')

      const rendered = tool.output.render({}, res as never)
      expect(rendered.length).toBe(2)
      expect(rendered[0]?.type).toBe('text')
      expect(rendered[1]).toEqual({
        type: 'image',
        attachment: expect.objectContaining({ attachmentId: 'att-1' }),
      })
    })
  })

  it('propagates transport error with stable error code', async () => {
    const { toolMap, transport } = createTestHarness()
    transport.request = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'stale-target',
      message: 'Browser target has expired',
    })

    const tool = toolMap.get('browser_snapshot')!
    await expect(
      tool.execute({ target: { tabId: 'tab-1', generation: 1 } }, makeExec()),
    ).rejects.toThrow('browser_snapshot failed: [stale-target] Browser target has expired')
  })
})
