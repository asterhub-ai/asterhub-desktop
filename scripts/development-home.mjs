/**
 * Resolve the Harness home for source and development launches.
 *
 * Development Sessions must never land in the installed product's home, so every
 * source launcher routes through {@link resolveDevelopmentHome}: it defaults to an
 * isolated directory inside the checkout, honors an explicit non-empty `DSH_HOME`,
 * and refuses the installed product home instead of silently writing Sessions the
 * packaged application would then show.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Development Harness home directory name, used at the repository root. */
export const SOURCE_DEVELOPMENT_HOME_DIRECTORY = '.asterhub-dev'

/** Installed product Harness home directory name; duplicated from `dsh-home-paths` so plain-Node scripts need no build. */
const PRODUCT_HOME_DIRECTORY = '.asterhub'

/**
 * Expand a leading `~` against an explicit user home.
 * @param value - configured home path, possibly `~`-rooted.
 * @param userHome - absolute user home directory used for expansion.
 * @returns the path with `~` replaced, or the original value.
 */
function expandUserHome(value, userHome) {
  if (value === '~') return userHome
  if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(userHome, value.slice(2))
  return value
}

/**
 * Compare two paths under the host's case sensitivity.
 * @param left - absolute path.
 * @param right - absolute path.
 * @returns whether both name the same directory on this platform.
 */
function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Resolve one development Harness home.
 * @param options - default home, environment carrying the `DSH_HOME` override, and the user home owning the product home.
 * @returns the resolved absolute development home.
 * @throws Error when the resolved home is the installed product home.
 */
export function resolveDevelopmentHome(options) {
  const { defaultHome, env = process.env, userHome = homedir() } = options
  const configured = env.DSH_HOME
  const requested = configured === undefined || configured.trim() === ''
    ? defaultHome
    : expandUserHome(configured.trim(), userHome)
  const home = resolve(requested)
  const productHome = resolve(join(userHome, PRODUCT_HOME_DIRECTORY))
  if (samePath(home, productHome)) {
    throw new Error(`development launch: refusing the installed product home ${productHome}; unset DSH_HOME or point it at an isolated development home`)
  }
  return home
}

/**
 * The default source-checkout development home at a repository root.
 * @param root - repository root; defaults to the parent of this script's directory.
 * @returns the absolute `<root>/.asterhub-dev` path.
 */
export function sourceDevelopmentHome(root = resolve(import.meta.dirname, '..')) {
  return resolve(root, SOURCE_DEVELOPMENT_HOME_DIRECTORY)
}
