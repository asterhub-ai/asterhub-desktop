/** Exercise real OAR native probes and Claude environment construction in an isolated host process. */

import { defaultRuntimes } from '@botiverse/oar'
import { promptAndWait } from '@botiverse/oar/observe'
import { oarEnvironment } from '../../src/environment.ts'

for (const runtimeId of ['codex', 'claude']) {
  const runtime = defaultRuntimes.require(runtimeId)
  const env = oarEnvironment({
    OAR_FIXTURE_RUNTIME: runtimeId,
    OAR_FIXTURE_EXPLICIT_TOKEN: 'explicit-fixture-value',
    OAR_FIXTURE_DELETE: null,
  })
  // oar@0.67.0 probes take no arguments and read their own environment; apply the overlay in-process.
  for (const [key, value] of Object.entries(env)) {
    if (value === null) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  const installation = await runtime.installation?.()
  if (installation?.kind !== 'available') throw new Error('Fixture installation unavailable')
  if (runtimeId !== 'claude') continue
  const session = await runtime.session(installation, {
    cwd: process.cwd(), env, launchArgs: ['--permission-mode', 'dontAsk', '--permission-prompts', 'none'],
  })
  try {
    const result = await promptAndWait(session, 'Return the fixture answer.', { timeoutMs: 10_000 })
    if (result.kind !== 'ended' || result.outcome.kind !== 'completed') throw new Error('Fixture turn did not complete')
  } finally {
    await session.dispose()
  }
}
