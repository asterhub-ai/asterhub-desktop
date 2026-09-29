/** Native voice preferences and first-use model preparation. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import { VoicePreparation } from './PreparationCard.tsx'
import { NS } from './locales.ts'

type Props = Pick<InjectFace<VoiceInputInjected>, 'useSpeechReadiness' | 'configure' | 'prepare' | 'cancelPreparation'>
  & PropsLocale<typeof NS> & { subscribeOpen: (listener: () => void) => () => void }

export function VoiceSettings({ subscribeOpen, ...props }: Props) {
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeOpen(() => { setOpen(true) }), [subscribeOpen])
  return <Modal open={open} title={props.t('provider')} closeLabel={props.t('cancel')} onClose={() => { setOpen(false) }}>
    <VoicePreparation {...props} />
  </Modal>
}
