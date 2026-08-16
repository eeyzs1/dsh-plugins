# 一键重载（DSH 动态插件）

`plugins/attach-files` 是 DSH 的**动态 Cordis 插件**。动态插件是「当前进程内的临时扩展」，
**DSH 重启后不会自动加载**（这是它的设计，不是 bug）。

重启后按下面步骤恢复，几秒即可。用户只需说一句「**加载 attach-files 插件**」，
agent 照下面做即可。

## 给 agent 的精确步骤

1. 读 `plugins/attach-files/manifest.json`，取三个字段：`idPrefix`、`name`、`purpose`。
2. 读 `plugins/attach-files/host.js` 与 `plugins/attach-files/client.js` 的**完整内容**。
3. 用 Cordis 工具链定义并运行：
   - `cordis_define`：
     - `plugin` = `{ "kind": "new", "idPrefix": "<manifest.idPrefix>" }`
     - `name` = manifest 的 `name`
     - `purpose` = manifest 的 `purpose`
     - `code.host` = `host.js` 整段内容（原样，含开头的 `return {`）
     - `code.client` = `client.js` 整段内容
   - 用返回的 `pluginId` + `packageId` 调 `cordis_run`，`mode` = `"run"`。
4. 若返回 `awaiting-approval`，让用户在 UI 卡片上点「允许」；返回 `starting` 即异步激活，等系统报成功即可。

## 加载完成后

输入框左下工具行会出现 **「📁 添加文件」** 按钮：

| 按钮 | 效果 |
|------|------|
| **添加路径**（默认） | 插入 `@file:<路径> (大小)` / `@dir:<路径>` 轻量引用，不展开内容 |
| **展开内容** | 把选中文件的内容展开进草稿（单文件 100KB 截断；目录仍走 `@dir:`） |

发送后，agent 看到 `@file:` / `@dir:` 引用会自行用 read / glob 读取对应文件内容。

## 为什么不是「永久加载」

DSH 目前没有「用户级插件目录」：用户预设只能引用部署 monorepo 里已有的包名，
不能携带你自己的代码。真正持久化需要 fork DSH 部署源码（建包 + 改 tsconfig + 整仓重编译），
且下次 DSH 升级会被覆盖。因此「源码持久化 + 一键重载」是零侵入、升级安全的最优解。
