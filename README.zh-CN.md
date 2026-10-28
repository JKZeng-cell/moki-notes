# MOKI便签 · MOKI Notes

简体中文 · [English](README.md)

**随手记下灵感，钉到桌面，再把零散想法连成知识。**

MOKI便签是一款本地 Markdown 便签应用，支持桌面卡片、知识关联、附件管理、飞书同步，以及供 Agent 使用的本地 MCP 服务。它独立运行，不依赖 MOKI 工作台或 MOKI 白板。

![真实应用界面：可编辑的内置使用指南](docs/screenshots/overview.png)

## 能做什么

- **记录与排版**：Markdown 实时显示样式，斜杠菜单快速插入，支持标题、任务清单、表格、代码、LaTeX、模块拖拽与多栏排版。
- **桌面固定**：便签变成可移动、缩放、置顶的独立卡片；主窗口收起托盘后继续使用，双击正文即可编辑。
- **知识关联**：父子层级、标签、跨便签链接和可缩放的知识网络。列表分组独立于知识树层级。
- **Agent 协作**：通过本地 stdio MCP 搜索、读取、新建、更新便签；检索结果带来源与版本，更新时检查版本冲突。
- **资料一起保存**：正文可插入图片、网页、音视频、文件和其他便签；附件保存在本地，便签可导出 TXT / MD / DOCX。
- **保留修改过程**：自动保存、本机草稿、版本历史、回收站恢复，以及包含附件的 `.mokinotes` 完整迁移包。
- **飞书同步**：授权并连接云盘后，可上传、拉取、双向同步，也可在应用运行时定时同步。

| 实时 Markdown 排版 | 实际桌面任务卡片 |
| --- | --- |
| ![编辑器](docs/screenshots/markdown.png) | ![桌面便签](docs/screenshots/desktop-card.png) |

![真实知识树：父子层级与跨便签连接](docs/screenshots/knowledge-graph.png)

![连接 Agent：复制提示词或手动添加 MCP](docs/screenshots/agent-connection.png)

以上截图来自真实 Windows 应用与内置使用指南。读书会项目属于虚构演示；飞书截图展示连接入口，不代表已完成同步。

## 获取源码与启动

需要 **Node.js 24+** 和 npm。

```sh
git clone https://github.com/JKZeng-cell/moki-notes.git
cd moki-notes
npm ci
npm run desktop
```

`desktop` 会先构建，再启动 Electron 桌面应用。本次公开发布提供源码，不承诺已签名安装包。Windows 桌面行为已有本地验证；macOS / Linux 的路径已实现，但对应系统上的桌面构建与行为尚未验证。

浏览器运行：

```sh
npm run build
npm start
# http://127.0.0.1:4331
```

开发可运行 `npm run dev`，页面使用 4330 端口，API 使用 4331。浏览器可编辑和管理便签，桌面固定需要 Electron。当前界面与内置指南为简体中文；项目介绍提供中英文。

## 连接 Agent

打开应用左下角 **连接 Agent**，复制连接提示词交给支持本地 stdio MCP 的客户端，或切换“手动添加”，复制命令、参数与环境变量。复制提示词本身不会建立连接。

源码构建后的通用配置示例：

```json
{
  "mcpServers": {
    "moki-notes": {
      "command": "node",
      "args": ["/absolute/path/to/moki-notes/dist/mcp/server.js"],
      "env": { "MOKI_NOTES_DATA": "/absolute/path/to/moki-notes.db" }
    }
  }
}
```

使用应用生成的本机参数，并合并进已有 MCP 配置。先调用 `notes_list` 只读验证；修改前 `notes_read`，传入 `expectedVersion`，写后读回。`notes_context` 使用本地关键词检索；知识树展示显式关联，不是向量数据库或自动语义推断。

远程记录需要另行配置可远程使用的 Agent，并让它连接便签所在电脑；写入时电脑需运行且可连接。应用默认不提供公网远程写入服务。

## 数据、同步与导出

- 数据与附件默认保存在本机；数据库和草稿是本地明文文件，不是端到端加密存储。
- 默认数据库：Windows `%APPDATA%/moki-notes/moki-notes.db`；macOS `~/Library/Application Support/moki-notes/moki-notes.db`；Linux `$XDG_DATA_HOME/moki-notes/moki-notes.db`，无该变量时使用 `~/.local/share/moki-notes/moki-notes.db`。
- `MOKI_NOTES_DATA` 可指定数据库，`MOKI_NOTES_PROFILE` 可指定隔离桌面配置。桌面 HTTP 服务默认只监听本机 4332 端口，独立 Web 服务默认 4331。
- 完整迁移使用 **设置 → 数据与存储 → 导出全部数据**。普通 Markdown 导出保留资源链接，不打包附件二进制；MOKI 分栏及表格样式扩展在其他阅读器中可能不同。
- “允许 Agent 检索”控制检索范围，不是访问权限边界；已配置的本地 MCP 客户端可按 ID 读取便签，包括归档与回收站。
- 飞书同步需要自己的授权与配置；删除不会同步传播，双端冲突保留副本。飞书原生文档与非 Markdown 文件仅支持拉取；完全退出应用后停止定时同步。
- Windows 打包时下载官方固定版本飞书 CLI 并校验哈希，源码库不保存该可执行文件。其他系统的同步需要兼容的本机 `lark-cli`。

![飞书同步：配置与连接界面](docs/screenshots/feishu-sync.png)

## 开发与构建

```sh
npm run typecheck
npm test
npm run build
npm run test:mcp
```

`npm run check` 组合类型检查、测试与构建。MCP 冒烟测试使用独立临时数据库。Windows 下 `npm run package:installer` 生成本地 NSIS 安装器；打包不等于发布，也不会自动签名或公证。

主要目录：`src/web`（界面）、`src/server`（本机 API / 存储）、`src/desktop`（窗口）、`src/mcp`（Agent 协议）、`src/shared`（共享模型）。参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，字体和外部工具许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证与联系

项目源码采用 [MIT License](LICENSE)；第三方组件保留各自许可证。开发者：**MOKI / JKZeng** · [jkzeng@moge.tv](mailto:jkzeng@moge.tv)。欢迎通过 [Issues](https://github.com/JKZeng-cell/moki-notes/issues) 提交反馈与可复现的问题。
