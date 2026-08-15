# dsh-plugins

DeepSeek Harness（DSH）**动态 Cordis 插件**集合。每个插件一个目录，结构固定：

```
plugins/<id>/
├── manifest.json   # 元数据：idPrefix / 名称 / 用途 / 入口文件
├── host.js         # Host 端源码（函数体，`return { apply(ctx) { … } }`）
├── client.js       # Client 端源码（函数体，同规则）
└── README.md       # 该插件的说明
```

## 如何加载一个插件

在 DSH Web GUI 中用 Cordis 工具链按 manifest 定义并运行：

| manifest 字段 / 文件 | 对应 `cordis_define` 参数 |
|----------------------|---------------------------|
| `idPrefix`           | `plugin.idPrefix`         |
| `name`               | `name`                    |
| `purpose`            | `purpose`                 |
| `host.js` 整段内容    | `code.host`               |
| `client.js` 整段内容  | `code.client`             |

> `host.js` / `client.js` 里存的是**函数体本身**（不含外层 `function`），
> 直接整段粘到 `code.host` / `code.client` 即可，不需要再包一层。

## 插件列表

| 目录 | 说明 |
|------|------|
| [`plugins/attach-files`](plugins/attach-files/README.md) | 输入框加「📁 添加文件」按钮，选择文件/目录并把内容注入对话草稿 |
