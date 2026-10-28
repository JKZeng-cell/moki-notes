# Third-party notices / 第三方许可

The MIT license in this repository covers MOKI Notes project code. Third-party dependencies retain their own licenses. / 本仓库 MIT 许可适用于 MOKI便签项目代码，第三方依赖保留各自许可。

- **Inter** and **Noto Sans SC** fonts: SIL Open Font License 1.1. License copies and exact source revisions are in `public/fonts/Inter-OFL.txt`, `public/fonts/NotoSansSC-OFL.txt`, and `public/fonts/SOURCES.json`.
- **Feishu/Lark CLI**: downloaded only when preparing a Windows package. The pinned release, source URL, checksum, and license retrieval are recorded in `scripts/prepare-feishu-cli.mjs`. Its MIT license is included beside the downloaded executable; the CLI binary and credentials are excluded from this source repository.
- **Electron, React, Tiptap, Fastify, KaTeX, Lucide, and other packages**: see `package-lock.json` and each installed package's license. Keep applicable notices when redistributing builds.

The built-in demo SVGs and app icon are included with the project. Screenshots were captured from the real application with only its built-in example notes; they contain no personal note database or authorization credentials.
