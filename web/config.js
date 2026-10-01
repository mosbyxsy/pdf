/* 无需重新构建即可调整文件选择界面。
 * files: [{ id, name, url, action?: "open" }]
 * defaultFileId: 启动时自动打开的文件 ID；null 表示停留在文件选择界面。
 * ?config=path/to/config.json 加载的 JSON 文件使用相同结构。
 */
window.PDF_VIEWER_CONFIG = {
  files: [
    { id: "sample-text", name: "文字与搜索示例（2 页）", url: "./sample-text.pdf" },
    {
      id: "sample-graphics",
      name: "矢量图形示例（1 页）",
      url: "./sample-graphics.pdf",
    },
    {
      id: "sample-tracemonkey",
      name: "TraceMonkey 论文示例（14 页）",
      url: "./compressed.tracemonkey-pldi-09.pdf",
    },
  ],
  defaultFileId: null,
};
