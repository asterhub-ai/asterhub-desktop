/** Environment variable that supplies the Electron application identifier. */
export const DESKTOP_APP_ID_ENV: 'DSH_DESKTOP_APP_ID'

/** Environment variable that selects the npm registry used for the bundled runtime install. */
export const NPM_REGISTRY_ENV: 'DSH_DESKTOP_NPM_REGISTRY'

/**
 * Resolve and validate the application identifier shared by every platform target.
 * @param env - Packaging environment.
 * @returns Reverse-DNS application identifier.
 */
export function resolveDesktopAppId(env: NodeJS.ProcessEnv): string

/**
 * Resolve the npm registry used to materialize the bundled runtime and its external dependencies.
 * @param env - Packaging environment.
 * @returns Registry origin; the public registry unless a local mirror is configured.
 */
export function resolveNpmRegistry(env: NodeJS.ProcessEnv): string
