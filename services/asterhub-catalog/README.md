# AsterHub catalog and release metadata service

English | [中文](README.zh.md)

This small read-only HTTP service serves signed catalog metadata, the existing Desktop updater feed format, and update-policy metadata. It is a deployment scaffold; it is not connected to Cloudflare, the German host, or production DNS. New Desktop packages now point their feed and safe no-force policy check at `asterhub.xapi.fans`, but no catalog or platform feed files have been published to that origin. The sample catalog is intentionally empty and has a checked-in signature; the generic latest-release JSON has no version or download URL.

## Public contract

The intended HTTPS origin is `https://asterhub.xapi.fans` after an operator configures DNS and the existing host TLS proxy. All routes accept `GET` and `HEAD`; `OPTIONS` supports browser preflight. Other methods return 405. The service has no write API, upload endpoint, shell, database, credentials, or model-proxy function.

| Route | Response |
|---|---|
| `/healthz` | `{"status":"ok"}` readiness probe |
| `/api/v1/catalog.json` | `{ "payload": "<base64(raw UTF-8 JSON bytes)>", "signature": "<base64(Ed25519 signature)>" }`; the decoded payload is `{ "schemaVersion": 1, "revision": 1, "issuedAt": "...", "expiresAt": "...", "plugins": [...] }` |
| `/api/v1/desktop/latest.json` | `{ "schemaVersion": 1, "product": "AsterHub", "version": "...", "channel": "stable", "notesUrl": "...", "platforms": { ... } }`; currently unconfigured |
| `/api/v0/check_client_update` | Existing Desktop mandatory-update contract, fixed safe no-force response `{"code":0,"data":{"biz_code":0,"biz_data":null}}` |
| `/dsh-desk/feeds/<target>/<file>` | Read-only electron-updater feed files mapped to `data/dsh-desk/feeds/<target>/<file>`; operator supplies exact platform metadata such as `nightly.yml` or `nightly-mac.yml` |
| `/releases/<relative-file>` | Read-only bytes from the data directory for optional hosted release payloads |

Catalog entries and update metadata are static JSON committed in `data/`. The service signs no data itself and contains no private key. `data/catalog.sig` carries the Ed25519 signature for the exact raw bytes in `data/catalog.json`; an optional runtime `CATALOG_SIGNATURE_BASE64` overrides it. If neither is available or the value is malformed, the catalog endpoint returns 503. The Host verifies those exact payload bytes using its separately release-pinned public key, then validates the payload schema. Any payload edit requires generating a new signature; never reuse a signature for changed bytes. The signature is public data and may be versioned with the matching payload. The service does not resolve arbitrary files from the filesystem, and unknown paths return 404. Cross-origin reads are allowed because these responses are public. Responses currently use a short cache lifetime suitable for metadata; tune edge cache behavior only after validating clients and publication cadence.

### Offline catalog signing

The signing command accepts an externally supplied Ed25519 private-key PEM path and the prior published revision, validates the payload, and prints only the base64 signature. It requires `schemaVersion: 1`, a safe integer revision greater than the supplied prior revision, an ISO UTC `issuedAt` no later than signing time, an ISO UTC `expiresAt` later than both `issuedAt` and signing time, and a plugins array. Keep the private key outside this repository and deployment host. For the initial revision, edit `data/catalog.json` and run:

```bash
node sign-catalog.mjs data/catalog.json /secure/offline/catalog-ed25519-private.pem 0
```

Save the output as `data/catalog.sig` beside the exact payload. For each later publication, pass the revision most recently published. The matching public key is pinned into the Desktop Host build. The signer reads and signs the exact bytes, so preserve file encoding and newline bytes through deployment.

## Desktop updater integration

DSH Desktop has two separate update paths: electron-updater consumes platform-specific `nightly*.yml` feeds and binaries; mandatory policy polls `/api/v0/check_client_update`. New production Desktop builds package `https://asterhub.xapi.fans` as the feed and policy origin. The mandatory-policy route implements only the existing fixed no-force response; force announcements are unconfigured, and no forced-release or override feature exists. Existing installed clients keep their old packaged feed URL until replaced by a new signed build. The generic `/api/v1/desktop/latest.json` is informational and is not consumed by electron-updater.

The release uploader still writes feed YAML, binaries, and blockmaps to Tencent COS. The public `asterhub.xapi.fans` origin must proxy `/dsh-desk/feeds/` and `/dsh-desk/bin/` to the same production bucket; `nginx.conf.example` shows the two read-only locations. Replace its `cos_host` with the bucket's public hostname before enabling them. The feed YAML contains absolute artifact URLs under `https://asterhub.xapi.fans/dsh-desk/bin/`, so the proxy must preserve the object-key suffix and TLS SNI/Host. The example enables upstream certificate verification; configure the trusted CA bundle path for the host OS. Feed responses are never stored by this proxy. Configure Cloudflare/CDN to bypass cache for `/dsh-desk/feeds/*` and verify public response headers after deployment. Versioned binaries and blockmaps may be cached as immutable. The COS bucket must allow GET/HEAD reads only for the required `dsh-desk/feeds/` and `dsh-desk/bin/` keys. The proxy strips caller Authorization, Proxy-Authorization, and Cookie headers and has no COS credentials. If public reads are not acceptable, implement a separately reviewed signed-download proxy before enabling the updater. No COS write credential belongs on this host.

The Node service's `/dsh-desk/feeds/<target>/<file>` mapping to `data/dsh-desk/feeds/<target>/<file>` remains useful for direct local qualification. In the deployed Nginx virtual host, the more specific COS proxy locations take precedence. The service has no upload route.

Never qualify a release after COS upload alone. Fetch each feed and every artifact URL through the final `https://asterhub.xapi.fans` origin, then compare the feed version and artifact SHA-512 values with the signed build record. Large binaries remain in COS; the German host serves API metadata and proxies public reads, not release uploads.

## Run locally

```sh
node --test
node server.mjs
```

The server listens on `0.0.0.0:8080` by default. Set `PORT` and `CATALOG_DATA_DIR` to override. Docker Compose binds the container to `127.0.0.1:18081`, drops Linux capabilities, runs read-only and mounts `data/` read-only. The example Nginx virtual host documents a future TLS proxy; it deliberately leaves certificate paths to the host's existing certificate manager.

The checked-in catalogue sample is deliberately empty and signed, so the catalog route serves the empty list. Any payload edit requires a new signature in `data/catalog.sig`.

Before a real deployment, an operator must inspect existing Cloudflare records and Nginx routing, choose the DNS/tunnel route without replacing existing records, configure TLS, select a release/object-store origin, and qualify backup and update publication. No deployment or DNS action is performed by this scaffold.
