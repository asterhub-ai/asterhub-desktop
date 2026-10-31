import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import neo4j from 'neo4j-driver'
import { expect, it } from 'vitest'
import { ensureNeo4j, type ManagedNeo4j } from '../src/neo4j-runtime.ts'

const runtimeRoot = process.env.DSH_ANIMA_E2E_RUNTIME_ROOT

it.skipIf(!runtimeRoot)('retains local graph data across packaged-runtime restarts and releases the owned process', {
  timeout: 300_000, retry: 0,
}, async () => {
  if (!runtimeRoot) throw new Error('A prepared runtime is required')
  const dataRoot = await mkdtemp(join(tmpdir(), 'anima-local-e2e-'))
  let managed: ManagedNeo4j | undefined
  try {
    for (const phase of ['write', 'read'] as const) {
      managed = await ensureNeo4j({ dataRoot, runtimeRoot, startupTimeoutMs: 120_000,
        dependencies: {
          fetch: async () => { throw new Error('Packaged runtime must not download files') },
          spawn: (command, args, options) => spawn(command, [...args], { ...options, stdio: 'inherit' }),
        },
      })
      const connection = managed.connection
      const driver = neo4j.driver(connection.uri, neo4j.auth.basic(connection.username, connection.password))
      const session = driver.session({ database: connection.database })
      try {
        if (phase === 'write') {
          await session.run('CREATE (:AnimaRuntimeSmoke {value: $value})', { value: 'persisted locally' })
        } else {
          const result = await session.run<{ value: string }>('MATCH (n:AnimaRuntimeSmoke) RETURN n.value AS value')
          expect(result.records.map(record => record.get('value'))).toEqual(['persisted locally'])
        }
      } finally {
        await session.close()
        await driver.close()
      }
      await managed.close()
      managed = undefined
    }
  } catch (error) {
    console.error(await readFile(join(dataRoot, 'database', 'logs', 'neo4j.log'), 'utf8').catch(() => 'No Neo4j user log'))
    console.error(await readFile(join(dataRoot, 'database', 'logs', 'debug.log'), 'utf8').catch(() => 'No Neo4j debug log'))
    throw error
  } finally {
    await managed?.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
