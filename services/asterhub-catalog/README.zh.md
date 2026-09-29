# AsterHub 目录与发布元数据服务

[English](README.md) | 中文

这是一个只读 HTTP 服务，用于提供签名精选目录、Desktop 更新 feed 文件以及更新策略元数据。它是部署脚手架，尚未连接 Cloudflare、德国主机或生产 DNS。新 Desktop 构建已把 feed 和无强制更新策略检查指向 `asterhub.xapi.fans`，但该 origin 尚未发布目录或平台 feed 文件。样例目录为空且附带已签名的 starter；通用 latest-release JSON 没有版本和下载地址。

## 公共契约

操作员配置 DNS 和主机现有 TLS 代理后，预期 HTTPS origin 为 `https://asterhub.xapi.fans`。所有路由接受 `GET` 和 `HEAD`；`OPTIONS` 支持浏览器预检。其他方法返回 405。服务没有写入 API、上传接口、shell、数据库、凭据或模型代理功能。

| 路由 | 响应 |
|---|---|
| `/healthz` | `{"status":"ok"}` 就绪探针 |
| `/api/v1/catalog.json` | `{ "payload": "<base64(raw UTF-8 JSON bytes)>", "signature": "<base64(Ed25519 signature)>" }`；解码 payload 为 `{ "schemaVersion": 1, "revision": 1, "issuedAt": "...", "expiresAt": "...", "plugins": [...] }` |
| `/api/v1/desktop/latest.json` | `{ "schemaVersion": 1, "product": "AsterHub", "version": "...", "channel": "stable", "notesUrl": "...", "platforms": { ... } }`；当前未配置 |
| `/api/v0/check_client_update` | 现有 Desktop 强制更新契约，固定返回安全的无强制更新响应 `{"code":0,"data":{"biz_code":0,"biz_data":null}}` |
| `/dsh-desk/feeds/<target>/<file>` | 只读 electron-updater feed 文件，映射到 `data/dsh-desk/feeds/<target>/<file>`；由操作员提供 `nightly.yml` 或 `nightly-mac.yml` 等平台元数据 |
| `/releases/<relative-file>` | 从独立的 `data/releases/` 目录只读返回托管安装包 |

目录和更新元数据是 `data/` 下的静态文件。服务本身不会签名，也不包含私钥。`data/catalog.sig` 保存对 `data/catalog.json` 原始字节的 Ed25519 签名；可选运行时变量 `CATALOG_SIGNATURE_BASE64` 优先覆盖该文件。签名缺失或格式错误时，目录 API 返回 503。Host 使用发行版单独固定的公钥验签，再校验 payload schema。每次修改 payload 都必须重新签名，不能让旧签名复用于新字节。签名是公开数据，可与对应 payload 一起版本管理。服务不会解析任意文件路径，未知路由返回 404。由于响应为公开数据，允许跨域读取；元数据默认使用短缓存，边缘缓存策略应结合发布频率验证后再调整。

### 离线签名

签名脚本接收外部 Ed25519 PEM 私钥路径与上一发布修订号，校验 payload 后只输出 Base64 签名。它要求 `schemaVersion: 1`、高于上一修订号的安全整数 revision、晚于当前时间的有效 ISO UTC `expiresAt`、`issuedAt` 不晚于签名时间，以及 `plugins` 数组。私钥保存在本仓库与部署主机之外。例如编辑 `data/catalog.json` 后，首次发布执行：

```bash
node sign-catalog.mjs data/catalog.json /secure/offline/catalog-ed25519-private.pem 0
```

将输出保存为 `data/catalog.sig`。后续发布传入刚发布的 revision。对应公钥固定在 Desktop Host 发行版中。签名脚本签署文件原始字节，部署时必须保留准确编码和换行。

## Desktop 更新接入

DSH Desktop 有两条独立更新路径：electron-updater 读取平台专属的 `nightly*.yml` feed 与二进制；强制更新策略请求 `/api/v0/check_client_update`。新 Desktop 构建把 `https://asterhub.xapi.fans` 写入 feed 与策略 origin。当前策略路由只返回无强制更新；强制公告尚未配置，也没有强制发布或 override 功能。已安装客户端继续使用其安装包内嵌的旧 feed URL，需安装新签名构建才会切换。

现有发布器仍把 feed YAML、二进制和 blockmap 上传到腾讯 COS。公开 origin `asterhub.xapi.fans` 必须将 `/dsh-desk/feeds/` 与 `/dsh-desk/bin/` 代理到同一个 production bucket；`nginx.conf.example` 给出了两个只读代理位置。启用前，将其中的 `cos_host` 替换为该 bucket 的公开主机名。feed YAML 中的产物绝对 URL 指向 `https://asterhub.xapi.fans/dsh-desk/bin/`，因此代理必须保留对象键后缀以及正确的 TLS SNI/Host。示例启用了上游证书校验；请按主机系统配置可信 CA bundle 路径。feed 响应不在代理层存储；Cloudflare/CDN 应对 `/dsh-desk/feeds/*` 绕过缓存，并在部署后通过公网 origin 核对响应头。带版本号的二进制与 blockmap 可按不可变内容缓存。COS bucket 只应为所需的 `dsh-desk/feeds/` 和 `dsh-desk/bin/` 对象开放 GET/HEAD 读取。代理会清除调用方的 Authorization、Proxy-Authorization 和 Cookie 请求头，主机不保存 COS 凭据。如果不能接受公开读取，应先单独设计并审查签名下载代理，再启用更新。不要把 COS 写入凭据放在这台主机上。

Node 服务的 `/dsh-desk/feeds/<target>/<file>` 到 `data/dsh-desk/feeds/<target>/<file>` 映射仍可用于本地直接验收。在已部署的 Nginx 虚拟主机中，更具体的 COS 代理位置优先匹配。服务没有上传路由。

仅完成 COS 上传不能作为版本发布验收。必须通过最终 `https://asterhub.xapi.fans` origin 获取每个 feed 和其中引用的全部产物，再将 feed 版本与产物 SHA-512 和签名构建记录比对。大型二进制留在 COS；德国主机提供 API 元数据和公开读取代理，不接收 release 上传。

## 本地运行

```sh
node --test
node server.mjs
```

服务默认监听 `0.0.0.0:8080`，可设置 `PORT` 和 `CATALOG_DATA_DIR`。Docker Compose 将容器端口绑定到 `127.0.0.1:18081`，移除 Linux capabilities，以只读容器运行，并将 `data/` 只读挂载。Nginx 示例虚拟主机描述未来 TLS 代理；证书路径交由主机现有证书管理器配置。

当前已部署目录为修订版 2，包含 GenOffice CLI 与 Aster IM；安装包以不可变 tarball 存放在 `data/releases/`。每次修改目录都必须提高修订号并重新签名。精选目录和安装包路由已在 `https://asterhub.xapi.fans` 生效。独立的 electron-updater feed 尚未配置；发布插件包时不要改动现有 Cloudflare 路由。
