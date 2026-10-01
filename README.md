# PDF.js 通用查看器源码

这是精简后的 PDF.js 源码，仅保留构建通用网页查看器所需的 PDF 解析、渲染、脚本、界面、本地化和运行资源。

## 安装与构建

```bash
npm install
npx gulp generic
npx gulp generic-legacy
```

请依次运行两个构建命令。它们会共用临时文件和本地化中间文件，不应同时运行。

构建结果分别位于 `build/generic/` 和 `build/generic-legacy/`。每个目录都包含 `web/viewer.html`、JavaScript 包、本地化文件、字体、CMap、ICC 配置和 WASM 资源。使用 HTTP 服务提供任一构建目录后，打开其中的 `web/viewer.html`。`build/` 和 `web/locale/` 都是可重新生成的目录。

## 文件选择界面

通用查看器在未配置默认 PDF 时，会停留在全屏文件选择界面。可以选择或拖入本地 PDF、打开预置文件，也可以输入 PDF URL。

在查看器中按 `Ctrl+Alt+O`（macOS 为 `⌘⌥O`）可打开文件选择界面。原有的 `Ctrl+O`（macOS 为 `⌘O`）仍直接选择本地文件。

`web/config.js` 已预置文字、矢量图形和 TraceMonkey 论文三份测试 PDF，且 `defaultFileId` 为 `null`，因此启动后仍先显示文件选择界面。

构建前编辑 `web/config.js`；部署后也可以直接编辑输出目录中的 `web/config.js`，刷新页面即可生效。例如：

```js
window.PDF_VIEWER_CONFIG = {
  files: [
    { id: "manual", name: "使用手册", url: "./manual.pdf" },
    { id: "report", name: "报表", url: "https://example.com/report.pdf" },
  ],
  defaultFileId: "manual",
};
```

`files` 中每项需提供唯一的 `id`、显示名称 `name` 和文件地址 `url`。可以给某项设置 `action: "open"`，作为 `defaultFileId` 未匹配时的后备默认文件。若两者都没有指定有效文件，选择界面会保持显示。

也可以通过 `viewer.html?config=files.json` 加载 JSON 配置。JSON 使用相同的 `files` 和可选的 `defaultFileId` 字段，例如：

```json
{
  "files": [{ "id": "guide", "name": "使用指南", "url": "./guide.pdf" }],
  "defaultFileId": "guide"
}
```

合并时，URL 指定的 JSON 文件列表排在 `config.js` 列表之前；`id` 重复时采用 JSON 中的条目。JSON 显式提供的 `defaultFileId` 会覆盖 `config.js` 的值，包括 `null`。启动打开顺序为：`?file=...` 指定的 PDF、匹配的 `defaultFileId`、列表中第一个 `action: "open"` 文件。跨源 PDF 或 JSON 地址需要文件服务器允许 CORS 访问。

从文件选择界面打开预置文件或 PDF URL 后，查看器会将地址记录到 `?file=...`，刷新页面可重新打开。打开本地文件时会清除已记录的 PDF 地址，因为浏览器不能在刷新后直接读取该文件；原有的 `?config=...` 等参数会保留。

## 许可

原始 PDF.js 项目由 Mozilla 维护：https://github.com/mozilla/pdf.js。许可信息见 [LICENSE](LICENSE) 和 `external/` 下的第三方许可证文件。
