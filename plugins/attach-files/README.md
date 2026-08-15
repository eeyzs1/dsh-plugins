# attach-files — 添加文件/目录到对话

在 DSH 输入框工具行加一个「📁 添加文件」按钮，弹出文件/目录选择器，
把所选文件内容（或目录下的文本文件）注入**对话草稿**（追加，不覆盖）。

## 功能

- 浏览目录、上级导航、手动输入绝对路径跳转
- 勾选文件或整个目录
- 目录递归收集文本文件；二进制/不可读文件自动跳过
- 上限：单文件 100KB、总量 400KB、目录 500 项 / 8 层深，超出截断并标注
- 追加到已有草稿，不会覆盖正在输入的内容

## 依赖（运行时自动具备）

- **Host**：`fs` 服务；可选 `sandboxPolicy.workspaceRoot`（选择器起始目录）
- **Client**：`conversation.input.left` 槽位；`inputActions.setDraft` 写草稿
- RPC：`attachfs/root`、`attachfs/list`、`attachfs/gather`

## 说明

- 点击「添加到对话」后内容进入输入框，**再按发送**才真正进入对话（便于预览/删减）。
- 已在运行中改动源码后，需 `cordis_define` 追加新 Package 并 `cordis_run --update`。
