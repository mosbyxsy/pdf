/* Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function normalizeFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  const normalized = [];
  for (const item of files) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = item.id == null ? "" : String(item.id).trim();
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (id && name && url) {
      normalized.push({
        id,
        name,
        url,
        action: item.action === "open" ? "open" : "",
      });
    }
  }
  return normalized;
}

function mergeFiles(remoteFiles, localFiles) {
  const files = [];
  const ids = new Set();
  for (const file of [...remoteFiles, ...localFiles]) {
    if (!ids.has(file.id)) {
      ids.add(file.id);
      files.push(file);
    }
  }
  return files;
}

async function readRemoteConfig(path) {
  const url = new URL(path, window.location.href);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("config 参数必须指向 HTTP(S) JSON 文件。");
  }
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new Error("无法读取 config JSON，请检查地址和服务器的 CORS 设置。");
  }
  if (!response.ok) {
    throw new Error(`无法读取文件配置（HTTP ${response.status}）。`);
  }
  let config;
  try {
    config = await response.json();
  } catch {
    throw new Error("config 文件不是有效的 JSON。");
  }
  if (!config || Array.isArray(config) || !Array.isArray(config.files)) {
    throw new Error('config JSON 应包含 { "files": [] }。');
  }
  if (
    Object.hasOwn(config, "defaultFileId") &&
    config.defaultFileId !== null &&
    typeof config.defaultFileId !== "string" &&
    typeof config.defaultFileId !== "number"
  ) {
    throw new Error("defaultFileId 必须是字符串、数字或 null。");
  }
  return config;
}

function getDefaultFile(files, defaultFileId) {
  const id = defaultFileId == null ? "" : String(defaultFileId).trim();
  return (
    (id && files.find(file => file.id === id)) ||
    files.find(file => file.action === "open") ||
    null
  );
}

function initializeFileChooser(app, runPromise) {
  const root = document.getElementById("fileChooser");
  if (!root) {
    return;
  }

  const startup = document.getElementById("fileChooserStartup");
  const outerContainer = document.getElementById("outerContainer");
  const openButton = document.getElementById("secondaryChooseFile");
  const closeButton = document.getElementById("fileChooserClose");
  const message = document.getElementById("fileChooserMessage");
  const dropZone = document.getElementById("fileChooserDropZone");
  const browseButton = document.getElementById("fileChooserBrowse");
  const fileInput = document.getElementById("fileChooserInput");
  const preset = document.getElementById("fileChooserPreset");
  const presetContainer = preset.parentElement;
  const presetValue = document.getElementById("fileChooserPresetValue");
  const presetList = document.getElementById("fileChooserPresetList");
  const openPresetButton = document.getElementById("fileChooserOpenPreset");
  const urlInput = document.getElementById("fileChooserUrl");
  const openUrlButton = document.getElementById("fileChooserOpenUrl");
  let files = [];
  let selectedFileId = "";
  let busy = false;

  function setMessage(value, error = false) {
    message.textContent = value;
    message.classList.toggle("is-error", error);
  }

  function updateFileUrl(url = null) {
    try {
      const viewerUrl = new URL(window.location.href);
      if (
        !url &&
        !viewerUrl.searchParams.has("file") &&
        !viewerUrl.searchParams.has("pdf")
      ) {
        return;
      }
      viewerUrl.searchParams.delete("pdf");
      if (url) {
        viewerUrl.searchParams.set("file", url);
      } else {
        viewerUrl.searchParams.delete("file");
      }
      window.history.replaceState(window.history.state, "", viewerUrl);
    } catch (error) {
      console.warn("无法更新当前文件地址：", error);
    }
  }

  function setBusy(value) {
    busy = value;
    if (value) {
      closePresetMenu();
    }
    root.setAttribute("aria-busy", String(value));
    browseButton.disabled = value;
    preset.disabled = value || files.length === 0;
    openPresetButton.disabled = value || !selectedFileId;
    openUrlButton.disabled = value;
    urlInput.disabled = value;
    closeButton.disabled = value;
  }

  function showChooser() {
    app.secondaryToolbar?.close();
    closeButton.hidden = !app.pdfDocument;
    root.hidden = false;
    startup?.remove();
    outerContainer.inert = true;
    setMessage("");
    if (!busy) {
      browseButton.focus();
    }
  }

  function hideChooser() {
    closePresetMenu();
    root.hidden = true;
    startup?.remove();
    outerContainer.inert = false;
    app.appConfig?.appContainer?.focus?.();
  }

  function populateFiles() {
    closePresetMenu();
    presetList.replaceChildren();
    for (const [index, file] of files.entries()) {
      const option = document.createElement("div");
      option.id = `fileChooserPresetOption${index}`;
      option.className = "fileChooserPresetOption";
      option.role = "option";
      option.tabIndex = -1;
      option.dataset.fileId = file.id;
      option.textContent = file.name;
      presetList.append(option);
    }
    selectPreset(files[0]?.id || "");
    setBusy(busy);
  }

  function selectPreset(id) {
    const file = files.find(item => item.id === id);
    selectedFileId = file?.id || "";
    presetValue.textContent = file?.name || "暂无预置文件";
    for (const option of presetList.children) {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.fileId === selectedFileId)
      );
    }
    openPresetButton.disabled = busy || !selectedFileId;
  }

  function closePresetMenu(restoreFocus = false) {
    presetList.hidden = true;
    preset.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      preset.focus();
    }
  }

  function openPresetMenu() {
    if (busy || !files.length) {
      return;
    }
    presetList.hidden = false;
    preset.setAttribute("aria-expanded", "true");
    const selected = [...presetList.children].find(
      option => option.dataset.fileId === selectedFileId
    );
    (selected || presetList.firstElementChild)?.focus();
  }

  async function openPdf(args, label) {
    if (busy) {
      return;
    }
    startup?.remove();
    setBusy(true);
    setMessage(`正在打开“${label}”…`);
    try {
      await app.open(args);
      updateFileUrl(args.url);
      hideChooser();
    } catch (error) {
      showChooser();
      setMessage(`无法打开“${label}”：${error.message || "未知错误"}`, true);
      closeButton.hidden = !app.pdfDocument;
    } finally {
      setBusy(false);
      if (!root.hidden) {
        browseButton.focus();
      }
    }
  }

  async function openLocalFile(file) {
    if (!file || busy) {
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setMessage("请选择 PDF 文件。", true);
      return;
    }
    setBusy(true);
    setMessage(`正在读取“${file.name}”…`);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      await app.open({ data, filename: file.name });
      app.setTitle(file.name);
      updateFileUrl();
      hideChooser();
    } catch (error) {
      setMessage(`无法打开“${file.name}”：${error.message || "未知错误"}`, true);
      closeButton.hidden = !app.pdfDocument;
    } finally {
      fileInput.value = "";
      setBusy(false);
    }
  }

  function openUrl(value, label = value) {
    const raw = value.trim();
    if (!raw) {
      showChooser();
      setMessage("请输入 PDF URL 或选择预置文件。", true);
      return;
    }
    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      showChooser();
      setMessage("PDF URL 无效。", true);
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      showChooser();
      setMessage("PDF URL 必须使用 HTTP(S)。", true);
      return;
    }
    return openPdf({ url: url.href }, label);
  }

  openButton?.addEventListener("click", showChooser);
  closeButton.addEventListener("click", hideChooser);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (!presetList.hidden) {
        closePresetMenu(true);
      } else if (!closeButton.hidden && !busy) {
        hideChooser();
      }
    }
  });
  browseButton.addEventListener("click", event => {
    event.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("click", event => {
    if (event.target !== fileInput && !busy) {
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => openLocalFile(fileInput.files?.[0]));
  for (const name of ["dragenter", "dragover"]) {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  }
  dropZone.addEventListener("drop", event => {
    openLocalFile(event.dataTransfer?.files?.[0]);
  });
  root.addEventListener("dragover", event => event.preventDefault());
  root.addEventListener("drop", event => event.preventDefault());
  preset.addEventListener("click", () => {
    if (presetList.hidden) {
      openPresetMenu();
    } else {
      closePresetMenu(true);
    }
  });
  preset.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openPresetMenu();
      if (event.key === "ArrowUp") {
        presetList.lastElementChild?.focus();
      }
    }
  });
  presetList.addEventListener("click", event => {
    const option = event.target.closest('[role="option"]');
    if (option && presetList.contains(option)) {
      selectPreset(option.dataset.fileId);
      closePresetMenu(true);
    }
  });
  presetList.addEventListener("keydown", event => {
    const options = [...presetList.children];
    const index = options.indexOf(document.activeElement);
    let nextIndex;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(index + 1, options.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(index - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = options.length - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectPreset(document.activeElement.dataset.fileId);
        closePresetMenu(true);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closePresetMenu(true);
        return;
      case "Tab":
        event.preventDefault();
        closePresetMenu();
        (event.shiftKey ? preset : openPresetButton).focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    options[nextIndex]?.focus();
  });
  document.addEventListener("pointerdown", event => {
    if (!presetContainer.contains(event.target)) {
      closePresetMenu();
    }
  });
  openPresetButton.addEventListener("click", () => {
    const file = files.find(item => item.id === selectedFileId);
    if (file) {
      openUrl(file.url, file.name);
    }
  });
  openUrlButton.addEventListener("click", () => openUrl(urlInput.value));
  urlInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      openUrl(urlInput.value);
    }
  });

  setBusy(true);
  const initialQuery = new URLSearchParams(window.location.search);
  (async () => {
    try {
      await runPromise;
      app.eventBus.on("fileinputchange", () => updateFileUrl());
      const query = initialQuery;
      const localConfig = window.PDF_VIEWER_CONFIG || {};
      files = normalizeFiles(localConfig.files);
      populateFiles();
      let defaultFileId = localConfig.defaultFileId;

      if (query.has("config")) {
        const configPath = query.get("config")?.trim();
        if (!configPath) {
          throw new Error("config 参数不能为空。");
        }
        setMessage("正在读取文件配置…");
        const remoteConfig = await readRemoteConfig(configPath);
        files = mergeFiles(normalizeFiles(remoteConfig.files), files);
        if (Object.hasOwn(remoteConfig, "defaultFileId")) {
          defaultFileId = remoteConfig.defaultFileId;
        }
      }
      populateFiles();
      setBusy(false);

      const requestedFile = query.get("file");
      if (requestedFile) {
        await openUrl(requestedFile);
      } else {
        const defaultFile = getDefaultFile(files, defaultFileId);
        if (defaultFile) {
          selectPreset(defaultFile.id);
          await openUrl(defaultFile.url, defaultFile.name);
        } else {
          showChooser();
          setMessage("请选择一个 PDF 文件。");
        }
      }
    } catch (error) {
      showChooser();
      setMessage(`文件配置或默认文件加载失败：${error.message || "未知错误"}`, true);
      closeButton.hidden = !app.pdfDocument;
    } finally {
      setBusy(false);
      if (!root.hidden) {
        browseButton.focus();
      }
    }
  })();
}

export { initializeFileChooser };
