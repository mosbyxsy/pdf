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
        nameL10nId:
          typeof item.nameL10nId === "string" ? item.nameL10nId : "",
        url,
        action: item.action === "open" ? "open" : "",
      });
    }
  }
  return normalized;
}

async function localizeFiles(files, l10n) {
  await Promise.all(
    files.map(async file => {
      if (file.nameL10nId) {
        file.name = (await l10n.get(file.nameL10nId)) || file.name;
      }
    })
  );
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

async function readRemoteConfig(path, l10n) {
  let url;
  try {
    url = new URL(path, window.location.href);
  } catch {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-invalid-url"));
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-http-url"));
  }
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-fetch-error"));
  }
  if (!response.ok) {
    throw new Error(
      await l10n.get("pdfjs-file-chooser-config-http-error", {
        status: response.status,
      })
    );
  }
  let config;
  try {
    config = await response.json();
  } catch {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-invalid-json"));
  }
  if (!config || Array.isArray(config) || !Array.isArray(config.files)) {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-files-required"));
  }
  if (
    Object.hasOwn(config, "defaultFileId") &&
    config.defaultFileId !== null &&
    typeof config.defaultFileId !== "string" &&
    typeof config.defaultFileId !== "number"
  ) {
    throw new Error(await l10n.get("pdfjs-file-chooser-config-invalid-default"));
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
  let messageRevision = 0;
  let noPresetText = "";

  async function setMessage(id, args = null, error = false) {
    const revision = ++messageRevision;
    message.classList.toggle("is-error", error);
    message.textContent = "";
    if (!id) {
      return;
    }
    const value = await app.l10n.get(id, args);
    if (revision === messageRevision) {
      message.textContent = value || "";
    }
  }

  async function errorReason(error) {
    return (
      error?.message ||
      (await app.l10n.get("pdfjs-file-chooser-unknown-error"))
    );
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
      app.l10n
        .get("pdfjs-file-chooser-url-update-error")
        .then(message => console.warn(message, error));
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
    if (file) {
      presetValue.removeAttribute("data-l10n-id");
    } else {
      presetValue.setAttribute("data-l10n-id", "pdfjs-file-chooser-no-preset");
    }
    presetValue.textContent = file?.name || noPresetText;
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
    setMessage("pdfjs-file-chooser-opening", { name: label });
    try {
      await app.open(args);
      updateFileUrl(args.url);
      hideChooser();
    } catch (error) {
      showChooser();
      setMessage(
        "pdfjs-file-chooser-open-error",
        { name: label, reason: await errorReason(error) },
        true
      );
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
      setMessage("pdfjs-file-chooser-select-pdf", null, true);
      return;
    }
    setBusy(true);
    setMessage("pdfjs-file-chooser-reading", { name: file.name });
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      await app.open({ data, filename: file.name });
      app.setTitle(file.name);
      updateFileUrl();
      hideChooser();
    } catch (error) {
      setMessage(
        "pdfjs-file-chooser-open-error",
        { name: file.name, reason: await errorReason(error) },
        true
      );
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
      setMessage("pdfjs-file-chooser-url-required", null, true);
      return;
    }
    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      showChooser();
      setMessage("pdfjs-file-chooser-invalid-url", null, true);
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      showChooser();
      setMessage("pdfjs-file-chooser-url-http-only", null, true);
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
      noPresetText = await app.l10n.get("pdfjs-file-chooser-no-preset");
      const query = initialQuery;
      const localConfig = window.PDF_VIEWER_CONFIG || {};
      files = normalizeFiles(localConfig.files);
      await localizeFiles(files, app.l10n);
      populateFiles();
      let defaultFileId = localConfig.defaultFileId;

      if (query.has("config")) {
        const configPath = query.get("config")?.trim();
        if (!configPath) {
          throw new Error(
            await app.l10n.get("pdfjs-file-chooser-config-url-required")
          );
        }
        setMessage("pdfjs-file-chooser-loading-config");
        const remoteConfig = await readRemoteConfig(configPath, app.l10n);
        const remoteFiles = normalizeFiles(remoteConfig.files);
        await localizeFiles(remoteFiles, app.l10n);
        files = mergeFiles(remoteFiles, files);
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
          setMessage("pdfjs-file-chooser-select-file");
        }
      }
    } catch (error) {
      showChooser();
      setMessage(
        "pdfjs-file-chooser-startup-error",
        { reason: await errorReason(error) },
        true
      );
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
