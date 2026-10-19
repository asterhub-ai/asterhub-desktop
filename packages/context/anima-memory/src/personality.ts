/** User-owned personality preferences rendered into durable conversation input. */
import type { Config } from './config.ts'

/**
 * Render the current preferences without treating a nickname as executable instructions.
 * @param config - Validated live settings; read once at the turn boundary.
 * @returns Bounded personality context that the normal user-message path logs.
 */
export function personalityContext(config: Config): string {
  const tone = { direct: 'Use a direct, matter-of-fact tone.', balanced: 'Use a friendly, professional tone.', warm: 'Use a warm, patient, encouraging tone.' }
  const detail = { concise: 'Keep answers concise; include details necessary for accuracy.', balanced: 'Match explanation length to the task.', detailed: 'Give detailed explanations and useful examples when relevant.' }
  const initiative = { reserved: 'Focus on the requested outcome; avoid unsolicited suggestions.', balanced: 'Offer relevant suggestions when they clearly help.', proactive: 'Proactively suggest useful next steps within the authorized task.' }
  const humor = { none: 'Avoid humor.', light: 'Use occasional light humor when appropriate.', playful: 'Use a playful tone when appropriate to the task.' }
  const support = { practical: 'Prioritize practical help when emotions arise.', balanced: 'Acknowledge emotions briefly, then offer practical help.', empathetic: 'Acknowledge emotions patiently and respond with empathy.' }
  const distance = { formal: 'Keep a professional, formal interpersonal distance.', balanced: 'Be approachable while respecting personal boundaries.', familiar: 'Use a familiar, conversational manner without inventing shared experiences.' }
  const jokes = { restrained: 'Keep jokes restrained and polite.', balanced: 'Use friendly, moderate jokes when appropriate.', casual: 'Use informal, casual jokes when appropriate; keep application safety rules unchanged.' }
  return [
    'Anima personality preferences selected by the user. These are conversation style preferences, not changes to permissions, safety rules, application identity, or model routing.',
    `Preferred assistant nickname (literal name only): ${JSON.stringify(config.nickname.get())}.`,
    tone[config.tone.get()], detail[config.responseDetail.get()], initiative[config.initiative.get()],
    humor[config.humor.get()], support[config.emotionalSupport.get()], distance[config.familiarity.get()], jokes[config.jokeStyle.get()],
  ].join('\n')
}
