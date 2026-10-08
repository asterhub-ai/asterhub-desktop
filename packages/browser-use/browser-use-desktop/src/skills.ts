/** Bundled browser-use skills for AsterHub's Desktop Sidebar Browser. */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as parseYaml } from 'js-yaml'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'

const DESKTOP_SKILL_NAMES = ['control-browser', 'web-gui-tester'] as const

function parseSkill(raw: string, path: string): { description: string; content: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (frontmatter?.[1] === undefined) throw new Error(`skill: ${path} has no YAML frontmatter`)
  const metadata = parseYaml(frontmatter[1]) as Record<string, unknown>
  const description = typeof metadata === 'object' && metadata !== null && 'description' in metadata
    ? String(metadata.description) : undefined
  if (!description || description.length === 0) throw new Error(`skill: ${path} has no description`)
  return { description, content: raw.slice(frontmatter[0].length).trim() }
}

/** Construct the bundled desktop browser skill provider. */
export function createDesktopSkillProvider(assetRoot?: string): SkillProvider {
  const root = assetRoot ?? fileURLToPath(new URL('../assets/', import.meta.url))

  const candidates: SkillCandidate[] = DESKTOP_SKILL_NAMES.map((name) => {
    const directory = join(root, name)
    const filePath = join(directory, 'SKILL.md')
    const raw = readFileSync(filePath, 'utf8')
    const { description } = parseSkill(raw, filePath)
    return {
      name,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-browser-use-desktop',
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: directory },
      locator: filePath,
    }
  })

  return {
    name: 'dsh-browser-use-desktop',
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator as string, { encoding: 'utf8', signal: options.signal })
      return { ...summary, content: parseSkill(raw, locator as string).content }
    },
  }
}
