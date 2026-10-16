/** Masked credential presentation with a per-value reveal control in interactive text. */
import { useState } from 'react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconSearchOutlineRegular, IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import { MASK } from './credential-masks.ts'
import css from './SecretText.module.css'

const MASK_RUNS = new RegExp(`(\\${MASK}+)`, 'u')


/**
 * Split the masked form into kept text and mask runs. Mask runs keep their
 * characters for copying and assistive technology but draw centered marks,
 * because a font's own asterisk sits near the cap height.
 */
function MaskedText({ masked }: { readonly masked: string }) {
  let offset = 0
  return masked.split(MASK_RUNS).map((part) => {
    const key = offset
    offset += part.length
    if (part === '') return null
    return part.startsWith(MASK)
      ? <span key={key} className={css.mask}>{part}</span>
      : <span key={key}>{part}</span>
  })
}

type SecretTextProps = UserTextNodeProps<'secret'> & PropsLocale<typeof NS>

/**
 * Draw one credential masked; interactive text adds a control that reveals or hides this value.
 * Every mount, and every different original value at the same position, starts masked.
 * @param props - masked node, original spelling, interaction mode, and locale seat.
 * @returns an inline masked run with an optional reveal control.
 */
export function SecretText({ node, raw, interactive, t }: SecretTextProps) {
  // Holding the revealed value instead of a flag re-masks a different credential that reuses this element.
  const [revealedRaw, setRevealedRaw] = useState<string | undefined>()
  const revealed = interactive && revealedRaw === raw
  return (
    <span className={css.secret} data-secret="">
      <span className={css.value}>{revealed ? raw : <MaskedText masked={node.data.masked} />}</span>
      {interactive && (
        <button
          type="button"
          className={css.toggle}
          aria-pressed={revealed}
          aria-label={t(revealed ? 'secret.hide' : 'secret.reveal')}
          onClick={() => { setRevealedRaw(revealed ? undefined : raw) }}
        >
          {revealed ? <IconShieldOutlineRegular size={14} /> : <IconSearchOutlineRegular size={14} />}
        </button>
      )}
    </span>
  )
}
