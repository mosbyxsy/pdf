/* 无需重新构建即可调整文件选择界面。
 * files: [{ id, name, url, action?: "open", nameL10nId?: "..." }]
 * defaultFileId: 启动时自动打开的文件 ID；null 表示停留在文件选择界面。
 * ?config=path/to/config.json 加载的 JSON 文件使用相同结构。
 */
window.PDF_VIEWER_CONFIG = {
  files: [
    {
      id: "sample-text",
      name: "Text and search sample (2 pages)",
      nameL10nId: "pdfjs-file-chooser-sample-text",
      url: "./sample-text.pdf",
    },
    {
      id: "sample-graphics",
      name: "Vector graphics sample (1 page)",
      nameL10nId: "pdfjs-file-chooser-sample-graphics",
      url: "./sample-graphics.pdf",
    },
    {
      id: "sample-tracemonkey",
      name: "TraceMonkey paper sample (14 pages)",
      nameL10nId: "pdfjs-file-chooser-sample-tracemonkey",
      url: "./compressed.tracemonkey-pldi-09.pdf",
    },
  ],
  defaultFileId: null,
};
