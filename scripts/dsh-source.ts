/**
 * Source-checkout launcher for `dsh` that runs the CLI in-process with an
 * isolated development Harness home.
 *
 * `pnpm dsh` and every root script that serves through the source launcher enter
 * here, so development Sessions, settings, and credentials cannot appear in the
 * installed product's `~/.asterhub`. Packaged launchers keep calling
 * `apps/cli/src/bin.ts` directly and are unaffected.
 */

import { homedir } from 'node:os'
import { runCli } from '../apps/cli/src/bin.ts'
import { resolveDevelopmentHome, sourceDevelopmentHome } from './development-home.mjs'

const home = resolveDevelopmentHome({ defaultHome: sourceDevelopmentHome(), env: process.env, userHome: homedir() })
process.env.DSH_HOME = home
console.error(`dsh source: DSH_HOME=${home}`)

await runCli()
