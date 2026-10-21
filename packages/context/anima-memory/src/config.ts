/** Anima's profile-owned policy, projected into the dedicated settings page. */
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/** Local memory collection, recall, and auxiliary model limits. */
export interface Policy {
  /** Enable the memory subsystem without deleting stored records. */
  enabled: boolean
  /** Recall relevant memories before the first step of each turn. */
  automaticRecall: boolean
  /** Retain bounded turn evidence in the local memory store. */
  captureEpisodes: boolean
  /** Permit memory creation and revision by model-facing tools. */
  allowMemoryWrites: boolean
  /** Review and reflect on accumulated memories after completed turns. */
  reflectionEnabled: boolean
  /** Maximum recalled entries per request. */
  recallLimit: number
  /** UTF-8 byte limit on the complete recalled context message. */
  maxContextBytes: number
  /** Character limit on an individual memory narrative. */
  maxMemoryChars: number
  /** Empty with model to inherit the session's logged route. */
  modelProvider: string
  /** Empty with modelProvider to inherit the session's logged route. */
  model: string
  /** Complete auxiliary model input limit in UTF-8 bytes. */
  maxInputBytes: number
  /** Auxiliary model output token limit. */
  maxOutputTokens: number
  /** Auxiliary model request deadline in milliseconds. */
  timeoutMs: number
}

/** Local paths and operation-level live policy references. */
export interface Config {
  /** Local Neo4j databases, authentication, installation identity, and managed runtime files. */
  dataRoot: string
  /** Optional packaged Neo4j and Java runtime directory. */
  runtimeRoot: string
  /** Events read per asynchronous Session persistence page. */
  capturePageSize: number
  /** Managed database startup deadline in milliseconds. */
  startupTimeoutMs: number
  /** Core shutdown budget in milliseconds. */
  shutdownTimeoutMs: number
  /** User-facing assistant nickname; does not replace the application identity. */
  nickname: Volatile<string>
  /** Communication warmth selected by the user. */
  tone: Volatile<'direct' | 'balanced' | 'warm'>
  /** Preferred amount of explanation in conversation. */
  responseDetail: Volatile<'concise' | 'balanced' | 'detailed'>
  /** Preferred amount of unsolicited suggestions within the authorized task. */
  initiative: Volatile<'reserved' | 'balanced' | 'proactive'>
  /** Preferred frequency of humor. */
  humor: Volatile<'none' | 'light' | 'playful'>
  /** Preferred emotional support style. */
  emotionalSupport: Volatile<'practical' | 'balanced' | 'empathetic'>
  /** Preferred interpersonal distance. */
  familiarity: Volatile<'formal' | 'balanced' | 'familiar'>
  /** Preferred informality of jokes, subject to application safety rules. */
  jokeStyle: Volatile<'restrained' | 'balanced' | 'casual'>
  /** Enable graph capture, recall, and tool access. */
  enabled: Volatile<boolean>
  /** Recall matching project memories before the first turn step. */
  automaticRecall: Volatile<boolean>
  /** Capture Session evidence needed for graph memory and reflections. */
  captureEpisodes: Volatile<boolean>
  /** Permit graph memory writes. */
  allowMemoryWrites: Volatile<boolean>
  /** Run candidate reviews and project reflection independently of extraction. */
  reflectionEnabled: Volatile<boolean>
  /** Maximum recalled results, source claims, and review candidates per operation. */
  recallLimit: Volatile<number>
  /** UTF-8 budget for recalled and rendered reflection output. */
  maxContextBytes: Volatile<number>
  /** Maximum exact human text span accepted for memory statements. */
  maxMemoryChars: Volatile<number>
  /** Empty with model to use the Session request route. */
  modelProvider: Volatile<string>
  /** Empty with model to use the Session request route. */
  model: Volatile<string>
  /** UTF-8 byte budget for auxiliary model inputs and outputs. */
  maxInputBytes: Volatile<number>
  /** Auxiliary model completion token budget. */
  maxOutputTokens: Volatile<number>
  /** Auxiliary model request deadline. */
  timeoutMs: Volatile<number>
}

/** Loader validates all persisted settings before activation. */
export const Config = z.object({
  dataRoot: z.string().required(),
  runtimeRoot: z.string().default(''),
  capturePageSize: z.number().step(1).min(1).max(4096).default(128),
  startupTimeoutMs: z.number().step(1).min(1000).max(300000).default(120000),
  shutdownTimeoutMs: z.number().step(1).min(1000).max(300000).default(30000),
  nickname: z.string().min(1).max(40).default('小琦').volatile(),
  tone: z.union(['direct', 'balanced', 'warm']).default('balanced').volatile(),
  responseDetail: z.union(['concise', 'balanced', 'detailed']).default('balanced').volatile(),
  initiative: z.union(['reserved', 'balanced', 'proactive']).default('balanced').volatile(),
  humor: z.union(['none', 'light', 'playful']).default('light').volatile(),
  emotionalSupport: z.union(['practical', 'balanced', 'empathetic']).default('balanced').volatile(),
  familiarity: z.union(['formal', 'balanced', 'familiar']).default('balanced').volatile(),
  jokeStyle: z.union(['restrained', 'balanced', 'casual']).default('restrained').volatile(),
  enabled: z.boolean().default(true).volatile(),
  automaticRecall: z.boolean().default(true).volatile(),
  captureEpisodes: z.boolean().default(true).volatile(),
  allowMemoryWrites: z.boolean().default(true).volatile(),
  reflectionEnabled: z.boolean().default(true).volatile(),
  recallLimit: z.number().step(1).min(1).max(20).default(5).volatile(),
  maxContextBytes: z.number().step(1).min(512).max(65536).default(8192).volatile(),
  maxMemoryChars: z.number().step(1).min(256).max(100000).default(16000).volatile(),
  modelProvider: z.string().default('').volatile(),
  model: z.string().default('').volatile(),
  maxInputBytes: z.number().step(1).min(1024).max(1000000).default(32768).volatile(),
  maxOutputTokens: z.number().step(1).min(128).max(16384).default(2048).volatile(),
  timeoutMs: z.number().step(1).min(1000).max(300000).default(30000).volatile(),
})

/**
 * Capture all mutable settings at an operation boundary.
 * @param config - Live Loader configuration.
 * @returns a detached immutable policy snapshot.
 */
export function policyOf(config: Config): Policy {
  return {
    enabled: config.enabled.get(),
    automaticRecall: config.automaticRecall.get(),
    captureEpisodes: config.captureEpisodes.get(),
    allowMemoryWrites: config.allowMemoryWrites.get(),
    reflectionEnabled: config.reflectionEnabled.get(),
    recallLimit: config.recallLimit.get(),
    maxContextBytes: config.maxContextBytes.get(),
    maxMemoryChars: config.maxMemoryChars.get(),
    modelProvider: config.modelProvider.get(),
    model: config.model.get(),
    maxInputBytes: config.maxInputBytes.get(),
    maxOutputTokens: config.maxOutputTokens.get(),
    timeoutMs: config.timeoutMs.get(),
  }
}
