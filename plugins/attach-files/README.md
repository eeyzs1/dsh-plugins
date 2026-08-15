# attach-files — 添加文件/目录到对话

在 DSH 输入框工具行加一个「📁 添加文件」按钮，弹出文件/目录选择器，
把所选文件/目录以 `@file:<路径>` / `@dir:<路径>` 引用插入**对话草稿**（追加，不覆盖），
不把文件内容塞进输入框——内容由 LLM 在看到引用时读取（即「背后上传」）。

## 功能

- 浏览目录、上级导航、手动输入绝对路径跳转
- 勾选文件或整个目录
- 插入轻量路径引用（`@file:` / `@dir:`），不展开内容
- 追加到已有草稿，不会覆盖正在输入的内容

## 引用约定

- 文件 → `@file:G:\...\foo.py`
- 目录 → `@dir:G:\...\bar\`
- LLM 看到这些前缀引用后，用 read / glob 等工具读取对应内容。

## 依赖（运行时自动具备）

- **Host**：`fs` 服务；`sessions` / `sessionPersistence`（按会话 id 查工作区）
- **Client**：`conversation.input.left` 槽位；`inputActions.setDraft` 写草稿
- RPC：`attachfs/root`、`attachfs/list`

## 说明

- 点击「添加路径」后引用进入输入框，**再按发送**才真正进入对话。
- 已在运行中改动源码后，需 `cordis_define` 追加新 Package 并 `cordis_run --update`。
