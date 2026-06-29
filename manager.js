(function () {
  "use strict";

  const ENCRYPTION_PASS = "r2fm-" + chrome.runtime.id;

  let client = null;
  let currentPrefix = "";
  let allFolders = [];
  let allFiles = [];
  let selectedKeys = new Set();
  let sortField = "name";
  let sortAsc = true;
  let logCount = 0;
  let customDomain = "";
  let currentServerId = null;
  let batchRenameRules = [];

  ServerManager.init(ENCRYPTION_PASS);

  // ── Toast ──

  function toast(msg, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 300); }, 3000);
  }

  // ── Log ──

  function log(msg, type = "") {
    const body = document.getElementById("log-body");
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    entry.innerHTML = `<span class="time">[${time}]</span>${escapeHtml(msg)}`;
    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;
    logCount++;
    document.getElementById("log-count").textContent = `(${logCount})`;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Formatting ──

  function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
  }

  function formatDate(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function getFileName(key) {
    const parts = key.replace(/\/$/, "").split("/");
    return parts[parts.length - 1];
  }

  function getFileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    const icons = {
      jpg: "\u{1F5BC}", jpeg: "\u{1F5BC}", png: "\u{1F5BC}", gif: "\u{1F5BC}", webp: "\u{1F5BC}", svg: "\u{1F5BC}", bmp: "\u{1F5BC}",
      mp4: "\u{1F3AC}", webm: "\u{1F3AC}", mkv: "\u{1F3AC}", avi: "\u{1F3AC}", mov: "\u{1F3AC}",
      mp3: "\u{1F3B5}", wav: "\u{1F3B5}", ogg: "\u{1F3B5}", flac: "\u{1F3B5}",
      pdf: "\u{1F4D5}",
      zip: "\u{1F4E6}", rar: "\u{1F4E6}", "7z": "\u{1F4E6}", tar: "\u{1F4E6}", gz: "\u{1F4E6}",
      json: "\u{1F4CB}", xml: "\u{1F4CB}", csv: "\u{1F4CB}",
      js: "\u{1F4C4}", ts: "\u{1F4C4}", py: "\u{1F4C4}", html: "\u{1F4C4}", css: "\u{1F4C4}",
      txt: "\u{1F4C3}", md: "\u{1F4C3}", log: "\u{1F4C3}",
    };
    return icons[ext] || "\u{1F4C4}";
  }

  function isPreviewable(name) {
    const ext = name.split(".").pop().toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp",
      "mp4", "webm", "mov",
      "txt", "md", "json", "xml", "csv", "js", "ts", "py", "html", "css", "log", "yaml", "yml", "toml", "ini", "cfg", "srt", "vtt"
    ].includes(ext);
  }

  function isImage(name) { return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(name); }
  function isVideo(name) { return /\.(mp4|webm|mov)$/i.test(name); }
  function isText(name) { return /\.(txt|md|json|xml|csv|js|ts|py|html|css|log|yaml|yml|toml|ini|cfg|srt|vtt|bat|sh|ps1|rb|go|rs|java|c|cpp|h)$/i.test(name); }

  // ── Page Switching ──

  function showSetup() {
    document.getElementById("setup-page").style.display = "flex";
    document.getElementById("main-app").style.display = "none";
    renderServerList();
  }

  function showApp() {
    document.getElementById("setup-page").style.display = "none";
    document.getElementById("main-app").style.display = "flex";
  }

  // ══════════════════════════════════════════════
  // ── SERVER MANAGER UI ──
  // ══════════════════════════════════════════════

  async function renderServerList() {
    const servers = await ServerManager.loadServers();
    const listEl = document.getElementById("server-list");
    const formEl = document.getElementById("server-form");
    const listSection = document.getElementById("server-list-section");

    if (servers.length === 0) {
      listSection.style.display = "none";
      formEl.style.display = "block";
      document.getElementById("btn-back-to-list").style.display = "none";
      document.getElementById("server-form-title").textContent = "Add Your First Server";
      setupFormForProtocol("r2");
      return;
    }

    listSection.style.display = "block";
    formEl.style.display = "none";

    listEl.innerHTML = servers.map(s => {
      const info = ServerManager.getProtocolInfo(s.protocol);
      return `<div class="server-item" data-id="${s.id}">
        <div class="server-item-icon" style="background:${info.iconColor}">${info.icon}</div>
        <div class="server-item-info">
          <div class="server-item-name">${escapeHtml(s.name || "Unnamed")}</div>
          <div class="server-item-detail">${escapeHtml(info.name)} ${s.bucket ? "• " + escapeHtml(s.bucket) : ""} ${s.host ? "• " + escapeHtml(s.host) : ""}</div>
        </div>
        <div class="server-item-actions">
          <button class="btn btn-sm btn-primary server-connect-btn" data-id="${s.id}">Connect</button>
          <button class="btn btn-sm server-edit-btn" data-id="${s.id}">Edit</button>
          <button class="btn btn-sm btn-danger-text server-delete-btn" data-id="${s.id}">&times;</button>
        </div>
      </div>`;
    }).join("");
  }

  document.getElementById("server-list").addEventListener("click", async (e) => {
    const connectBtn = e.target.closest(".server-connect-btn");
    if (connectBtn) {
      await connectToServer(connectBtn.dataset.id);
      return;
    }

    const editBtn = e.target.closest(".server-edit-btn");
    if (editBtn) {
      await editServer(editBtn.dataset.id);
      return;
    }

    const deleteBtn = e.target.closest(".server-delete-btn");
    if (deleteBtn) {
      if (confirm("Delete this server?")) {
        await ServerManager.deleteServer(deleteBtn.dataset.id);
        renderServerList();
        await updateServerSwitcher();
      }
      return;
    }
  });

  document.getElementById("btn-add-server").addEventListener("click", () => {
    currentEditServerId = null;
    document.getElementById("server-list-section").style.display = "none";
    document.getElementById("server-form").style.display = "block";
    document.getElementById("btn-back-to-list").style.display = "inline-flex";
    document.getElementById("server-form-title").textContent = "New Server";
    document.getElementById("setup-server-name").value = "";
    document.getElementById("setup-protocol").value = "r2";
    document.getElementById("setup-save").disabled = true;
    document.getElementById("setup-error").style.display = "none";
    document.getElementById("setup-success").style.display = "none";
    setupFormForProtocol("r2");
  });

  document.getElementById("btn-back-to-list").addEventListener("click", () => {
    document.getElementById("server-form").style.display = "none";
    document.getElementById("server-list-section").style.display = "block";
  });

  let currentEditServerId = null;

  async function editServer(id) {
    const server = await ServerManager.getServer(id);
    if (!server) return;

    currentEditServerId = id;
    document.getElementById("server-list-section").style.display = "none";
    document.getElementById("server-form").style.display = "block";
    document.getElementById("btn-back-to-list").style.display = "inline-flex";
    document.getElementById("server-form-title").textContent = "Edit Server";
    document.getElementById("setup-server-name").value = server.name || "";
    document.getElementById("setup-protocol").value = server.protocol || "r2";
    document.getElementById("setup-save").disabled = false;
    document.getElementById("setup-error").style.display = "none";
    document.getElementById("setup-success").style.display = "none";

    setupFormForProtocol(server.protocol, server);
  }

  document.getElementById("setup-protocol").addEventListener("change", (e) => {
    setupFormForProtocol(e.target.value);
  });

  function setupFormForProtocol(protocol, existingData = null) {
    const info = ServerManager.getProtocolInfo(protocol);
    const fields = ServerManager.getFieldConfig();
    const container = document.getElementById("setup-dynamic-fields");

    const corsHelp = document.getElementById("cors-help");
    corsHelp.style.display = info.category === "s3" ? "block" : "none";

    container.innerHTML = info.fields.map(fieldName => {
      const f = fields[fieldName];
      if (!f) return "";
      const val = existingData ? (existingData[fieldName] || "") : "";

      if (f.type === "checkbox") {
        return `<div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="setup-field-${fieldName}" ${val ? "checked" : ""}>
            ${f.label}
          </label>
        </div>`;
      }

      return `<div class="form-group">
        <label>${f.label}${f.required ? " *" : ""}</label>
        <input type="${f.type}" id="setup-field-${fieldName}" placeholder="${f.placeholder || ""}" value="${escapeHtml(String(val))}" autocomplete="off">
        ${f.hint ? `<div class="hint">${f.hint}</div>` : ""}
      </div>`;
    }).join("");
  }

  function getSetupFormValues() {
    const protocol = document.getElementById("setup-protocol").value;
    const name = document.getElementById("setup-server-name").value.trim();
    const info = ServerManager.getProtocolInfo(protocol);
    const fields = ServerManager.getFieldConfig();

    const config = { protocol, name: name || `${info.name} Server` };

    for (const fieldName of info.fields) {
      const f = fields[fieldName];
      if (!f) continue;
      const el = document.getElementById(`setup-field-${fieldName}`);
      if (!el) continue;

      if (f.type === "checkbox") {
        config[fieldName] = el.checked;
      } else if (f.type === "number") {
        config[fieldName] = parseInt(el.value) || 0;
      } else {
        config[fieldName] = el.value.trim();
      }

      if (f.required && !config[fieldName]) {
        toast(`${f.label} is required`, "error");
        return null;
      }
    }

    if (protocol === "ftps") config.secure = true;

    return config;
  }

  // ── Test & Save ──

  document.getElementById("setup-test").addEventListener("click", async () => {
    const config = getSetupFormValues();
    if (!config) return;

    const btn = document.getElementById("setup-test");
    const errEl = document.getElementById("setup-error");
    const sucEl = document.getElementById("setup-success");
    errEl.style.display = "none";
    sucEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Testing...";

    try {
      const testClient = createStorageClient(config);
      await testClient.testConnection();
      sucEl.textContent = "Connection successful!";
      sucEl.style.display = "block";
      document.getElementById("setup-save").disabled = false;
    } catch (e) {
      errEl.textContent = `Connection failed: ${e.message}`;
      if (e.status === 403) errEl.textContent += "\nCheck your credentials.";
      if (e.message.includes("Failed to fetch")) errEl.textContent += "\nCheck CORS configuration or network.";
      errEl.style.display = "block";
      document.getElementById("setup-save").disabled = true;
    }
    btn.disabled = false;
    btn.textContent = "Test Connection";
  });

  document.getElementById("setup-save").addEventListener("click", async () => {
    const config = getSetupFormValues();
    if (!config) return;

    if (currentEditServerId) {
      await ServerManager.updateServer(currentEditServerId, config);
      await connectToServer(currentEditServerId);
    } else {
      const server = await ServerManager.addServer(config);
      await connectToServer(server.id);
    }
  });

  // ── Connect to Server ──

  async function connectToServer(id) {
    const server = await ServerManager.getServer(id);
    if (!server) { toast("Server not found", "error"); return; }

    try {
      client = createStorageClient(server);
      currentServerId = id;
      customDomain = server.customDomain || "";
      await ServerManager.setActiveServer(id);

      const info = ServerManager.getProtocolInfo(server.protocol);
      document.getElementById("header-icon").textContent = info.icon;
      document.getElementById("header-icon").style.background = info.iconColor;
      document.getElementById("header-protocol").textContent = info.name;
      document.getElementById("header-title").textContent = server.bucket || server.host || server.name || info.name;

      await updateServerSwitcher();

      showApp();
      log(`Connected to ${server.name || info.name}${server.bucket ? " (" + server.bucket + ")" : ""}`, "success");
      loadFolder("");
    } catch (e) {
      toast("Connection failed: " + e.message, "error");
      log("Connection failed: " + e.message, "error");
    }
  }

  async function updateServerSwitcher() {
    const servers = await ServerManager.loadServers();
    const select = document.getElementById("active-server-select");

    select.innerHTML = servers.map(s => {
      const info = ServerManager.getProtocolInfo(s.protocol);
      const selected = s.id === currentServerId ? "selected" : "";
      return `<option value="${s.id}" ${selected}>${escapeHtml(s.name || info.name)}</option>`;
    }).join("");

    select.style.display = servers.length > 1 ? "block" : "none";
  }

  document.getElementById("active-server-select").addEventListener("change", async (e) => {
    await connectToServer(e.target.value);
  });

  // ══════════════════════════════════════════════
  // ── FOLDER NAVIGATION ──
  // ══════════════════════════════════════════════

  async function loadFolder(prefix) {
    currentPrefix = prefix;
    selectedKeys.clear();
    updateBreadcrumb();
    updateSelectionBtns();
    document.getElementById("check-all").checked = false;

    const tbody = document.getElementById("file-tbody");
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px"><div class="loading-spinner"></div> Loading...</td></tr>`;
    document.getElementById("empty-state").style.display = "none";

    try {
      let folders = [];
      let files = [];
      let token = null;

      do {
        const result = await client.listObjects(prefix, "/", token);
        folders = folders.concat(result.folders);
        files = files.concat(result.files);
        token = result.isTruncated ? result.nextToken : null;
      } while (token);

      allFolders = folders;
      allFiles = files;
      renderFileTable();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--destructive)">Error: ${escapeHtml(e.message)}</td></tr>`;
      log("Error loading folder: " + e.message, "error");
    }
  }

  function renderFileTable() {
    const tbody = document.getElementById("file-tbody");
    const filter = document.getElementById("search-box").value.toLowerCase();

    let folders = allFolders.map(f => ({
      key: f, name: getFileName(f), isFolder: true, size: -1, lastModified: "",
    }));

    let files = allFiles.map(f => ({
      key: f.key, name: getFileName(f.key), isFolder: false, size: f.size, lastModified: f.lastModified,
    }));

    if (filter) {
      folders = folders.filter(f => f.name.toLowerCase().includes(filter));
      files = files.filter(f => f.name.toLowerCase().includes(filter));
    }

    files.sort((a, b) => {
      let va, vb;
      if (sortField === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (sortField === "size") { va = a.size; vb = b.size; }
      else { va = a.lastModified; vb = b.lastModified; }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    const items = [...folders, ...files];

    if (items.length === 0) {
      tbody.innerHTML = "";
      document.getElementById("empty-state").style.display = "block";
      return;
    }

    document.getElementById("empty-state").style.display = "none";

    tbody.innerHTML = items.map(item => {
      const checked = selectedKeys.has(item.key) ? "checked" : "";
      const selectedClass = selectedKeys.has(item.key) ? "selected" : "";

      if (item.isFolder) {
        return `<tr class="${selectedClass}" data-key="${escapeHtml(item.key)}" data-folder="1">
          <td class="col-check"><input type="checkbox" class="row-check" data-key="${escapeHtml(item.key)}" ${checked}></td>
          <td class="col-name"><span class="file-icon">\u{1F4C1}</span><span class="file-name folder" data-key="${escapeHtml(item.key)}">${escapeHtml(item.name)}</span></td>
          <td class="col-size file-size">—</td>
          <td class="col-modified file-date">—</td>
          <td class="col-actions">
            <button class="action-btn copy-link-btn" title="Copy Link" data-action="copy" data-key="${escapeHtml(item.key)}">&#128279; Copy Link</button>
            <button class="action-btn danger" title="Delete" data-action="delete" data-key="${escapeHtml(item.key)}">\u{1F5D1}</button>
          </td>
        </tr>`;
      }

      return `<tr class="${selectedClass}" data-key="${escapeHtml(item.key)}">
        <td class="col-check"><input type="checkbox" class="row-check" data-key="${escapeHtml(item.key)}" ${checked}></td>
        <td class="col-name"><span class="file-icon">${getFileIcon(item.name)}</span><span class="file-name" data-key="${escapeHtml(item.key)}">${escapeHtml(item.name)}</span></td>
        <td class="col-size file-size">${formatSize(item.size)}</td>
        <td class="col-modified file-date">${formatDate(item.lastModified)}</td>
        <td class="col-actions">
          <button class="action-btn" title="Download" data-action="download" data-key="${escapeHtml(item.key)}">\u{2B07}</button>
          <button class="action-btn copy-link-btn" title="Copy Link" data-action="copy" data-key="${escapeHtml(item.key)}">&#128279; Copy Link</button>
          <button class="action-btn danger" title="Delete" data-action="delete" data-key="${escapeHtml(item.key)}">\u{1F5D1}</button>
        </td>
      </tr>`;
    }).join("");
  }

  // ── Breadcrumb ──

  function updateBreadcrumb() {
    const bc = document.getElementById("breadcrumb");
    const parts = currentPrefix.split("/").filter(Boolean);

    let html = `<span class="breadcrumb-segment" data-prefix="">/</span>`;
    let cumulative = "";
    for (const part of parts) {
      cumulative += part + "/";
      html += `<span class="breadcrumb-sep">/</span><span class="breadcrumb-segment" data-prefix="${escapeHtml(cumulative)}">${escapeHtml(part)}</span>`;
    }
    bc.innerHTML = html;
  }

  // ── Event Delegation ──

  document.getElementById("breadcrumb").addEventListener("click", (e) => {
    const seg = e.target.closest(".breadcrumb-segment");
    if (seg) loadFolder(seg.dataset.prefix);
  });

  document.getElementById("btn-up").addEventListener("click", () => {
    if (!currentPrefix) return;
    const parts = currentPrefix.replace(/\/$/, "").split("/");
    parts.pop();
    loadFolder(parts.length > 0 ? parts.join("/") + "/" : "");
  });

  document.getElementById("btn-refresh").addEventListener("click", () => loadFolder(currentPrefix));

  // File table events
  document.getElementById("file-tbody").addEventListener("click", (e) => {
    const folderName = e.target.closest(".file-name.folder");
    if (folderName) {
      loadFolder(folderName.dataset.key);
      return;
    }

    const fileName = e.target.closest(".file-name:not(.folder)");
    if (fileName) {
      const key = fileName.dataset.key;
      if (isPreviewable(getFileName(key))) previewFile(key);
      return;
    }

    const actionBtn = e.target.closest(".action-btn");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      const key = actionBtn.dataset.key;
      if (action === "download") downloadFile(key);
      else if (action === "copy") copyUrl(key, actionBtn);
      else if (action === "delete") confirmDelete([key]);
      return;
    }
  });

  // Checkboxes
  document.getElementById("file-tbody").addEventListener("change", (e) => {
    if (e.target.classList.contains("row-check")) {
      const key = e.target.dataset.key;
      if (e.target.checked) selectedKeys.add(key);
      else selectedKeys.delete(key);
      updateSelectionBtns();
      e.target.closest("tr").classList.toggle("selected", e.target.checked);
    }
  });

  document.getElementById("check-all").addEventListener("change", (e) => {
    const checks = document.querySelectorAll(".row-check");
    checks.forEach(c => {
      c.checked = e.target.checked;
      const key = c.dataset.key;
      if (e.target.checked) selectedKeys.add(key);
      else selectedKeys.delete(key);
      c.closest("tr").classList.toggle("selected", e.target.checked);
    });
    updateSelectionBtns();
  });

  function updateSelectionBtns() {
    const btn = document.getElementById("btn-delete-selected");
    const copyBtn = document.getElementById("btn-copy-links");
    const dlBtn = document.getElementById("btn-download-selected");
    btn.disabled = selectedKeys.size === 0;
    copyBtn.disabled = selectedKeys.size === 0;
    dlBtn.disabled = selectedKeys.size === 0;
    btn.innerHTML = selectedKeys.size > 0
      ? `\u{1F5D1} Delete (${selectedKeys.size})`
      : `\u{1F5D1} Delete Selected`;
    copyBtn.innerHTML = selectedKeys.size > 0
      ? `&#128279; Copy Links (${selectedKeys.size})`
      : `&#128279; Copy Links`;
    dlBtn.innerHTML = selectedKeys.size > 0
      ? `&#11015; Download (${selectedKeys.size})`
      : `&#11015; Download`;
  }

  // Sort headers
  document.querySelectorAll(".file-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (sortField === field) sortAsc = !sortAsc;
      else { sortField = field; sortAsc = true; }
      document.querySelectorAll(".file-table th").forEach(t => t.classList.remove("sorted", "asc"));
      th.classList.add("sorted");
      if (sortAsc) th.classList.add("asc");
      renderFileTable();
    });
  });

  // Search
  document.getElementById("search-box").addEventListener("input", () => renderFileTable());

  // ── Rename (double-click) ──

  document.getElementById("file-tbody").addEventListener("dblclick", (e) => {
    const nameEl = e.target.closest(".file-name");
    if (!nameEl || nameEl.classList.contains("folder")) return;

    const key = nameEl.dataset.key;
    const oldName = getFileName(key);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.value = oldName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim();
      if (!newName || newName === oldName) {
        loadFolder(currentPrefix);
        return;
      }
      const prefix = key.substring(0, key.lastIndexOf("/") + 1);
      const newKey = prefix + newName;
      try {
        log(`Renaming ${oldName} → ${newName}...`);
        await client.renameObject(key, newKey);
        log(`Renamed ${oldName} → ${newName}`, "success");
        toast(`Renamed to ${newName}`, "success");
        loadFolder(currentPrefix);
      } catch (e) {
        log(`Rename failed: ${e.message}`, "error");
        toast("Rename failed: " + e.message, "error");
        loadFolder(currentPrefix);
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(); }
      if (ev.key === "Escape") loadFolder(currentPrefix);
    });
    input.addEventListener("blur", finish);
  });

  // ══════════════════════════════════════════════
  // ── UPLOAD ──
  // ══════════════════════════════════════════════

  const fileInput = document.getElementById("file-input");
  const folderInput = document.getElementById("folder-input");

  document.getElementById("btn-upload").addEventListener("click", () => fileInput.click());
  document.getElementById("btn-upload-folder").addEventListener("click", () => folderInput.click());

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      const entries = Array.from(fileInput.files).map(f => ({ file: f, relativePath: f.name }));
      uploadEntries(entries);
    }
    fileInput.value = "";
  });

  folderInput.addEventListener("change", () => {
    if (folderInput.files.length > 0) {
      const entries = Array.from(folderInput.files)
        .filter(f => f.size > 0 || f.name !== ".")
        .map(f => ({ file: f, relativePath: f.webkitRelativePath || f.name }));
      if (entries.length > 0) uploadEntries(entries);
    }
    folderInput.value = "";
  });

  // Drag & Drop
  const dropZone = document.getElementById("drop-zone");
  const dropOverlay = document.getElementById("drop-overlay");
  let dragCounter = 0;

  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    if (client) dropOverlay.classList.add("active");
  });

  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove("active"); }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove("active");
    if (!client) return;

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const entries = [];
    const promises = [];

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) {
        promises.push(traverseEntry(entry, "", entries));
      } else {
        const file = items[i].getAsFile();
        if (file) entries.push({ file, relativePath: file.name });
      }
    }

    await Promise.all(promises);
    if (entries.length > 0) uploadEntries(entries);
  });

  function traverseEntry(entry, basePath, results) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          const path = basePath ? basePath + "/" + file.name : file.name;
          results.push({ file, relativePath: path });
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const dirPath = basePath ? basePath + "/" + entry.name : entry.name;
        const readAll = (allEntries = []) => {
          reader.readEntries((batch) => {
            if (batch.length === 0) {
              Promise.all(allEntries.map(e => traverseEntry(e, dirPath, results))).then(resolve);
            } else {
              readAll(allEntries.concat(Array.from(batch)));
            }
          }, () => resolve());
        };
        readAll();
      } else {
        resolve();
      }
    });
  }

  dropZone.addEventListener("click", () => { if (client) fileInput.click(); });

  async function uploadEntries(entries) {
    const progressEl = document.getElementById("upload-progress");
    progressEl.classList.add("active");
    progressEl.innerHTML = "";

    const maxConcurrent = Math.max(1, Math.min(50, parseInt(document.getElementById("concurrent-count").value) || 20));
    let idx = 0;
    let doneCount = 0;
    let successCount = 0;
    let failCount = 0;
    const totalCount = entries.length;
    const startTime = Date.now();

    log(`Uploading ${totalCount} file(s) with ${maxConcurrent} parallel...`);

    const summaryDiv = document.createElement("div");
    summaryDiv.className = "transfer-summary";
    progressEl.appendChild(summaryDiv);

    const tabsDiv = document.createElement("div");
    tabsDiv.className = "transfer-tabs";
    tabsDiv.innerHTML = `
      <button class="transfer-tab active" data-filter="all">All (${totalCount})</button>
      <button class="transfer-tab" data-filter="pending">Pending (${totalCount})</button>
      <button class="transfer-tab" data-filter="success">Success (0)</button>
      <button class="transfer-tab" data-filter="failed">Failed (0)</button>
    `;
    progressEl.appendChild(tabsDiv);

    let activeFilter = "all";
    tabsDiv.addEventListener("click", (e) => {
      const tab = e.target.closest(".transfer-tab");
      if (!tab) return;
      activeFilter = tab.dataset.filter;
      tabsDiv.querySelectorAll(".transfer-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      applyFilter();
    });

    const retryAllBtn = document.createElement("button");
    retryAllBtn.className = "btn btn-sm transfer-retry-all";
    retryAllBtn.textContent = "Retry All Failed";
    retryAllBtn.style.display = "none";
    progressEl.appendChild(retryAllBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-sm transfer-close";
    closeBtn.textContent = "✕ Close";
    closeBtn.style.display = "none";
    closeBtn.addEventListener("click", () => { progressEl.classList.remove("active"); progressEl.innerHTML = ""; });
    progressEl.appendChild(closeBtn);

    const listDiv = document.createElement("div");
    listDiv.className = "upload-list";
    progressEl.appendChild(listDiv);

    const items = entries.map((entry, i) => {
      const displayName = entry.relativePath;
      const div = document.createElement("div");
      div.className = "upload-item";
      div.dataset.status = "pending";
      div.innerHTML = `
        <span class="name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
        <div class="progress-bar"><div class="progress-bar-fill" id="prog-${i}" style="width:0%"></div></div>
        <span class="pct" id="pct-${i}">0%</span>
        <button class="btn-retry" id="retry-${i}" style="display:none" title="Retry">↻</button>
      `;
      listDiv.appendChild(div);
      return { file: entry.file, relativePath: entry.relativePath, index: i, div, status: "pending" };
    });

    function applyFilter() {
      items.forEach(item => {
        if (activeFilter === "all" || item.status === activeFilter) {
          item.div.style.display = "";
        } else {
          item.div.style.display = "none";
        }
      });
    }

    function updateTabs() {
      const pending = items.filter(i => i.status === "pending").length;
      const success = items.filter(i => i.status === "success").length;
      const failed = items.filter(i => i.status === "failed").length;
      const tabs = tabsDiv.querySelectorAll(".transfer-tab");
      tabs[0].textContent = `All (${totalCount})`;
      tabs[1].textContent = `Pending (${pending})`;
      tabs[2].textContent = `Success (${success})`;
      tabs[3].textContent = `Failed (${failed})`;
      retryAllBtn.style.display = failed > 0 ? "inline-flex" : "none";
    }

    function updateSummary() {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = doneCount > 0 ? (doneCount / elapsed).toFixed(1) : "0";
      const eta = doneCount > 0 ? Math.round(((totalCount - doneCount) / (doneCount / elapsed))) : "—";
      const etaStr = typeof eta === "number" ? `${eta}s left` : eta;
      summaryDiv.innerHTML = `<strong>${doneCount} / ${totalCount}</strong> — ✅ ${successCount} ❌ ${failCount} — ${speed} files/s — ${etaStr}`;
    }

    async function doUpload(item) {
      item.status = "pending";
      item.div.dataset.status = "pending";
      document.getElementById(`prog-${item.index}`).style.width = "0%";
      document.getElementById(`prog-${item.index}`).style.background = "";
      document.getElementById(`pct-${item.index}`).textContent = "0%";
      document.getElementById(`retry-${item.index}`).style.display = "none";

      const key = currentPrefix + item.relativePath;
      try {
        await client.uploadFile(key, item.file, (loaded, total) => {
          const pct = Math.round((loaded / total) * 100);
          document.getElementById(`prog-${item.index}`).style.width = pct + "%";
          document.getElementById(`pct-${item.index}`).textContent = pct + "%";
        });
        document.getElementById(`prog-${item.index}`).style.background = "var(--success)";
        document.getElementById(`pct-${item.index}`).textContent = "✓";
        item.status = "success";
        item.div.dataset.status = "success";
        successCount++;
      } catch (e) {
        document.getElementById(`prog-${item.index}`).style.background = "var(--destructive)";
        document.getElementById(`pct-${item.index}`).textContent = "✗";
        document.getElementById(`retry-${item.index}`).style.display = "inline-flex";
        item.status = "failed";
        item.div.dataset.status = "failed";
        log(`Upload failed: ${item.relativePath} — ${e.message}`, "error");
        failCount++;
      }

      doneCount++;
      updateSummary();
      updateTabs();
      applyFilter();
    }

    // Individual retry buttons
    listDiv.addEventListener("click", async (e) => {
      const retryBtn = e.target.closest(".btn-retry");
      if (!retryBtn) return;
      const idx2 = parseInt(retryBtn.id.replace("retry-", ""));
      const item = items[idx2];
      if (!item || item.status !== "failed") return;
      failCount--;
      doneCount--;
      updateSummary();
      await doUpload(item);
    });

    // Retry all failed
    retryAllBtn.addEventListener("click", async () => {
      const failedItems = items.filter(i => i.status === "failed");
      if (failedItems.length === 0) return;
      retryAllBtn.disabled = true;
      retryAllBtn.textContent = "Retrying...";
      for (const item of failedItems) {
        failCount--;
        doneCount--;
      }
      updateSummary();
      const retryWorkers = [];
      let retryIdx = 0;
      const retryMax = Math.max(1, Math.min(50, parseInt(document.getElementById("concurrent-count").value) || 50));
      async function retryNext() {
        if (retryIdx >= failedItems.length) return;
        const item = failedItems[retryIdx++];
        await doUpload(item);
        await retryNext();
      }
      for (let r = 0; r < Math.min(retryMax, failedItems.length); r++) retryWorkers.push(retryNext());
      await Promise.all(retryWorkers);
      retryAllBtn.disabled = false;
      retryAllBtn.textContent = "Retry All Failed";
    });

    async function uploadNext() {
      if (idx >= items.length) return;
      const item = items[idx++];
      await doUpload(item);
      await uploadNext();
    }

    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrent, totalCount); i++) {
      workers.push(uploadNext());
    }
    await Promise.all(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    summaryDiv.innerHTML = `<strong>Done!</strong> ✅ ${successCount} ❌ ${failCount} / ${totalCount} — ${elapsed}s`;
    closeBtn.style.display = "inline-flex";
    if (failCount === 0) {
      setTimeout(() => { progressEl.classList.remove("active"); progressEl.innerHTML = ""; }, 4000);
    }
    log(`Upload complete: ${successCount}/${totalCount} in ${elapsed}s`, successCount === totalCount ? "success" : "warning");
    toast(`${successCount}/${totalCount} file(s) uploaded in ${elapsed}s`, successCount === totalCount ? "success" : "error");
    loadFolder(currentPrefix);
  }

  // ── Download ──

  async function downloadFile(key) {
    const name = getFileName(key);
    try {
      log(`Downloading ${name}...`);
      const blob = await client.downloadFile(key);
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: name }, () => {
        URL.revokeObjectURL(url);
      });
      log(`Downloaded ${name}`, "success");
    } catch (e) {
      log(`Download failed: ${name} — ${e.message}`, "error");
      toast("Download failed: " + e.message, "error");
    }
  }

  // ── Parallel Download ──

  document.getElementById("btn-download-selected").addEventListener("click", async () => {
    if (selectedKeys.size === 0) return;

    const fileKeys = [];
    const folderKeys = [];
    for (const k of selectedKeys) {
      if (k.endsWith("/")) folderKeys.push(k);
      else fileKeys.push(k);
    }

    if (folderKeys.length > 0) {
      log(`Scanning ${folderKeys.length} folder(s) for download...`);
      for (const prefix of folderKeys) {
        let token = null;
        do {
          const result = await client.listObjects(prefix, "", token);
          for (const f of result.files) fileKeys.push(f.key);
          token = result.isTruncated ? result.nextToken : null;
        } while (token);
      }
      log(`Found ${fileKeys.length} file(s) total`, "success");
    }

    if (fileKeys.length === 0) {
      toast("No files to download", "info");
      return;
    }
    if (fileKeys.length === 1 && folderKeys.length === 0) {
      downloadFile(fileKeys[0]);
      return;
    }
    const basePrefix = folderKeys.length > 0 ? currentPrefix : currentPrefix;
    downloadMultiple(fileKeys, basePrefix);
  });

  function formatBytes(b) {
    if (b === 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i];
  }

  async function downloadMultiple(keys, basePrefix) {
    const progressEl = document.getElementById("download-progress");
    progressEl.classList.add("active");
    progressEl.innerHTML = "";

    const maxConcurrent = Math.max(1, Math.min(50, parseInt(document.getElementById("concurrent-dl-count").value) || 20));
    let idx = 0;
    let doneCount = 0;
    let successCount = 0;
    let failCount = 0;
    let totalBytes = 0;
    const totalCount = keys.length;
    const startTime = Date.now();

    log(`Downloading ${totalCount} file(s) with ${maxConcurrent} parallel...`);

    const summaryDiv = document.createElement("div");
    summaryDiv.className = "transfer-summary";
    progressEl.appendChild(summaryDiv);

    const tabsDiv = document.createElement("div");
    tabsDiv.className = "transfer-tabs";
    tabsDiv.innerHTML = `
      <button class="transfer-tab active" data-filter="all">All (${totalCount})</button>
      <button class="transfer-tab" data-filter="pending">Pending (${totalCount})</button>
      <button class="transfer-tab" data-filter="success">Success (0)</button>
      <button class="transfer-tab" data-filter="failed">Failed (0)</button>
    `;
    progressEl.appendChild(tabsDiv);

    let activeFilter = "all";
    tabsDiv.addEventListener("click", (e) => {
      const tab = e.target.closest(".transfer-tab");
      if (!tab) return;
      activeFilter = tab.dataset.filter;
      tabsDiv.querySelectorAll(".transfer-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      applyFilter();
    });

    const retryAllBtn = document.createElement("button");
    retryAllBtn.className = "btn btn-sm transfer-retry-all";
    retryAllBtn.textContent = "Retry All Failed";
    retryAllBtn.style.display = "none";
    progressEl.appendChild(retryAllBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-sm transfer-close";
    closeBtn.textContent = "✕ Close";
    closeBtn.style.display = "none";
    closeBtn.addEventListener("click", () => { progressEl.classList.remove("active"); progressEl.innerHTML = ""; });
    progressEl.appendChild(closeBtn);

    const listDiv = document.createElement("div");
    listDiv.className = "upload-list";
    progressEl.appendChild(listDiv);

    const items = keys.map((key, i) => {
      const relativePath = key.startsWith(basePrefix) ? key.substring(basePrefix.length) : key;
      const div = document.createElement("div");
      div.className = "upload-item";
      div.dataset.status = "pending";
      div.innerHTML = `
        <span class="name" title="${escapeHtml(relativePath)}">${escapeHtml(relativePath)}</span>
        <div class="progress-bar"><div class="progress-bar-fill" id="dl-prog-${i}" style="width:0%"></div></div>
        <span class="pct" id="dl-pct-${i}">0%</span>
        <button class="btn-retry" id="dl-retry-${i}" style="display:none" title="Retry">↻</button>
      `;
      listDiv.appendChild(div);
      return { key, relativePath, index: i, div, status: "pending" };
    });

    function applyFilter() {
      items.forEach(item => {
        item.div.style.display = (activeFilter === "all" || item.status === activeFilter) ? "" : "none";
      });
    }

    function updateTabs() {
      const pending = items.filter(i => i.status === "pending").length;
      const success = items.filter(i => i.status === "success").length;
      const failed = items.filter(i => i.status === "failed").length;
      const tabs = tabsDiv.querySelectorAll(".transfer-tab");
      tabs[0].textContent = `All (${totalCount})`;
      tabs[1].textContent = `Pending (${pending})`;
      tabs[2].textContent = `Success (${success})`;
      tabs[3].textContent = `Failed (${failed})`;
      retryAllBtn.style.display = failed > 0 ? "inline-flex" : "none";
    }

    function updateSummary() {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? formatBytes(totalBytes / elapsed) + "/s" : "—";
      const eta = doneCount > 0 ? Math.round(((totalCount - doneCount) / (doneCount / elapsed))) : "—";
      const etaStr = typeof eta === "number" ? `${eta}s left` : eta;
      summaryDiv.innerHTML = `<strong>${doneCount} / ${totalCount}</strong> — ✅ ${successCount} ❌ ${failCount} — ${speed} — ${etaStr}`;
    }

    async function doDownload(item) {
      item.status = "pending";
      item.div.dataset.status = "pending";
      document.getElementById(`dl-prog-${item.index}`).style.width = "0%";
      document.getElementById(`dl-prog-${item.index}`).style.background = "";
      document.getElementById(`dl-pct-${item.index}`).textContent = "0%";
      document.getElementById(`dl-retry-${item.index}`).style.display = "none";

      try {
        const blob = await client.downloadFile(item.key, (loaded, total) => {
          if (total > 0) {
            const pct = Math.round((loaded / total) * 100);
            document.getElementById(`dl-prog-${item.index}`).style.width = pct + "%";
            document.getElementById(`dl-pct-${item.index}`).textContent = pct + "%";
          } else {
            document.getElementById(`dl-pct-${item.index}`).textContent = formatBytes(loaded);
          }
        });

        const url = URL.createObjectURL(blob);
        chrome.downloads.download({ url, filename: item.relativePath }, () => {
          URL.revokeObjectURL(url);
        });

        totalBytes += blob.size;
        document.getElementById(`dl-prog-${item.index}`).style.width = "100%";
        document.getElementById(`dl-prog-${item.index}`).style.background = "var(--success)";
        document.getElementById(`dl-pct-${item.index}`).textContent = "✓ " + formatBytes(blob.size);
        item.status = "success";
        item.div.dataset.status = "success";
        successCount++;
      } catch (e) {
        document.getElementById(`dl-prog-${item.index}`).style.width = "100%";
        document.getElementById(`dl-prog-${item.index}`).style.background = "var(--destructive)";
        document.getElementById(`dl-pct-${item.index}`).textContent = "✗";
        document.getElementById(`dl-retry-${item.index}`).style.display = "inline-flex";
        item.status = "failed";
        item.div.dataset.status = "failed";
        log(`Download failed: ${item.relativePath} — ${e.message}`, "error");
        failCount++;
      }

      doneCount++;
      updateSummary();
      updateTabs();
      applyFilter();
    }

    // Individual retry
    listDiv.addEventListener("click", async (e) => {
      const retryBtn = e.target.closest(".btn-retry");
      if (!retryBtn) return;
      const idx2 = parseInt(retryBtn.id.replace("dl-retry-", ""));
      const item = items[idx2];
      if (!item || item.status !== "failed") return;
      failCount--;
      doneCount--;
      updateSummary();
      await doDownload(item);
    });

    // Retry all failed
    retryAllBtn.addEventListener("click", async () => {
      const failedItems = items.filter(i => i.status === "failed");
      if (failedItems.length === 0) return;
      retryAllBtn.disabled = true;
      retryAllBtn.textContent = "Retrying...";
      for (const item of failedItems) {
        failCount--;
        doneCount--;
      }
      updateSummary();
      const retryWorkers = [];
      let retryIdx = 0;
      async function retryNext() {
        if (retryIdx >= failedItems.length) return;
        const item = failedItems[retryIdx++];
        await doDownload(item);
        await retryNext();
      }
      for (let r = 0; r < Math.min(maxConcurrent, failedItems.length); r++) retryWorkers.push(retryNext());
      await Promise.all(retryWorkers);
      retryAllBtn.disabled = false;
      retryAllBtn.textContent = "Retry All Failed";
    });

    async function downloadNext() {
      if (idx >= items.length) return;
      const item = items[idx++];
      await doDownload(item);
      await downloadNext();
    }

    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrent, totalCount); i++) {
      workers.push(downloadNext());
    }
    await Promise.all(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    summaryDiv.innerHTML = `<strong>Done!</strong> ✅ ${successCount} ❌ ${failCount} / ${totalCount} — ${formatBytes(totalBytes)} in ${elapsed}s`;
    closeBtn.style.display = "inline-flex";
    if (failCount === 0) {
      setTimeout(() => { progressEl.classList.remove("active"); progressEl.innerHTML = ""; }, 5000);
    }
    log(`Download complete: ${successCount}/${totalCount} (${formatBytes(totalBytes)}) in ${elapsed}s`, successCount === totalCount ? "success" : "warning");
    toast(`${successCount}/${totalCount} file(s) downloaded in ${elapsed}s`, successCount === totalCount ? "success" : "error");
  }

  // ── Copy URL ──

  function copyUrl(key, btnEl = null) {
    const url = client.getPublicUrl(key, customDomain || null);
    navigator.clipboard.writeText(url).then(() => {
      toast("Link copied: " + url, "success");
      log(`Copied: ${url}`, "success");
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = "&#10003; Copied!";
        btnEl.classList.add("copied");
        setTimeout(() => { btnEl.innerHTML = orig; btnEl.classList.remove("copied"); }, 1500);
      }
    });
  }

  function copyMultipleUrls(keys) {
    const urls = keys.map(k => client.getPublicUrl(k, customDomain || null));
    const text = urls.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      toast(`${urls.length} link(s) copied!`, "success");
      log(`Copied ${urls.length} links`, "success");
    });
  }

  // ── Delete ──

  document.getElementById("btn-delete-selected").addEventListener("click", () => {
    if (selectedKeys.size > 0) confirmDelete(Array.from(selectedKeys));
  });

  document.getElementById("btn-copy-links").addEventListener("click", () => {
    if (selectedKeys.size > 0) copyMultipleUrls(Array.from(selectedKeys));
  });

  async function deleteFolderRecursive(prefix) {
    log(`Scanning folder ${prefix}...`);
    const allKeys = [];
    let token = null;
    do {
      const result = await client.listObjects(prefix, "", token);
      for (const f of result.files) allKeys.push(f.key);
      token = result.isTruncated ? result.nextToken : null;
    } while (token);

    allKeys.push(prefix);

    log(`Deleting ${allKeys.length} items in ${prefix}...`);
    let deleted = 0;
    for (const key of allKeys) {
      try {
        await client.deleteObject(key);
        deleted++;
      } catch {}
    }
    log(`Deleted folder ${prefix} (${deleted} items)`, "success");
    return deleted;
  }

  function confirmDelete(keys) {
    const modal = document.getElementById("confirm-modal");
    const title = document.getElementById("confirm-title");
    const msg = document.getElementById("confirm-message");

    const hasFolder = keys.some(k => k.endsWith("/"));
    if (keys.length === 1 && !hasFolder) {
      title.textContent = "Delete File";
      msg.textContent = `Delete "${getFileName(keys[0])}"?`;
    } else if (keys.length === 1 && hasFolder) {
      title.textContent = "Delete Folder";
      msg.textContent = `Delete folder "${getFileName(keys[0])}" and ALL its contents? This cannot be undone.`;
    } else {
      title.textContent = "Delete Items";
      msg.textContent = `Delete ${keys.length} items${hasFolder ? " (including folders and their contents)" : ""}? This cannot be undone.`;
    }

    modal.classList.add("active");

    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");

    const cleanup = () => {
      modal.classList.remove("active");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onOk = async () => {
      cleanup();
      try {
        let totalDeleted = 0;
        for (const key of keys) {
          if (key.endsWith("/")) {
            const count = await deleteFolderRecursive(key);
            totalDeleted += count;
          } else {
            log(`Deleting ${getFileName(key)}...`);
            await client.deleteObject(key);
            log(`Deleted ${getFileName(key)}`, "success");
            totalDeleted++;
          }
        }
        toast(`Deleted ${totalDeleted} item(s)`, "success");
        selectedKeys.clear();
        loadFolder(currentPrefix);
      } catch (e) {
        log(`Delete failed: ${e.message}`, "error");
        toast("Delete failed: " + e.message, "error");
      }
    };

    const onCancel = () => cleanup();

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  }

  // ── New Folder ──

  document.getElementById("btn-new-folder").addEventListener("click", async () => {
    const name = prompt("Folder name:");
    if (!name || !name.trim()) return;

    const sanitized = name.trim().replace(/[<>:"|?*]/g, "");
    const key = currentPrefix + sanitized + "/";
    try {
      log(`Creating folder ${sanitized}/...`);
      await client.createFolder(key);
      log(`Created folder ${sanitized}/`, "success");
      toast(`Folder "${sanitized}" created`, "success");
      loadFolder(currentPrefix);
    } catch (e) {
      log(`Failed to create folder: ${e.message}`, "error");
      toast("Failed to create folder: " + e.message, "error");
    }
  });

  // ── Preview ──

  async function previewFile(key) {
    const name = getFileName(key);
    const modal = document.getElementById("preview-modal");
    const title = document.getElementById("preview-title");
    const body = document.getElementById("preview-body");

    title.textContent = name;
    body.innerHTML = `<div style="text-align:center;padding:30px"><div class="loading-spinner"></div> Loading preview...</div>`;
    modal.classList.add("active");

    try {
      const blob = await client.downloadFile(key);

      if (isImage(name)) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<img src="${url}" alt="${escapeHtml(name)}">`;
      } else if (isVideo(name)) {
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%;max-height:60vh"></video>`;
      } else if (isText(name)) {
        const text = await blob.text();
        body.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
      } else {
        body.innerHTML = `<p>Preview not available for this file type.</p>`;
      }
    } catch (e) {
      body.innerHTML = `<p style="color:var(--destructive)">Failed to load preview: ${escapeHtml(e.message)}</p>`;
    }
  }

  document.getElementById("preview-close").addEventListener("click", () => {
    document.getElementById("preview-modal").classList.remove("active");
    document.getElementById("preview-body").innerHTML = "";
  });

  document.getElementById("preview-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById("preview-modal").classList.remove("active");
      document.getElementById("preview-body").innerHTML = "";
    }
  });

  // ══════════════════════════════════════════════
  // ── SETTINGS ──
  // ══════════════════════════════════════════════

  document.getElementById("btn-settings").addEventListener("click", async () => {
    if (!currentServerId) return;
    const server = await ServerManager.getServer(currentServerId);
    if (!server) return;

    const info = ServerManager.getProtocolInfo(server.protocol);
    const fields = ServerManager.getFieldConfig();
    const container = document.getElementById("settings-dynamic-fields");

    container.innerHTML = `
      <div class="form-group">
        <label>Server Name</label>
        <input type="text" id="set-server-name" value="${escapeHtml(server.name || "")}" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Protocol</label>
        <input type="text" value="${info.name}" readonly style="opacity:0.6">
      </div>
    ` + info.fields.map(fieldName => {
      const f = fields[fieldName];
      if (!f) return "";
      const val = server[fieldName] || "";

      if (f.type === "checkbox") {
        return `<div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="set-field-${fieldName}" ${val ? "checked" : ""}>
            ${f.label}
          </label>
        </div>`;
      }

      return `<div class="form-group">
        <label>${f.label}</label>
        <input type="${f.type}" id="set-field-${fieldName}" value="${escapeHtml(String(val))}" placeholder="${f.placeholder || ""}" autocomplete="off">
        ${f.hint ? `<div class="hint">${f.hint}</div>` : ""}
      </div>`;
    }).join("");

    document.getElementById("settings-modal").classList.add("active");
  });

  document.getElementById("set-cancel").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("active");
  });

  document.getElementById("set-save").addEventListener("click", async () => {
    if (!currentServerId) return;
    const server = await ServerManager.getServer(currentServerId);
    if (!server) return;

    const info = ServerManager.getProtocolInfo(server.protocol);
    const fields = ServerManager.getFieldConfig();
    const updates = {
      name: document.getElementById("set-server-name").value.trim(),
    };

    for (const fieldName of info.fields) {
      const f = fields[fieldName];
      if (!f) continue;
      const el = document.getElementById(`set-field-${fieldName}`);
      if (!el) continue;

      if (f.type === "checkbox") {
        updates[fieldName] = el.checked;
      } else if (f.type === "number") {
        updates[fieldName] = parseInt(el.value) || 0;
      } else {
        updates[fieldName] = el.value.trim();
      }
    }

    await ServerManager.updateServer(currentServerId, updates);
    const updated = await ServerManager.getServer(currentServerId);
    customDomain = updated.customDomain || "";
    client = createStorageClient(updated);

    const updatedInfo = ServerManager.getProtocolInfo(updated.protocol);
    document.getElementById("header-protocol").textContent = updatedInfo.name;
    document.getElementById("header-title").textContent = updated.bucket || updated.host || updated.name || updatedInfo.name;

    await updateServerSwitcher();

    document.getElementById("settings-modal").classList.remove("active");
    toast("Settings saved", "success");
    log("Settings updated, reconnecting...", "success");
    loadFolder(currentPrefix);
  });

  document.getElementById("settings-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById("settings-modal").classList.remove("active");
    }
  });

  // ── Disconnect ──

  document.getElementById("btn-disconnect").addEventListener("click", async () => {
    if (!confirm("Disconnect from this server?")) return;
    client = null;
    customDomain = "";
    currentServerId = null;
    await ServerManager.setActiveServer(null);
    showSetup();
    log("Disconnected", "warning");
  });

  // ══════════════════════════════════════════════
  // ── BATCH RENAME ──
  // ══════════════════════════════════════════════

  document.getElementById("btn-batch-rename").addEventListener("click", () => {
    openBatchRename();
  });

  function openBatchRename() {
    batchRenameRules = [];
    const modal = document.getElementById("batch-rename-modal");

    const addSelect = document.getElementById("batch-rename-add-rule");
    addSelect.innerHTML = '<option value="">— Select rule —</option>' +
      BatchRename.getAvailableRules().map(r =>
        `<option value="${r.type}">${r.icon} ${r.label}</option>`
      ).join("");

    const scopeSelect = document.getElementById("batch-rename-scope");
    if (selectedKeys.size > 0) {
      scopeSelect.value = "selected";
    } else {
      scopeSelect.value = "current";
    }

    renderBatchRenameRules();
    updateBatchRenamePreview();
    modal.classList.add("active");
  }

  document.getElementById("batch-rename-add-rule").addEventListener("change", (e) => {
    const type = e.target.value;
    if (!type) return;

    const ruleDef = BatchRename.getAvailableRules().find(r => r.type === type);
    if (!ruleDef) return;

    batchRenameRules.push({
      id: Date.now(),
      type,
      enabled: true,
      ...ruleDef.defaults,
    });

    e.target.value = "";
    renderBatchRenameRules();
    updateBatchRenamePreview();
  });

  function renderBatchRenameRules() {
    const container = document.getElementById("batch-rename-rules");
    if (batchRenameRules.length === 0) {
      container.innerHTML = '<div class="batch-rename-empty">No rules added. Add a rule below to start.</div>';
      return;
    }

    container.innerHTML = batchRenameRules.map((rule, idx) => {
      const ruleDef = BatchRename.getAvailableRules().find(r => r.type === rule.type);
      return `<div class="batch-rule-card" data-idx="${idx}">
        <div class="batch-rule-header">
          <label class="batch-rule-toggle">
            <input type="checkbox" class="rule-enabled-check" data-idx="${idx}" ${rule.enabled ? "checked" : ""}>
            <span>${ruleDef ? ruleDef.icon + " " + ruleDef.label : rule.type}</span>
          </label>
          <div class="batch-rule-actions">
            ${idx > 0 ? `<button class="btn-icon btn-xs rule-move-up" data-idx="${idx}" title="Move up">↑</button>` : ""}
            ${idx < batchRenameRules.length - 1 ? `<button class="btn-icon btn-xs rule-move-down" data-idx="${idx}" title="Move down">↓</button>` : ""}
            <button class="btn-icon btn-xs rule-remove" data-idx="${idx}" title="Remove" style="color:var(--destructive)">×</button>
          </div>
        </div>
        <div class="batch-rule-body">${BatchRename.renderRuleEditor(rule)}</div>
      </div>`;
    }).join("");
  }

  document.getElementById("batch-rename-rules").addEventListener("click", (e) => {
    const moveUp = e.target.closest(".rule-move-up");
    if (moveUp) {
      const idx = parseInt(moveUp.dataset.idx);
      if (idx > 0) {
        [batchRenameRules[idx - 1], batchRenameRules[idx]] = [batchRenameRules[idx], batchRenameRules[idx - 1]];
        renderBatchRenameRules();
        updateBatchRenamePreview();
      }
      return;
    }

    const moveDown = e.target.closest(".rule-move-down");
    if (moveDown) {
      const idx = parseInt(moveDown.dataset.idx);
      if (idx < batchRenameRules.length - 1) {
        [batchRenameRules[idx], batchRenameRules[idx + 1]] = [batchRenameRules[idx + 1], batchRenameRules[idx]];
        renderBatchRenameRules();
        updateBatchRenamePreview();
      }
      return;
    }

    const remove = e.target.closest(".rule-remove");
    if (remove) {
      const idx = parseInt(remove.dataset.idx);
      batchRenameRules.splice(idx, 1);
      renderBatchRenameRules();
      updateBatchRenamePreview();
      return;
    }
  });

  document.getElementById("batch-rename-rules").addEventListener("change", (e) => {
    if (e.target.classList.contains("rule-enabled-check")) {
      const idx = parseInt(e.target.dataset.idx);
      batchRenameRules[idx].enabled = e.target.checked;
      updateBatchRenamePreview();
      return;
    }

    const card = e.target.closest(".batch-rule-card");
    if (!card) return;
    const idx = parseInt(card.dataset.idx);

    if (e.target.classList.contains("rule-input") || e.target.classList.contains("rule-select")) {
      batchRenameRules[idx][e.target.dataset.field] = e.target.value;
      if (e.target.dataset.field === "trimType" || e.target.dataset.field === "extAction") {
        renderBatchRenameRules();
      }
      updateBatchRenamePreview();
    }
    if (e.target.classList.contains("rule-check")) {
      batchRenameRules[idx][e.target.dataset.field] = e.target.checked;
      updateBatchRenamePreview();
    }
  });

  document.getElementById("batch-rename-rules").addEventListener("input", (e) => {
    const card = e.target.closest(".batch-rule-card");
    if (!card) return;
    const idx = parseInt(card.dataset.idx);

    if (e.target.classList.contains("rule-input")) {
      batchRenameRules[idx][e.target.dataset.field] = e.target.value;
      updateBatchRenamePreview();
    }
  });

  document.getElementById("batch-rename-scope").addEventListener("change", () => {
    updateBatchRenamePreview();
  });

  function getBatchRenameFiles() {
    const scope = document.getElementById("batch-rename-scope").value;
    let files;

    if (scope === "selected") {
      files = allFiles
        .filter(f => selectedKeys.has(f.key) && !f.key.endsWith("/"))
        .map(f => ({ key: f.key, name: getFileName(f.key) }));
    } else {
      files = allFiles.map(f => ({ key: f.key, name: getFileName(f.key) }));
    }

    return files;
  }

  function updateBatchRenamePreview() {
    const files = getBatchRenameFiles();
    const countEl = document.getElementById("batch-rename-count");
    countEl.textContent = `${files.length} file(s)`;

    const previewEl = document.getElementById("batch-rename-preview");

    if (files.length === 0) {
      previewEl.innerHTML = '<div class="batch-rename-empty">No files to rename</div>';
      return;
    }

    const results = BatchRename.applyRules(files, batchRenameRules);
    const maxShow = 50;
    const display = results.slice(0, maxShow);

    previewEl.innerHTML = `<table class="batch-preview-table">
      <thead><tr><th>Original</th><th></th><th>New Name</th></tr></thead>
      <tbody>${display.map(r => {
        const changed = r.name !== r.newName;
        return `<tr class="${changed ? "changed" : ""}">
          <td>${escapeHtml(r.name)}</td>
          <td class="arrow">${changed ? "→" : "="}</td>
          <td class="${changed ? "new-name" : ""}">${escapeHtml(r.newName || r.name)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>` + (results.length > maxShow ? `<div style="padding:8px;color:var(--muted-foreground);font-size:12px">... and ${results.length - maxShow} more</div>` : "");
  }

  document.getElementById("batch-rename-apply").addEventListener("click", async () => {
    const files = getBatchRenameFiles();
    if (files.length === 0) return;

    const results = BatchRename.applyRules(files, batchRenameRules);
    const toRename = results.filter(r => r.name !== r.newName);

    if (toRename.length === 0) {
      toast("No files to rename", "info");
      return;
    }

    document.getElementById("batch-rename-modal").classList.remove("active");
    log(`Batch renaming ${toRename.length} file(s)...`);

    let success = 0;
    let fail = 0;

    for (const item of toRename) {
      const prefix = item.key.substring(0, item.key.lastIndexOf("/") + 1);
      const newKey = prefix + item.newName;
      try {
        await client.renameObject(item.key, newKey);
        log(`Renamed: ${item.name} → ${item.newName}`, "success");
        success++;
      } catch (e) {
        log(`Rename failed: ${item.name} — ${e.message}`, "error");
        fail++;
      }
    }

    toast(`Batch rename: ${success} renamed, ${fail} failed`, success > 0 ? "success" : "error");
    log(`Batch rename complete: ${success} renamed, ${fail} failed`, success > 0 ? "success" : "warning");
    loadFolder(currentPrefix);
  });

  document.getElementById("batch-rename-cancel").addEventListener("click", () => {
    document.getElementById("batch-rename-modal").classList.remove("active");
  });

  document.getElementById("batch-rename-close").addEventListener("click", () => {
    document.getElementById("batch-rename-modal").classList.remove("active");
  });

  document.getElementById("batch-rename-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById("batch-rename-modal").classList.remove("active");
    }
  });

  // ── Log Toggle ──

  document.getElementById("log-toggle").addEventListener("click", () => {
    const body = document.getElementById("log-body");
    const arrow = document.getElementById("log-arrow");
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "block";
    arrow.classList.toggle("open", !isOpen);
  });

  // ── Global ESC ──

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("confirm-modal").classList.remove("active");
      document.getElementById("preview-modal").classList.remove("active");
      document.getElementById("settings-modal").classList.remove("active");
      document.getElementById("batch-rename-modal").classList.remove("active");
      document.getElementById("preview-body").innerHTML = "";
    }
  });

  // ══════════════════════════════════════════════
  // ── INIT ──
  // ══════════════════════════════════════════════

  async function init() {
    await ServerManager.migrateFromLegacy();

    const activeId = await ServerManager.getActiveServerId();
    if (activeId) {
      const server = await ServerManager.getServer(activeId);
      if (server) {
        try {
          client = createStorageClient(server);
          currentServerId = activeId;
          customDomain = server.customDomain || "";

          const info = ServerManager.getProtocolInfo(server.protocol);
          document.getElementById("header-icon").textContent = info.icon;
          document.getElementById("header-icon").style.background = info.iconColor;
          document.getElementById("header-protocol").textContent = info.name;
          document.getElementById("header-title").textContent = server.bucket || server.host || server.name || info.name;

          await updateServerSwitcher();
          showApp();
          log(`Connected to ${server.name || info.name}${server.bucket ? " (" + server.bucket + ")" : ""}`, "success");
          loadFolder("");
          return;
        } catch (e) {
          log("Auto-connect failed: " + e.message, "error");
        }
      }
    }

    showSetup();
  }

  init();
})();
