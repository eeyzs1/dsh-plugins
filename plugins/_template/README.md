# 插件模板

复制整个 `_template` 目录为 `plugins/<你的插件id>/`（kebab-case，如 `attach-files`），
然后改三样：

1. `manifest.json`：`idPrefix`（3–6 个小写字母）、`name`、`purpose`、`version`；
2. `host.js` / `client.js`：填真实逻辑（保留函数体约定，`return { apply(ctx) { … } }`）；
3. 本 README：写清楚功能 / 依赖 / 用法。

改完跑 `node scripts/check.js` 校验并刷新索引，再提交。

> 校验会跳过 `_` 开头或 `.` 开头的目录，所以模板本身不会被当作插件收录。
