# Upstream and packaging notes

This bundle packages the CLI, PDFium WebAssembly, Windows XLSX sidecar, and Windows OCR helper from the signed GenOffice v0.11.0 Windows x64 release. It omits the desktop shell and does not start a GenOffice window.

The AsterHub adapter launches the bundled CLI in Node mode using the AsterHub Electron runtime. It exposes only local office tools, with seamless workspace file operations. Search, image generation, media analysis, GUI launch, and app installation tools are not exposed.

Upstream: <https://github.com/genspark-ai/genoffice/tree/v0.11.0>

The upstream CLI source is unmodified. The tool adapter in `index.mjs` is AsterHub code. The upstream GenOffice and Genspark names are trademarks; this package is an integration bundle and is not the upstream desktop application.
