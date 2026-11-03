/** AsterHub occupants for the browser brand slots: sidebar mark/name and the conversation hero mark. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AsterHubBrandMark, AsterHubBrandName, AsterHubHeroBrandMark } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Install the three brand occupants atomically while all owning slots are declared,
 * independent of the client build profile.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, AsterHubBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, AsterHubBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AsterHubHeroBrandMark)
      })))
}
