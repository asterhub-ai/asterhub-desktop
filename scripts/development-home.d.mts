/** Declarations for the plain-Node {@link ./development-home.mjs} script helper. */

export declare const SOURCE_DEVELOPMENT_HOME_DIRECTORY: '.asterhub-dev'

/** Default home and environment carrying the `DSH_HOME` override. */
export interface DevelopmentHomeOptions {
  /** Home used when `DSH_HOME` is unset or blank. */
  readonly defaultHome: string
  /** Process environment supplying `DSH_HOME`; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** User home directory owning the installed product home; defaults to `os.homedir()`. */
  readonly userHome?: string
}

/**
 * Resolve one development Harness home.
 * @param options - default home and environment carrying the `DSH_HOME` override.
 * @returns the resolved absolute development home.
 * @throws Error when the resolved home is the installed product home.
 */
export declare function resolveDevelopmentHome(options: DevelopmentHomeOptions): string

/**
 * The default source-checkout development home at a repository root.
 * @param root - repository root; defaults to the parent of this script's directory.
 * @returns the absolute `<root>/.asterhub-dev` path.
 */
export declare function sourceDevelopmentHome(root?: string): string
