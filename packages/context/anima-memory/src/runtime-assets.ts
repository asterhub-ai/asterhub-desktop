/** Pinned local runtime assets used by the managed Neo4j process. */

/** Neo4j Community LTS release shipped by the local manager. */
export const NEO4J_VERSION = '5.26.32'
/** Temurin JRE release pinned for every supported operating system. */
export const JRE_RELEASE = 'jdk-21.0.12.1+1'
/** Filename of the platform and version marker required in packaged runtimes. */
export const RUNTIME_MANIFEST_NAME = 'anima-runtime.json'

/** Supported Node platform identifiers. */
export type Neo4jRuntimePlatform = 'win32' | 'linux' | 'darwin'
/** Supported Node architecture identifiers. */
export type Neo4jRuntimeArchitecture = 'x64' | 'arm64'

/** Platform-specific Neo4j archive names and checksum locations. */
export interface Neo4jPlatformAsset {
  /** Runtime platform identifier in the installed manifest. */
  platform: Neo4jRuntimePlatform
  /** Runtime architecture identifier in the installed manifest. */
  architecture: Neo4jRuntimeArchitecture
  /** Official Neo4j archive basename. */
  neo4jArchive: string
  /** Official Neo4j archive URL. */
  neo4jUrl: string
  /** Official SHA-256 sidecar URL for the archive. */
  neo4jChecksumUrl: string
  /** Adoptium assets endpoint pinned to `JRE_RELEASE`. */
  javaMetadataUrl: string
}

/** Installed runtime metadata stored beside the bundled Java and Neo4j trees. */
export interface Neo4jRuntimeManifest {
  /** Schema identifier for package-owned runtime metadata. */
  schema_id: 'anima.local-runtime/v1'
  /** OS identifier against which the binaries were assembled. */
  platform: Neo4jRuntimePlatform
  /** CPU architecture against which the binaries were assembled. */
  architecture: Neo4jRuntimeArchitecture
  /** Exact Neo4j Community version included in the package. */
  neo4j_version: typeof NEO4J_VERSION
  /** Exact JRE release included in the package. */
  java_release: typeof JRE_RELEASE
}

/** Return the official pinned downloads for one supported operating system and architecture.
 * @param platform - Node platform identifier.
 * @param architecture - Node architecture identifier.
 * @returns platform asset URLs, or throws when no pinned build exists.
 */
export function neo4jPlatformAsset(platform: string, architecture: string): Neo4jPlatformAsset {
  const normalizedPlatform: Neo4jRuntimePlatform | undefined = platform === 'win32'
    ? 'win32'
    : platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : undefined
  const normalizedArchitecture: Neo4jRuntimeArchitecture | undefined = architecture === 'x64'
    ? 'x64'
    : architecture === 'arm64' ? 'arm64' : undefined
  if (normalizedPlatform === undefined || normalizedArchitecture === undefined) {
    throw new Error(`Anima has no pinned Neo4j runtime for ${platform}-${architecture}.`)
  }
  const archive = normalizedPlatform === 'win32'
    ? `neo4j-community-${NEO4J_VERSION}-windows.zip`
    : `neo4j-community-${NEO4J_VERSION}-unix.tar.gz`
  const os = normalizedPlatform === 'win32' ? 'windows' : normalizedPlatform === 'darwin' ? 'mac' : 'linux'
  const arch = normalizedArchitecture === 'arm64' ? 'aarch64' : 'x64'
  const javaVersion = encodeURIComponent(`${JRE_RELEASE}-LTS`)
  return {
    platform: normalizedPlatform,
    architecture: normalizedArchitecture,
    neo4jArchive: archive,
    neo4jUrl: `https://dist.neo4j.org/${archive}`,
    neo4jChecksumUrl: `https://dist.neo4j.org/${archive}.sha256`,
    javaMetadataUrl: `https://api.adoptium.net/v3/assets/version/${javaVersion}?architecture=${arch}&heap_size=normal&image_type=jre&jvm_impl=hotspot&os=${os}`,
  }
}

/** Build the version/platform manifest that an unpacked release bundle must include.
 * @param platform - Node platform identifier.
 * @param architecture - Node architecture identifier.
 * @returns the pinned runtime manifest required by the installed files.
 */
export function neo4jRuntimeManifest(platform: string, architecture: string): Neo4jRuntimeManifest {
  const asset = neo4jPlatformAsset(platform, architecture)
  return {
    schema_id: 'anima.local-runtime/v1',
    platform: asset.platform,
    architecture: asset.architecture,
    neo4j_version: NEO4J_VERSION,
    java_release: JRE_RELEASE,
  }
}
