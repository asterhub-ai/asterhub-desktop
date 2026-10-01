# AsterHub

English | [中文](README.zh.md)

AsterHub is a desktop AI workbench for everyday work, built on a plugin-based Cordis runtime.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Product and desktop development notes: [Desktop handover](docs/交接文档.md) · [Desktop developer guide](apps/desktop/README.md)

## Developer preview

AsterHub is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from source

To build and launch the AsterHub desktop app from a repository checkout:

```sh
pnpm install
pnpm run dev:desktop
```

The separate `dev:web` command starts a development Web host for renderer work; it is not the customer-facing product entry point.

## Community and support

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
