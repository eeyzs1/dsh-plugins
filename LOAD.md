# 加载与持久化（DSH 插件）

本仓库 `plugins/` 下的插件目前是 DSH 的**动态 Cordis 插件**（裸 JS 函数体）。
动态插件是「当前进程内的临时扩展」，**DSH 重启后不会自动加载**（这是它的设计，不是 bug）。

DSH 另有一套**用户级、开机自启、升级不覆盖**的真实包机制（`dsh plugin`），见下文「开机自启（真实包）」。
两者关系：动态插件适合快速原型；真实包适合长期使用。

## 一、动态插件：重启后手动恢复

对 `plugins/` 下每个要加载的插件目录（当前为 `attach-files`、`chime`）：

1. 读 `<id>/manifest.json`，取 `idPrefix`、`name`、`purpose`。
2. 读 `entry.host` / `entry.client` 指向的源码文件**完整内容**（至少其一）。
3. 用 Cordis 工具链定义并运行：
   - `cordis_define`：
     - `plugin` = `{ "kind": "new", "idPrefix": "<manifest.idPrefix>" }`
     - `name` / `purpose` = manifest 对应字段
     - `code.host` = `host.js` 整段内容（原样，含开头 `return {`）
     - `code.client` = `client.js` 整段内容
   - 用返回的 `pluginId` + `packageId` 调 `cordis_run`，`mode` = `"run"`。
4. 若返回 `awaiting-approval`，在 UI 卡片点「允许」；`starting` 即异步激活，等系统报成功。
5. 每个插件各走一遍 define + run。

一句「**加载所有插件**」，agent 照上面做即可。

## 二、开机自启（真实包 + dsh plugin）

DSH **有**官方的用户级插件机制，可以把插件装进用户目录、开机自动加载、升级不覆盖：

```sh
dsh plugin --profile web add <包名或本地路径>
```

它做的事（源码：`apps/cli/src/plugin.ts`、`packages/boot/app-boot/src/profile.ts`）：

1. 在 `$DSH_HOME/profiles/web` 里用 pnpm 安装该包（用户目录，升级不覆盖）；
2. 若包声明 `dsh.bundle`，自动把它编入 `dsh.profile.bundles` 组合层；
3. 启动时组合层按序堆叠：空根 + 各 bundle 的 `cordis.patch.yml` + profile 自己的
   `cordis.patch.yml` + 全局 `$DSH_HOME/cordis.patch.yml` —— 开机自动挂载。

一个真实插件包需要：

- **Host 半**：`package.json` 里 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，
  入口导出 `name` / `inject` / `apply`；
- **GUI 半（可选）**：`package.json` 里 `"dsh": { "client": { "platform": "web", "inject": [...] } }`，
  `exports["./client"]` 指向构建好的 client bundle。

## 三、为什么动态插件不能开机自启，而真实包能

- **动态插件**：`cordis_define` 把源码存进进程内存里的 `DynamicCordisRegistry`，
  `cordis_run` 现场求值；全程不落盘，重启即失。加载它靠的是**模型的工具**
  （`cordis_define` / `cordis_run`），不是 CLI，所以无法用脚本一键加载——这是刻意的信任边界。
- **真实包**：是规范 npm 包，被 `dsh plugin` 装进 profile 的 node_modules，通过 `dsh.bundle`
  的 patch 层在启动时组合挂载，因此开机自启、升级不覆盖。

## 四、当前状态

| 插件 | 形态 | 开机自启 |
|------|------|---------|
| attach-files | 动态插件（已收进本仓库） | 否（待转真实包） |
| chime | 动态插件（已收进本仓库） | 否（待转真实包） |

> 把这两个插件转成真实包（`dsh.bundle` + `dsh.client`）的工作在进行中。
