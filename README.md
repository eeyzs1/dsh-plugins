# dsh-plugins

DeepSeek Harness（DSH）**动态 Cordis 插件**集合。

> ⚠️ 动态插件不跨 DSH 重启。重启后如何恢复见 [LOAD.md](LOAD.md)（一句「加载插件」即可）。

## 仓库结构

```
dsh-plugins/
├── plugins/<id>/           # 每个插件一个目录
│   ├── manifest.json       # 元数据（idPrefix / name / purpose / entry / version）
│   ├── host.js             # Host 端源码（函数体 `return { apply(ctx) { … } }`）
│   ├── client.js           # Client 端源码（函数体，同规则）
│   └── README.md           # 该插件说明
├── scripts/check.js        # 校验所有插件 + 生成插件索引
├── manifest.schema.json    # manifest 字段约定（文档）
├── PLUGINS.md              # 自动生成的插件索引（勿手改）
├── LOAD.md                 # 一键重载指南
└── .github/workflows/      # push 时自动跑校验
```

## 加一个插件

> 快捷方式：复制 [plugins/_template/](plugins/_template/) 改名即可（`_` 开头目录会被校验跳过）。

1. 建 `plugins/<id>/` 目录（`<id>` 用 kebab-case，如 `attach-files`）。
2. 写 `manifest.json`，字段约定见 [manifest.schema.json](manifest.schema.json)：
   - `idPrefix`：3–6 个小写字母（`cordis_define` 的 `plugin.idPrefix`）
   - `name` / `purpose`：必填
   - `entry`：`{ "host": "host.js", "client": "client.js" }`（至少一个）
3. 写 `host.js` / `client.js`：存**函数体本身**，直接整段粘到 `code.host` / `code.client`。
4. 跑校验并提交：

```bash
node scripts/check.js     # 或 npm run check / pnpm check
```

## 校验

`node scripts/check.js` 会：

- 校验每个 manifest 的必填字段与 `idPrefix` 格式；
- 按 DSH 的函数体约定**语法检查** `host.js` / `client.js`；
- 重新生成 [PLUGINS.md](PLUGINS.md) 索引。

GitHub Actions 在每次 push / PR 也会自动跑（`.github/workflows/check.yml`），
出错会亮红叉，保证不会把坏插件推上去。

## 加载一个插件

见 [LOAD.md](LOAD.md)。一句话：读 manifest + host.js + client.js → `cordis_define` → `cordis_run`。

## 插件索引

见 [PLUGINS.md](PLUGINS.md)（自动生成，勿手改）。

## License

[MIT](LICENSE)
