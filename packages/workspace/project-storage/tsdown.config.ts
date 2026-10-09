import { defineConfig } from 'tsdown'

/** Emit every runtime file named by the package's public exports. */
export default defineConfig(({ env }) => env?.DSH_BUILD_FACE === 'client' ? [] : [{
  entry: ['lib/types/{index,manifest,registry,git-exclusion,attachments,persistence}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}])
