# attach-files — 添加文件/目录到对话

在 DSH 输入框工具行加一个「📁 添加文件」按钮，弹出文件/目录选择器。两种插入方式：

- **添加路径**（默认）：插入 `@file:<路径> (大小)` / `@dir:<路径>` 轻量引用，不展开内容。
- **展开内容**：把选中文件的内容直接展开进草稿（目录仍以 `@dir:` 引用）。

内容由 LLM 在看到 `@file:` / `@dir:` 引用时用 read / glob 等工具读取（即「背后上传」）。

## 功能

- 浏览目录、上级导航、手动输入绝对路径跳转
- 勾选文件或整个目录
- 「添加路径」：轻量引用，带文件大小
- 「展开内容」：手动展开选中文件内容（单文件 100KB 截断）
- 追加到已有草稿，不会覆盖正在输入的内容

## 引用约定

- 文件 → `@file:G:\...\foo.py (8.4 KB)`
- 目录 → `@dir:G:\...\bar\`
- LLM 看到这些前缀引用后，用 read / glob 等工具读取对应内容。

## 依赖（运行时自动具备）

- **Host**：`fs` 服务；`sessions` / `sessionPersistence`（按会话 id 查工作区）
- **Client**：`conversation.input.left` 槽位；`inputActions.setDraft` 写草稿
- RPC：`attachfs/root`、`attachfs/list`、`attachfs/read`

## 说明

- 点击「添加路径」/「展开内容」后进入输入框，**再按发送**才真正进入对话。
- 已在运行中改动源码后，需 `cordis_define` 追加新 Package 并 `cordis_run --update`。
