/** Official reasoning Markdown and the default body-to-content adapter. */
import { memo, useMemo } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { markdownLabels } from '../markdown-labels.ts'
import type { ReasoningBodyOwnerProps } from '../contract/slots.ts'

type ReasoningBodyProps = PropsRuntime<'conversation.chat.reasoning.body'> & PropsRenderFactories

/** Render compact reasoning with optional caller labels or Chat's localized defaults.
 * @param props - reasoning text, streaming state, optional labels, and the locale seat.
 * @returns compact Markdown for a reasoning disclosure.
 */
export const ReasoningContent = memo(function ReasoningContent({ text, running, labels, t }: FactoryComponentPropsOf<'conversation.chat.reasoning.content'>) {
  const resolvedLabels = useMemo(() => labels ?? markdownLabels(t), [labels, t])
  return <MarkdownText text={text} streaming={running} labels={resolvedLabels} variant="compact" />
})

/** Render the default Body through the same Factory exposed to wrappers.
 * @param props - one reasoning body and the framework Factory renderer.
 * @returns the official reasoning-content Factory occurrence.
 */
export function DefaultReasoningBody({ text, running, renderFactorySlot }: ReasoningBodyProps & ReasoningBodyOwnerProps) {
  return renderFactorySlot('conversation.chat.reasoning.content', { text, running })
}
