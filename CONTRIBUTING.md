# Contributing / 参与贡献

Use Node.js 24+. Run `npm ci`, then `npm run check` and `npm run test:mcp` before proposing a change. Open an issue with reproduction steps, expected behavior, actual behavior, platform, and version. Keep screenshots free of personal notes and credentials.

请使用 Node.js 24+。运行 `npm ci`，提交前执行 `npm run check` 与 `npm run test:mcp`。问题反馈请包含复现步骤、预期与实际行为、系统和版本；截图不要包含私人便签或凭据。

Use an isolated `MOKI_NOTES_DATA` path for development or experiments. Desktop experiments can also set `MOKI_NOTES_PROFILE` and an unused `MOKI_NOTES_PORT`. Never commit databases, attachments from personal notes, local drafts, Feishu authorization data, `.env` files, build outputs, or installers.

开发或实验使用独立 `MOKI_NOTES_DATA` 路径；桌面隔离还可设置 `MOKI_NOTES_PROFILE` 和空闲的 `MOKI_NOTES_PORT`。不要提交数据库、私人附件、草稿、飞书授权数据、环境文件、构建产物或安装包。

Contributions are provided under this project's MIT license. / 贡献代码采用本项目 MIT 许可。
