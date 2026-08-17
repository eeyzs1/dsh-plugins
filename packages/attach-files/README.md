# @eeyzs1/dsh-attach-files — 添加文件/目录到对话（真实包，开机自启）

`attach-files` 从动态插件转换为**真实包**，可通过 `dsh plugin` 安装到 profile，**开机自启、升级不覆盖**。

## 能力

在 DSH 输入框工具行加「📁 添加文件」按钮，弹出文件/目录选择器：

- **添加路径**（默认）：插入 `@file:<路径> (大小)` / `@dir:<路径>` 轻量引用，不展开内容。
- **展开内容**：把选中文件的内容直接展开进草稿（单文件 100KB 截断；目录仍走 `@dir:`）。

## 与动态插件版的区别

| | 动态版 | 本真实包 |
|---|---|---|
| Client→Host RPC | `harness.handle`（动态专属） | `ctx.connection.rpc.handle('/attach', …)`（真实机制） |
| Client→Host 调用 | `host.call` | `ctx.connection.rpc.call('/attach', …)` |
| CSS | `styles` 闭包 | `document` 注入 `<style>`（随 fiber 清理） |
| 开机自启 | 否 | **是**（`dsh.bundle`） |

## 安装

```sh
pnpm dsh plugin --profile web add "G:\dsh-plugins\packages\attach-files"
```

装好后 `pnpm dsh web` 自动加载。源码改动经 `link:` 即时生效（改完只需重启 web）。

## Host RPC 端点

`/attach` 连接 RPC 通道：

- `root { sessionId }` → `{ root: string }`（会话 cwd；兜底 workspaceRoot）
- `list { path }` → `{ ok, path?, dirs[], files[] }`
- `read { paths: string[] }` → `{ ok: true, files: [{ path, content|null, truncated, note? }] }`

## 依赖

- **Host**：`connection` 服务（`dsh-web-app` 已挂）；`fs`；`sessions` / `sessionPersistence`（按会话查 cwd）；`sandboxPolicy`（workspaceRoot 兜底）
- **Client**：`slots`、`connection` 服务；`conversation.input.left` 槽位
