# Upstream and packaging notes

This bundle packages the CLI, PDFium WebAssembly, Windows XLSX sidecar, and Windows OCR helper from the signed GenOffice v0.11.0 Windows x64 release. It omits the desktop shell and does not start a GenOffice window.

The AsterHub adapter launches the bundled CLI in Node mode using the AsterHub Electron runtime. It exposes only local office tools, with seamless workspace file operations. Search, image generation, media analysis, GUI launch, and app installation tools are not exposed.
Candidate source version `0.11.0-asterhub.2` uses dependencies at the repository's available `0.2.0-rc.3` versions, but requires the current SessionCwd source contract; matching version strings alone do not imply compatibility with an older rc.3 build. It injects `sessionCwd` as a required service, so a runtime that does not provide it fails plugin loading rather than falling back to the historical Session cwd. `dshReleases` intentionally makes no claim that an already-built release is compatible. The frozen `0.11.0-asterhub.1` TGZ and catalog signature remain unchanged.
For Session calls, the adapter resolves the current project execution directory through ProjectStorage rather than the immutable historical Session cwd, then launches the MCP child under the host sandbox policy with that current directory as the workspace-write boundary. An operator-supplied `GENOFFICE_ALLOWED_ROOTS` value is preserved unchanged and is otherwise left unset; profile-directory discovery is separate and is never used as a live Session fallback.

Upstream: <https://github.com/genspark-ai/genoffice/tree/v0.11.0>

The upstream CLI source is unmodified. The tool adapter in `index.mjs` is AsterHub code. The upstream GenOffice and Genspark names are trademarks; this package is an integration bundle and is not the upstream desktop application.
