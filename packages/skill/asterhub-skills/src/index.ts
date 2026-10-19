/** Bundled AsterHub SDK workflows for persistent-session development and cross-review. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as FileSystemSkills from '@deepseek-ai/dsh-skill-filesystem'

const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/** Cordis plugin identity. */
export const name = 'asterhub-skills'
/** Skill registry required by the bundled local provider. */
export const inject = ['skills']

/**
 * Register the packaged AsterHub skills at the filesystem provider's bundled rank.
 * @param ctx - Context owning the bundled skill provider's lifetime.
 */
export function apply(ctx: Context): void {
  FileSystemSkills.apply(ctx, {
    providerName: 'asterhub-bundled',
    includeDefaultRoots: false,
    bundledSkillDir: BUNDLED_SKILL_DIR,
    watch: false,
  })
}
