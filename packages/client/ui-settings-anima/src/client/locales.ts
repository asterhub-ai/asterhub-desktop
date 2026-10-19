/** Locale bundles for user-facing Anima personality and model choices. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Localized labels consumed by the Anima settings page. */
export type AnimaSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'privacy' | 'nickname' | 'nicknameHint' | 'invalidNickname'
  | 'personalityHeading' | 'personalityHint' | 'tone' | 'responseDetail' | 'initiative' | 'humor' | 'emotionalSupport' | 'familiarity' | 'jokeStyle'
  | 'direct' | 'balanced' | 'warm' | 'concise' | 'detailed' | 'reserved' | 'proactive' | 'none' | 'light' | 'playful'
  | 'practical' | 'empathetic' | 'formal' | 'familiar' | 'restrained' | 'casual'
  | 'reflectionEnabled' | 'reflectionHint' | 'modelHeading' | 'modelIntro' | 'model' | 'sessionModel' | 'modelUnavailable' | 'modelError' | 'modelLoading' | 'retry'
  | 'overridden' | 'reset' | 'save' | 'saving' | 'discard' | 'saveFailed' | 'readOnly' | 'unavailable'

/** English Anima settings copy. */
export const en: Record<AnimaSettingsLocaleKey, string> = {
  nav: 'Anima', title: 'Anima', intro: 'Give your assistant a name and choose how you like to communicate.',
  privacy: 'Memory stays on this device. Memory processing and conversation may send relevant content to your selected AsterHub model.',
  nickname: 'Nickname', nicknameHint: 'What would you like to call your assistant? Use 1–40 characters.', invalidNickname: 'Enter a nickname of 1–40 characters.',
  personalityHeading: 'Personality', personalityHint: 'These preferences apply to future turns after saving.',
  tone: 'Communication tone', responseDetail: 'Explanation detail', initiative: 'Initiative', humor: 'Humor', emotionalSupport: 'Emotional response', familiarity: 'Familiarity', jokeStyle: 'Joke style',
  direct: 'Direct', balanced: 'Balanced', warm: 'Warm', concise: 'Concise', detailed: 'Detailed', reserved: 'Focus on my request', proactive: 'Suggest next steps',
  none: 'None', light: 'Occasional', playful: 'Playful', practical: 'Practical help', empathetic: 'Empathetic', formal: 'Professional', familiar: 'Conversational', restrained: 'Restrained', casual: 'Casual',
  reflectionEnabled: 'Enable reflection', reflectionHint: 'Review past work to organize useful memories. Memory capture and recall are always available.',
  modelHeading: 'Memory model', modelIntro: 'Choose from the models available in your AsterHub account for extraction and reflection.',
  model: 'Extraction and reflection model', sessionModel: 'Use the current conversation model', modelUnavailable: 'This model is no longer available. Choose another model.',
  modelError: 'Available models could not be loaded', modelLoading: 'Loading available models…', retry: 'Retry',
  overridden: 'Customized', reset: 'Use default', save: 'Save', saving: 'Saving…', discard: 'Discard changes',
  saveFailed: 'These settings were not accepted. Your edits are still here.', readOnly: 'Settings are read-only in this connection.', unavailable: 'Anima settings are not available in this connection.',
}

/** Simplified Chinese Anima settings copy. */
export const zh: Record<AnimaSettingsLocaleKey, string> = {
  nav: 'Anima', title: 'Anima', intro: '为助手取个昵称，调整你喜欢的交流方式。',
  privacy: '记忆保存在本机。记忆处理和对话时，相关内容可能发送给你选择的 AsterHub 模型。',
  nickname: '人格昵称', nicknameHint: '你希望怎么称呼助手？支持 1–40 个字符。', invalidNickname: '请输入 1–40 个字符的昵称',
  personalityHeading: '人格偏好', personalityHint: '保存后，从后续对话轮次开始生效。',
  tone: '表达语气', responseDetail: '解释详细程度', initiative: '主动程度', humor: '幽默程度', emotionalSupport: '情绪回应', familiarity: '相处距离', jokeStyle: '玩笑风格',
  direct: '直接利落', balanced: '适中', warm: '温暖耐心', concise: '简明扼要', detailed: '详细解释', reserved: '专注当前请求', proactive: '主动建议下一步',
  none: '不使用幽默', light: '偶尔幽默', playful: '轻松风趣', practical: '侧重实际帮助', empathetic: '侧重共情陪伴', formal: '专业正式', familiar: '自然亲切', restrained: '克制礼貌', casual: '轻松随意',
  reflectionEnabled: '启用反思', reflectionHint: '回顾过往工作，整理有用的记忆。记忆记录和检索始终可用。',
  modelHeading: '记忆处理模型', modelIntro: '从当前 AsterHub 账户的可用模型中选择，用于记忆提炼和反思。',
  model: '记忆提炼与反思模型', sessionModel: '使用当前对话模型', modelUnavailable: '原模型已不可用，请重新选择',
  modelError: '暂时无法加载可用模型', modelLoading: '正在加载可用模型…', retry: '重试',
  overridden: '已自定义', reset: '使用默认值', save: '保存', saving: '保存中…', discard: '放弃修改',
  saveFailed: '设置未被接受，已保留你的修改', readOnly: '此连接中的设置为只读', unavailable: '此连接中无法使用 Anima 设置',
}

/**
 * Resolve the shared form labels from the page locale.
 * @param t - Reader bound to settings.anima.
 * @returns Localized labels for the settings form.
 */
export function formLabels(t: (key: AnimaSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
