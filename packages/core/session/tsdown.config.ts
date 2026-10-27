import { defineConfig } from 'tsdown'

/** Build the package root, execution-directory service, and invariant companion as independent bundles. */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/cwd.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
