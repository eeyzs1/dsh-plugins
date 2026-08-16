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

## 为什么 DSH 自带插件能开机加载，而我们写的不行

两条完全不同的机制：

**DSH 自带的插件**（tool-bash、tool-cordis、UI 组件等）是「真实包」：

1. 源码在 DSH 安装目录 `packages/...` 里，是 TypeScript；
2. 启动前被编译成 `lib/index.js`（`tsc` + `tsdown`）；
3. 写进 composition（`cordis.yml` 里一行 `name: '@deepseek-ai/dsh-tool-bash'`）；
4. 启动时 Loader 从 `node_modules` 解析包名 → 读 `lib/index.js` → 调 `apply(ctx)`。

**我们写的动态插件**（attach-files）是「裸 JS 函数体」：

1. `cordis_define` 把它存进内存里的一个 `Map`（`DynamicCordisRegistry`）；
2. `cordis_run` 在 node:vm 沙箱（host）/ 浏览器闭包（client）里现场求值；
3. 全程不落盘，所以重启即失。

**缺口在哪里**：不是权限、不是被禁止。真正缺的是一个「用户级、能扛住升级」的放包位置——
Loader 只会从 `node_modules` 解析包名，不会扫 `~/.dsh/`；用户预设也只能引用已有包名，不能携带代码。
而且动态插件被**刻意设计成"临时探针"**：`cordis` 预设开头就写明 `cordis_mount` 等同 shell 权限，
持久化一段开机自动执行的任意代码是安全/信任边界问题。

所以「彻底持久化」才会变成「fork DSH 部署 + 会被升级覆盖」——那是在借用本该属于 DSH 开发者自己的发货机制。
