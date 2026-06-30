(function () {
  "use strict";

  let currentMode = "list";
  let thumbObserver = null;

  function get() {
    return currentMode;
  }

  function applyDom(mode) {
    document.getElementById("file-table-wrap").style.display = mode === "list" ? "" : "none";
    document.getElementById("file-grid").style.display = mode === "grid" ? "grid" : "none";
    document.getElementById("btn-view-list").classList.toggle("active", mode === "list");
    document.getElementById("btn-view-grid").classList.toggle("active", mode === "grid");
  }

  async function init() {
    const stored = await chrome.storage.local.get("viewMode");
    currentMode = stored.viewMode === "grid" ? "grid" : "list";
    applyDom(currentMode);
  }

  async function set(mode) {
    currentMode = mode;
    await chrome.storage.local.set({ viewMode: mode });
    applyDom(mode);
  }

  function buildThumbContent(item, ctx) {
    if (item.isFolder) return `<span>\u{1F4C1}</span>`;
    if (ctx.isImage(item.name) || ctx.isVideo(item.name)) {
      return `<span class="grid-thumb-placeholder">${ctx.getFileIcon(item.name)}</span>`;
    }
    return `<span>${ctx.getFileIcon(item.name)}</span>`;
  }

  function renderGrid(items, selectedKeys) {
    const ctx = window.ManagerCtx;
    const grid = document.getElementById("file-grid");

    if (thumbObserver) {
      thumbObserver.disconnect();
      thumbObserver = null;
    }

    if (items.length === 0) {
      grid.innerHTML = "";
      return;
    }

    grid.innerHTML = items.map((item) => {
      const checked = selectedKeys.has(item.key) ? "checked" : "";
      const selectedClass = selectedKeys.has(item.key) ? "selected" : "";
      return `<div class="grid-card ${selectedClass}" data-key="${ctx.escapeHtml(item.key)}" data-folder="${item.isFolder ? "1" : "0"}" title="${ctx.escapeHtml(item.name)}">
        <input type="checkbox" class="grid-card-check" data-key="${ctx.escapeHtml(item.key)}" ${checked}>
        <div class="grid-card-thumb" data-key="${ctx.escapeHtml(item.key)}" data-name="${ctx.escapeHtml(item.name)}">${buildThumbContent(item, ctx)}</div>
        <div class="grid-card-name">${ctx.escapeHtml(item.name)}</div>
        <div class="grid-card-size">${item.isFolder ? "" : ctx.formatSize(item.size)}</div>
      </div>`;
    }).join("");

    thumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        thumbObserver.unobserve(el);
        loadThumbnail(el, ctx);
      }
    }, { root: grid, rootMargin: "200px" });

    grid.querySelectorAll(".grid-card-thumb").forEach((el) => {
      const name = el.dataset.name;
      if (ctx.isImage(name) || ctx.isVideo(name)) thumbObserver.observe(el);
    });
  }

  async function loadThumbnail(el, ctx) {
    const key = el.dataset.key;
    const name = el.dataset.name;
    try {
      const client = ctx.getClient();
      const blob = await client.downloadFile(key);
      const url = URL.createObjectURL(blob);
      if (ctx.isImage(name)) {
        el.innerHTML = `<img src="${url}" alt="${ctx.escapeHtml(name)}">`;
      } else if (ctx.isVideo(name)) {
        el.innerHTML = `<video src="${url}" muted preload="metadata"></video>`;
      }
    } catch {
      // Keep the icon fallback already in place.
    }
  }

  window.ViewMode = { get, init, set, renderGrid };
})();
