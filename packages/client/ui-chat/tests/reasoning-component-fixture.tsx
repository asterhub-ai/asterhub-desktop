/** Image capability for reasoning component cases without durable attachments. */
import type { AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { markdownLabels } from '../src/client/markdown-labels.ts'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)
const labels = markdownLabels(t)

/** Render the reasoning body and omit images in direct component cases. */
export const emptyMessageImagesSlot: AssistantMarkdownProps['renderSlot'] = (key, owner) => {
  if (key === 'conversation.chat.reasoning.body'
    && 'text' in owner && typeof owner.text === 'string'
    && 'running' in owner && typeof owner.running === 'boolean') {
    return <MarkdownText text={owner.text} streaming={owner.running} labels={labels} variant="compact" />
  }
  return null
}

/** Reject image loading in component cases that contain no attachments. */
export const unusedImageLoader: AssistantMarkdownProps['loadImage'] = async () => {
  throw new Error('This component fixture has no durable image attachments')
}
