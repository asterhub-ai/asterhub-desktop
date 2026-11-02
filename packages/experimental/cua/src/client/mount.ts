/** Optional Computer Use controls mounted through existing plugin-page and overlay slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cua/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ApplicationApproval, selectApplicationApproval } from './ApplicationApproval.tsx'
import { PermissionController } from './controller.ts'
import { PermissionToast } from './PermissionPanel.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type CuaPermissionLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native permission controls and application consent. */
    cuaPermissions: CuaPermissionLocaleKey
  }
}

/** Existing browser registries needed by the optional permission UI. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the optional permission Remote and its browser controls.
 * @param ctx Browser plugin context.
 * @param contribution Generated permission Remote definitions.
 * @returns Cleanup for the optional Remote and UI registrations.
 */
export async function mountCuaPermissions(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const transport = ctx.plugin(async (owner) => { await owner.remote.$mount(contribution) })
  const ui = ctx.inject(['remote.cuaAccess', 'slots', 'locale'], (ctx) => {
    ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }))
    const controller = new PermissionController(ctx.remote.cuaAccess)
    const face = controller.face()
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({
      name: 'conversation.composer', priority: -1, locale: NS,
      select: ({ pendingInteraction }: ComposerChainProps) => selectApplicationApproval(pendingInteraction),
      inject: () => ({ resolveText: (text: { en: string; [locale: string]: string }) => ctx.locale.resolveText(text) }),
    }, ApplicationApproval))
    ctx.effect(() => () => controller.dispose())
    ctx.on('connection/reset', face.refresh)
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'cua-permission-outcome', locale: NS, inject: () => face,
    }, PermissionToast))
  })
  const dispose = ctx.effect(function* () {
    yield transport.dispose
    yield ui.dispose
  }, 'cua-permissions.mount')
  try { await Promise.all([transport, ui]) } catch (error) { await dispose(); throw error }
  return dispose
}
