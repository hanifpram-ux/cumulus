# Copy/Move/Paste + Grid/List View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clipboard-style Copy/Move/Paste between folders (same-server only, files and folders, recursive), and a toggleable Grid (thumbnail/icon preview) view alongside the existing List (table) view, defaulting to List.

**Architecture:** Two new vanilla-JS files (`clipboard.js`, `view-mode.js`) loaded as additional `<script>` tags in `manager.html`, following the existing `batch-rename.js` pattern (an IIFE-free module that exposes a small global object, wired up by `manager.js`). `manager.js` is modified to add toolbar buttons, call into the new modules, and trigger grid re-render alongside `renderFileTable()`. No build step exists in this project — files are plain `<script>` tags, so new globals must avoid name collisions with existing globals (`client`, `currentPrefix`, `allFolders`, `allFiles`, `selectedKeys`, `toast`, `log`, `escapeHtml`, `getFileName`, `getFileIcon`, `isImage`, `isVideo`, `loadFolder`, `previewFile`).

**Tech Stack:** Vanilla JavaScript (ES2017+, Chrome Extension Manifest V3), no frameworks, no bundler, no test runner currently present in the repo.

## Global Constraints

- Same-server only for Copy/Move (no cross-server transfer) — per spec "Scope" section.
- Copy uses `client.copyObject(sourceKey, destKey)`; Move uses `client.renameObject(oldKey, newKey)` — both already implemented server-side in `storage-client.js` for S3Client (lines 257-265) and WebDAVClient (lines 478-500). Do not reimplement these.
- Folder copy/move must be recursive, mirroring the listing approach in `deleteFolderRecursive` (`manager.js:1237-1259`).
- Conflict handling is per-file: Skip / Replace / Rename, with an "Apply to all remaining conflicts" checkbox — per spec.
- View mode persists globally via `chrome.storage.local` key `viewMode` (`"list"` or `"grid"`), defaulting to `"list"`.
- Grid thumbnails for images/video must be lazy-loaded via `IntersectionObserver`.
- No automated test runner exists in this repo. "Testing" for each task means manually loading the extension in Chrome (`chrome://extensions` → load unpacked → reload) and exercising the feature against a real or test storage server, plus checking the Activity Log and DevTools console for errors. Each task's steps say exactly what manual sequence to run.
- This directory is not a git repository (confirmed: no `.git` present at `d:\Android\Cumulus`). Skip all `git add`/`git commit` steps — instead, each task ends with a manual verification step. If the user initializes git later, commits can be made retroactively.

---

## File Structure

| File | Responsibility |
|---|---|
| `clipboard.js` (new) | Clipboard state (mode/source/items), conflict detection against loaded folder contents, recursive enumeration of folder contents for copy/move, executing the copy/move queue via `client.copyObject`/`client.renameObject`, exposing `window.Clipboard` API. |
| `view-mode.js` (new) | View mode state (`"list"`/`"grid"`), persistence to `chrome.storage.local`, grid rendering (cards, thumbnails, lazy-load), exposing `window.ViewMode` API. |
| `manager.html` (modified) | Add Copy/Move/Paste toolbar buttons, clipboard bar markup, conflict-resolution modal markup, view-toggle buttons, `#file-grid` container, two new `<script>` tags. |
| `manager.js` (modified) | Wire new toolbar buttons to `Clipboard`/`ViewMode` functions; call grid render alongside `renderFileTable()`; expose the few internals (`getFileName`, `getFileIcon`, `isImage`, `isVideo`, `loadFolder`, `previewFile`, `currentPrefix`, `allFolders`, `allFiles`, `selectedKeys`, `client`, `toast`, `log`, `escapeHtml`, `formatSize`) that `clipboard.js`/`view-mode.js` need, via a small `window.ManagerCtx` accessor object instead of duplicating logic. |
| `styles.css` (modified) | Styles for clipboard bar, conflict modal, view-toggle buttons, grid cards. |

### Why a `ManagerCtx` accessor instead of duplicating state

`manager.js` keeps its state in closure-local `let` variables (`currentPrefix`, `allFiles`, etc.), not on `window`. `clipboard.js` and `view-mode.js` need read access to this state and need to call `loadFolder`/`renderFileTable`. Rather than hoist all of `manager.js`'s state to `window` (risking collisions and a bigger diff), `manager.js` will expose one small object:

```js
window.ManagerCtx = {
  getClient: () => client,
  getCurrentPrefix: () => currentPrefix,
  getAllFolders: () => allFolders,
  getAllFiles: () => allFiles,
  getSelectedKeys: () => selectedKeys,
  clearSelectedKeys: () => selectedKeys.clear(),
  reloadCurrentFolder: () => loadFolder(currentPrefix),
  getFileName,
  getFileIcon,
  isImage,
  isVideo,
  isPreviewable,
  previewFile,
  toast,
  log,
  escapeHtml,
  formatSize,
};
```

This is assigned once, near the top of `manager.js` after all referenced functions are defined (at the end of the IIFE, before its closing `})();`). `clipboard.js` and `view-mode.js` only ever read through `window.ManagerCtx.*` — they never redeclare this state.

---

## Task 1: Wire up `ManagerCtx` and verify existing tests still pass

**Files:**
- Modify: `manager.js` (add `window.ManagerCtx = {...}` near the end of the IIFE, just before its closing `})();`)

**Interfaces:**
- Produces: `window.ManagerCtx` object with the shape shown above, available to any script loaded after `manager.js`. Note: since `clipboard.js`/`view-mode.js` will be wired to call `ManagerCtx` members, and `manager.js` itself will call into `Clipboard`/`ViewMode`, `manager.js` must be loaded **after** `clipboard.js` and `view-mode.js` in `manager.html` (script order matters — `ManagerCtx` is assigned synchronously at parse time inside the existing IIFE, and `manager.js`'s DOMContentLoaded-independent top-level code already runs immediately, so the new files must exist first when `manager.js` runs its setup, but `ManagerCtx` itself is only consumed later inside event handlers, after all scripts have parsed — so load order is: `crypto-utils.js`, `storage-client.js`, `server-manager.js`, `batch-rename.js`, `clipboard.js`, `view-mode.js`, `manager.js`).

- [ ] **Step 1: Locate the exact end of the `manager.js` IIFE**

Run a search to find the closing of the top-level IIFE:

```bash
grep -n "^})();" "d:/Android/Cumulus/manager.js"
```

Expected: one match near the last line of the file (manager.js is 1795 lines per earlier exploration — expect a match around line 1795).

- [ ] **Step 2: Add the `ManagerCtx` export just before that closing line**

Open `manager.js`, find the line immediately before the final `})();`, and insert:

```js
  // ── Manager Context (used by clipboard.js, view-mode.js) ──

  window.ManagerCtx = {
    getClient: () => client,
    getCurrentPrefix: () => currentPrefix,
    getAllFolders: () => allFolders,
    getAllFiles: () => allFiles,
    getSelectedKeys: () => selectedKeys,
    clearSelectedKeys: () => selectedKeys.clear(),
    reloadCurrentFolder: () => loadFolder(currentPrefix),
    getFileName,
    getFileIcon,
    isImage,
    isVideo,
    isPreviewable,
    previewFile,
    toast,
    log,
    escapeHtml,
    formatSize,
  };
```

- [ ] **Step 3: Manually verify the extension still loads**

In Chrome: go to `chrome://extensions`, enable Developer Mode, "Load unpacked" pointing at `d:\Android\Cumulus` (or "Reload" if already loaded). Open the extension, connect to any configured test server (or add one), and confirm the file list still loads with no console errors (open DevTools on the extension popup/manager page, check Console tab for errors).

Expected: No new console errors; existing upload/download/delete/rename still work as before.

- [ ] **Step 4: Confirm `ManagerCtx` is reachable from DevTools console**

In the DevTools console for the manager page, run:

```js
window.ManagerCtx.getCurrentPrefix()
```

Expected: returns the current prefix string (e.g. `""` at root), confirming the object is attached and the getter works.

---

## Task 2: `clipboard.js` — state, conflict detection, and recursive enumeration (no execution yet)

**Files:**
- Create: `clipboard.js`

**Interfaces:**
- Consumes: `window.ManagerCtx.getClient()`, `.getCurrentPrefix()`, `.getAllFolders()`, `.getAllFiles()`, `.getSelectedKeys()`, `.getFileName(key)`, `.log(msg, type)`, `.escapeHtml(s)`.
- Produces (for Task 3 and `manager.js` wiring in Task 4):
  - `window.Clipboard.getState()` → `{ mode: "copy"|"cut"|null, sourcePrefix: string, items: Array<{key: string, isFolder: boolean}> }`
  - `window.Clipboard.set(mode)` → reads current selection via `ManagerCtx`, populates state. `mode` is `"copy"` or `"cut"`.
  - `window.Clipboard.clear()` → resets state to empty.
  - `window.Clipboard.isEmpty()` → boolean.
  - `window.Clipboard.computeDestinationKey(sourceKey, sourcePrefix, destPrefix)` → string. Pure function: replaces the `sourcePrefix` prefix of `sourceKey` with `destPrefix`.
  - `window.Clipboard.listFolderContentsRecursive(client, folderPrefix)` → `Promise<string[]>` of all file keys under `folderPrefix` (uses `client.listObjects(prefix, "", token)` in a loop, same pattern as `deleteFolderRecursive`).
  - `window.Clipboard.detectConflicts(destPrefix, plannedKeys)` → `string[]` — subset of `plannedKeys` (top-level file/folder names being pasted, not recursive children) that already exist as a file or folder name in the destination, checked against `ManagerCtx.getAllFiles()`/`getAllFolders()` **only when destPrefix === current loaded folder** (callers must call this only when looking at the currently-loaded destination folder, which is the only one paste ever targets, since paste always happens in the currently open folder).
  - `window.Clipboard.isDescendant(folderPrefix, candidatePrefix)` → boolean — true if `candidatePrefix` is the same as or nested under `folderPrefix` (used to block "move folder into itself").

- [ ] **Step 1: Create `clipboard.js` with state + pure helpers**

```js
(function () {
  "use strict";

  let state = { mode: null, sourcePrefix: "", items: [] };

  function getState() {
    return state;
  }

  function isEmpty() {
    return state.mode === null || state.items.length === 0;
  }

  function clear() {
    state = { mode: null, sourcePrefix: "", items: [] };
  }

  function set(mode) {
    const ctx = window.ManagerCtx;
    const selected = Array.from(ctx.getSelectedKeys());
    if (selected.length === 0) return;

    const folderKeys = new Set(ctx.getAllFolders());
    const items = selected.map((key) => ({
      key,
      isFolder: folderKeys.has(key) || key.endsWith("/"),
    }));

    state = {
      mode,
      sourcePrefix: ctx.getCurrentPrefix(),
      items,
    };
  }

  function computeDestinationKey(sourceKey, sourcePrefix, destPrefix) {
    if (sourcePrefix && sourceKey.startsWith(sourcePrefix)) {
      return destPrefix + sourceKey.slice(sourcePrefix.length);
    }
    // sourceKey has no source prefix (root-level item); just relocate under destPrefix.
    const name = sourceKey.replace(/\/$/, "").split("/").pop() + (sourceKey.endsWith("/") ? "/" : "");
    return destPrefix + name;
  }

  function isDescendant(folderPrefix, candidatePrefix) {
    return candidatePrefix === folderPrefix || candidatePrefix.startsWith(folderPrefix);
  }

  async function listFolderContentsRecursive(client, folderPrefix) {
    const keys = [];
    let token = null;
    do {
      const result = await client.listObjects(folderPrefix, "", token);
      for (const f of result.files) keys.push(f.key);
      token = result.isTruncated ? result.nextToken : null;
    } while (token);
    return keys;
  }

  function detectConflicts(destPrefix, plannedKeys) {
    const ctx = window.ManagerCtx;
    const existingFiles = new Set(ctx.getAllFiles().map((f) => f.key));
    const existingFolders = new Set(ctx.getAllFolders());
    return plannedKeys.filter((key) => existingFiles.has(key) || existingFolders.has(key));
  }

  window.Clipboard = {
    getState,
    isEmpty,
    clear,
    set,
    computeDestinationKey,
    isDescendant,
    listFolderContentsRecursive,
    detectConflicts,
  };
})();
```

- [ ] **Step 2: Manually verify pure functions from DevTools console**

Reload the extension, open DevTools console on the manager page, and run:

```js
window.Clipboard.computeDestinationKey("folder-a/x.png", "folder-a/", "folder-b/")
// Expected: "folder-b/x.png"

window.Clipboard.computeDestinationKey("root.txt", "", "folder-b/")
// Expected: "folder-b/root.txt"

window.Clipboard.isDescendant("folder-a/", "folder-a/sub/")
// Expected: true

window.Clipboard.isDescendant("folder-a/", "folder-b/")
// Expected: false

window.Clipboard.isEmpty()
// Expected: true (nothing selected/copied yet)
```

Expected: all four calls return the values noted above with no console errors.

- [ ] **Step 3: Manually verify `set`/`clear`/`getState` against live selection**

In the manager UI, check one or two checkboxes for files in the current folder. In DevTools console:

```js
window.Clipboard.set("copy");
window.Clipboard.getState();
```

Expected: returns `{ mode: "copy", sourcePrefix: <current prefix>, items: [{key: ..., isFolder: false}, ...] }` matching the checked rows. Then run `window.Clipboard.clear(); window.Clipboard.isEmpty();` and expect `true`.

- [ ] **Step 4: Add `<script src="clipboard.js"></script>` to `manager.html`**

In `manager.html`, insert before the `batch-rename.js`/`manager.js` scripts (per the load-order constraint from Task 1):

```html
  <script src="crypto-utils.js"></script>
  <script src="storage-client.js"></script>
  <script src="server-manager.js"></script>
  <script src="batch-rename.js"></script>
  <script src="clipboard.js"></script>
  <script src="view-mode.js"></script>
  <script src="manager.js"></script>
```

(`view-mode.js` doesn't exist yet — Task 5 creates it. For now, temporarily comment that line out or create an empty placeholder `view-mode.js` containing just `(function(){"use strict";})();` so the page doesn't 404 on script load. Task 5 will replace it with the real implementation.)

- [ ] **Step 5: Reload extension and re-run Step 2/3 checks**

Confirm no console errors on load, and the Step 2/3 console checks still pass with `clipboard.js` loaded as a real `<script>` tag (not pasted manually into console).

---

## Task 3: `clipboard.js` — paste execution (copy/move queue with conflict resolution)

**Files:**
- Modify: `clipboard.js`

**Interfaces:**
- Consumes: everything from Task 2, plus `window.ManagerCtx.getClient()`, `.reloadCurrentFolder()`, `.toast()`, `.log()`, `.getFileName()`.
- Produces:
  - `window.Clipboard.paste(resolveConflict)` → `Promise<{succeeded: number, failed: number, skipped: number}>`. `resolveConflict` is an async callback `(conflictingKey, isFolder) => Promise<{action: "skip"|"replace"|"rename", newName?: string, applyToAll?: boolean}>` supplied by the UI layer (Task 6 modal in `manager.js`). `paste()` calls this once per conflicting top-level item unless a prior call returned `applyToAll: true`, in which case that resolution is reused for all remaining conflicts without prompting again.

- [ ] **Step 1: Implement `paste()` in `clipboard.js`**

Add to the IIFE in `clipboard.js`, before the `window.Clipboard = {...}` assignment:

```js
  async function buildPasteQueue(destPrefix) {
    const ctx = window.ManagerCtx;
    const client = ctx.getClient();
    const { sourcePrefix, items } = state;
    const queue = []; // { srcKey, destKey, isFolder, topLevelKey }

    for (const item of items) {
      const destKey = computeDestinationKey(item.key, sourcePrefix, destPrefix);

      if (item.isFolder) {
        if (isDescendant(item.key, destKey) || isDescendant(item.key, destPrefix)) {
          throw new Error(`Cannot move folder "${ctx.getFileName(item.key)}" into itself`);
        }
        const childKeys = await listFolderContentsRecursive(client, item.key);
        queue.push({ srcKey: item.key, destKey, isFolder: true, topLevelKey: item.key });
        for (const childKey of childKeys) {
          const childDest = destKey + childKey.slice(item.key.length);
          queue.push({ srcKey: childKey, destKey: childDest, isFolder: false, topLevelKey: item.key });
        }
      } else {
        queue.push({ srcKey: item.key, destKey, isFolder: false, topLevelKey: item.key });
      }
    }

    return queue;
  }

  async function paste(resolveConflict) {
    const ctx = window.ManagerCtx;
    const client = ctx.getClient();
    const destPrefix = ctx.getCurrentPrefix();
    const mode = state.mode;

    if (isEmpty()) return { succeeded: 0, failed: 0, skipped: 0 };

    const topLevelDestKeys = state.items.map((item) =>
      computeDestinationKey(item.key, state.sourcePrefix, destPrefix)
    );
    const conflicts = new Set(detectConflicts(destPrefix, topLevelDestKeys));

    let queue = await buildPasteQueue(destPrefix);

    let appliedAll = null; // { action, newName? } once user checks "apply to all"
    const renamedTopLevel = new Map(); // topLevelKey -> new destKey (top-level only)
    const skippedTopLevel = new Set();

    for (const item of state.items) {
      const destKey = computeDestinationKey(item.key, state.sourcePrefix, destPrefix);
      if (!conflicts.has(destKey)) continue;

      let resolution = appliedAll;
      if (!resolution) {
        resolution = await resolveConflict(destKey, item.isFolder);
        if (resolution.applyToAll) appliedAll = resolution;
      }

      if (resolution.action === "skip") {
        skippedTopLevel.add(item.key);
      } else if (resolution.action === "rename") {
        const parent = destKey.substring(0, destKey.lastIndexOf("/", destKey.length - (item.isFolder ? 2 : 1)) + 1);
        const newKey = item.isFolder ? parent + resolution.newName + "/" : parent + resolution.newName;
        renamedTopLevel.set(item.key, newKey);
      }
      // "replace": no special-case needed, copyObject/renameObject will overwrite.
    }

    queue = queue.filter((q) => !skippedTopLevel.has(q.topLevelKey));
    queue = queue.map((q) => {
      if (renamedTopLevel.has(q.topLevelKey)) {
        const oldTopDest = computeDestinationKey(q.topLevelKey, state.sourcePrefix, destPrefix);
        const newTopDest = renamedTopLevel.get(q.topLevelKey);
        return { ...q, destKey: newTopDest + q.destKey.slice(oldTopDest.length) };
      }
      return q;
    });

    let succeeded = 0;
    let failed = 0;

    for (const { srcKey, destKey, isFolder } of queue) {
      try {
        ctx.log(`${mode === "cut" ? "Moving" : "Copying"} ${ctx.getFileName(srcKey)}...`);
        if (isFolder) {
          await client.createFolder(destKey);
        } else if (mode === "cut") {
          await client.renameObject(srcKey, destKey);
        } else {
          await client.copyObject(srcKey, destKey);
        }
        succeeded++;
      } catch (e) {
        ctx.log(`Failed to ${mode === "cut" ? "move" : "copy"} ${ctx.getFileName(srcKey)}: ${e.message}`, "error");
        failed++;
      }
    }

    if (mode === "cut" && succeeded > 0) {
      // Folders themselves are recreated at destination above; remove the now-empty source folder markers.
      for (const item of state.items) {
        if (item.isFolder && !skippedTopLevel.has(item.key)) {
          try { await client.deleteObject(item.key); } catch {}
        }
      }
    }

    if (mode === "cut") clear();

    ctx.reloadCurrentFolder();
    return { succeeded, failed, skipped: skippedTopLevel.size };
  }
```

- [ ] **Step 2: Add `paste` to the `window.Clipboard` export**

Update the final assignment in `clipboard.js`:

```js
  window.Clipboard = {
    getState,
    isEmpty,
    clear,
    set,
    computeDestinationKey,
    isDescendant,
    listFolderContentsRecursive,
    detectConflicts,
    paste,
  };
```

- [ ] **Step 3: Manually verify copy with no conflicts**

Set up a test server folder with at least 2 files and 1 subfolder (with a file inside it). In the manager UI: select one file (not in a subfolder), click nothing yet (toolbar wiring comes in Task 4) — instead drive it from DevTools console for this task:

```js
window.Clipboard.set("copy");
window.Clipboard.paste(async () => ({ action: "skip" })) // no conflicts expected, callback won't be invoked
  .then(r => console.log("paste result", r));
```

Expected: console logs `paste result { succeeded: 1, failed: 0, skipped: 0 }`, the Activity Log shows a "Copying ..." entry, and after `ctx.reloadCurrentFolder()` runs, the file list still shows the original file (copy target same as source folder — since destPrefix equals sourcePrefix and no rename was applied, this specific case will hit a conflict; re-run this test pasting into a **different** empty subfolder instead by navigating there first via the UI, then running just `window.Clipboard.paste(...)` again without re-running `set`, since clipboard persists across navigation).

- [ ] **Step 4: Manually verify conflict path (rename)**

With the same file still in clipboard (mode `"copy"`), navigate back to the original source folder (so destPrefix === sourcePrefix, guaranteeing a conflict), then run:

```js
window.Clipboard.paste(async (key, isFolder) => {
  console.log("conflict for", key, isFolder);
  return { action: "rename", newName: "renamed-copy.txt" };
}).then(r => console.log("paste result", r));
```

Expected: console logs `conflict for <key> false`, then `paste result { succeeded: 1, failed: 0, skipped: 0 }`, and the folder now contains a new file named `renamed-copy.txt` alongside the original.

- [ ] **Step 5: Manually verify folder copy (recursive)**

```js
window.Clipboard.set("copy"); // with the test subfolder selected instead
```

Navigate to an empty destination folder, then:

```js
window.Clipboard.paste(async () => ({ action: "skip" }))
  .then(r => console.log("paste result", r));
```

Expected: the destination folder now contains a copy of the subfolder with its file inside, `succeeded` count includes the folder marker plus its child file.

- [ ] **Step 6: Manually verify move (cut) clears clipboard**

```js
window.Clipboard.set("cut"); // with a test file selected
```

Navigate to a different empty folder, run `window.Clipboard.paste(async () => ({ action: "skip" }))`, then check:

```js
window.Clipboard.isEmpty()
```

Expected: `true` (cut clears clipboard after a successful paste), and the original file no longer appears in its source folder (confirm by navigating back).

---

## Task 4: Toolbar wiring for Copy/Move/Paste in `manager.js` + `manager.html` (no conflict modal UI yet — auto-skip conflicts)

**Files:**
- Modify: `manager.html` (add toolbar buttons + clipboard bar markup)
- Modify: `manager.js` (wire button click handlers)
- Modify: `styles.css` (style the clipboard bar)

**Interfaces:**
- Consumes: `window.Clipboard.set/getState/isEmpty/clear/paste` from Task 2/3.
- Produces: clickable `#btn-copy-selected`, `#btn-move-selected` buttons; a `#clipboard-bar` element with `#clipboard-bar-text`, `#btn-paste`, `#btn-clipboard-cancel`. This task wires Paste with a temporary `resolveConflict` that always returns `{ action: "skip" }` — Task 6 replaces this with the real modal.

- [ ] **Step 1: Add toolbar buttons to `manager.html`**

In `manager.html`, modify the toolbar (around line 123) to insert Copy/Move between Batch Rename and Download:

```html
      <button class="btn" id="btn-batch-rename" title="Batch rename files">&#9998; Batch Rename</button>
      <button class="btn" id="btn-copy-selected" disabled title="Copy selected items">&#128203; Copy</button>
      <button class="btn" id="btn-move-selected" disabled title="Move selected items">&#9986; Move</button>
      <button class="btn" id="btn-download-selected" disabled>&#11015; Download</button>
```

- [ ] **Step 2: Add the clipboard bar markup to `manager.html`**

Immediately after the closing `</div>` of the `toolbar` div (after line 137 in the original file), insert:

```html
    <!-- Clipboard Bar -->
    <div class="clipboard-bar" id="clipboard-bar" style="display:none">
      <span id="clipboard-bar-text"></span>
      <div class="clipboard-bar-actions">
        <button class="btn btn-primary" id="btn-paste">&#128229; Paste</button>
        <button class="btn" id="btn-clipboard-cancel">Cancel</button>
      </div>
    </div>
```

- [ ] **Step 3: Add clipboard bar styles to `styles.css`**

Append to `styles.css`:

```css
.clipboard-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: var(--accent);
  border-bottom: 1px solid var(--border);
  color: var(--accent-foreground);
  font-size: 13px;
}

.clipboard-bar-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 4: Wire button handlers in `manager.js`**

Add near the existing selection-button wiring (after the `btn-copy-links` listener block, around line 1235 in the original file):

```js
  // ── Clipboard (Copy/Move/Paste) ──

  function updateClipboardBar() {
    const bar = document.getElementById("clipboard-bar");
    const text = document.getElementById("clipboard-bar-text");
    const pasteBtn = document.getElementById("btn-paste");

    if (window.Clipboard.isEmpty()) {
      bar.style.display = "none";
      return;
    }

    const { mode, sourcePrefix, items } = window.Clipboard.getState();
    bar.style.display = "flex";
    text.textContent = `${items.length} item(s) ${mode === "cut" ? "cut" : "copied"} from /${sourcePrefix}`;
    pasteBtn.disabled = false;
  }

  document.getElementById("btn-copy-selected").addEventListener("click", () => {
    window.Clipboard.set("copy");
    updateClipboardBar();
    toast(`${selectedKeys.size} item(s) copied`, "info");
  });

  document.getElementById("btn-move-selected").addEventListener("click", () => {
    window.Clipboard.set("cut");
    updateClipboardBar();
    toast(`${selectedKeys.size} item(s) cut`, "info");
  });

  document.getElementById("btn-clipboard-cancel").addEventListener("click", () => {
    window.Clipboard.clear();
    updateClipboardBar();
  });

  document.getElementById("btn-paste").addEventListener("click", async () => {
    const pasteBtn = document.getElementById("btn-paste");
    pasteBtn.disabled = true;
    try {
      const result = await window.Clipboard.paste(async () => ({ action: "skip" }));
      toast(`Pasted: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`, result.failed > 0 ? "error" : "success");
    } catch (e) {
      toast("Paste failed: " + e.message, "error");
      log("Paste failed: " + e.message, "error");
    } finally {
      updateClipboardBar();
    }
  });
```

- [ ] **Step 5: Enable Copy/Move buttons in `updateSelectionBtns()`**

Modify the existing `updateSelectionBtns()` function (original lines 553-569) to also toggle the new buttons:

```js
  function updateSelectionBtns() {
    const btn = document.getElementById("btn-delete-selected");
    const copyBtn = document.getElementById("btn-copy-links");
    const dlBtn = document.getElementById("btn-download-selected");
    const copySelBtn = document.getElementById("btn-copy-selected");
    const moveSelBtn = document.getElementById("btn-move-selected");
    btn.disabled = selectedKeys.size === 0;
    copyBtn.disabled = selectedKeys.size === 0;
    dlBtn.disabled = selectedKeys.size === 0;
    copySelBtn.disabled = selectedKeys.size === 0;
    moveSelBtn.disabled = selectedKeys.size === 0;
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
```

- [ ] **Step 6: Manually verify end-to-end Copy → navigate → Paste via UI only**

Reload the extension. In a test folder with at least one file: check the file's checkbox, click "Copy" — expect the clipboard bar to appear with "1 item(s) copied from /...". Navigate into a different (empty) subfolder using the breadcrumb or by clicking into a folder. Click "Paste". Expect a success toast "Pasted: 1 succeeded, 0 failed, 0 skipped", and the file now appears in the destination folder. Click the original source folder breadcrumb to confirm the original file still exists there (copy, not move).

- [ ] **Step 7: Manually verify end-to-end Move via UI only**

Repeat Step 6 but click "Move" instead of "Copy". Expect after Paste: the clipboard bar disappears (cleared automatically), the file appears in the destination folder, and navigating back to the source folder shows the file is gone.

- [ ] **Step 8: Manually verify conflict auto-skip (temporary behavior until Task 6)**

Copy a file, then paste it into its own source folder (same name will conflict). Since `resolveConflict` always returns `"skip"` at this point in the plan, expect the toast to read "Pasted: 0 succeeded, 0 failed, 1 skipped" and no duplicate file created. This confirms the skip path works before Task 6 adds the real choice dialog.

---

## Task 5: `view-mode.js` — state, persistence, and grid rendering

**Files:**
- Create: `view-mode.js`
- Modify: `manager.html` (add view-toggle buttons, `#file-grid` container; replace placeholder `view-mode.js` script tag content from Task 2 Step 4)
- Modify: `styles.css` (grid card styles)

**Interfaces:**
- Consumes: `window.ManagerCtx.getClient()`, `.getAllFolders()`, `.getAllFiles()`, `.getCurrentPrefix()`, `.getFileName()`, `.getFileIcon()`, `.isImage()`, `.isVideo()`, `.isPreviewable()`, `.previewFile()`, `.getSelectedKeys()`, `.formatSize()`.
- Produces:
  - `window.ViewMode.get()` → `"list" | "grid"`.
  - `window.ViewMode.init()` → `Promise<void>` — reads `chrome.storage.local.get("viewMode")`, applies it (shows/hides `#file-table-wrap` vs `#file-grid`, sets toggle button active state). Must be called once during manager startup.
  - `window.ViewMode.set(mode)` → `Promise<void>` — persists to `chrome.storage.local.set({viewMode: mode})`, updates DOM visibility, re-renders grid if switching to grid.
  - `window.ViewMode.renderGrid(items, selectedKeys)` → `void`. `items` is the same merged/filtered/sorted array shape `renderFileTable()` builds (`{key, name, isFolder, size, lastModified}`), so `manager.js`'s `renderFileTable()` will be modified (Task 6) to also call this when in grid mode, instead of duplicating the filter/sort logic.

- [ ] **Step 1: Add `#file-grid` container and view-toggle buttons to `manager.html`**

Modify the toolbar in `manager.html` to add a view-toggle button group right before the search box (around original line 136):

```html
      <div class="view-toggle">
        <button class="btn-icon view-toggle-btn active" id="btn-view-list" title="List view">&#9638;</button>
        <button class="btn-icon view-toggle-btn" id="btn-view-grid" title="Grid view">&#9639;</button>
      </div>
      <input type="text" class="search-box" id="search-box" placeholder="Filter files...">
```

Add the grid container right after the closing `</div>` of `file-table-wrap` (after original line 157):

```html
    <div class="file-grid" id="file-grid" style="display:none"></div>
```

- [ ] **Step 2: Add grid + toggle styles to `styles.css`**

```css
.view-toggle {
  display: flex;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.view-toggle-btn {
  border-radius: 0;
  border: none;
}

.view-toggle-btn.active {
  background: var(--accent);
  color: var(--accent-foreground);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  padding: 16px;
}

.grid-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  cursor: pointer;
  position: relative;
}

.grid-card:hover {
  background: var(--accent);
}

.grid-card.selected {
  outline: 2px solid var(--primary);
}

.grid-card-check {
  position: absolute;
  top: 6px;
  left: 6px;
}

.grid-card-thumb {
  width: 100%;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  overflow: hidden;
  margin-bottom: 8px;
}

.grid-card-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

.grid-card-name {
  font-size: 12px;
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-card-size {
  font-size: 11px;
  color: var(--muted-foreground);
  margin-top: 2px;
}
```

- [ ] **Step 3: Implement `view-mode.js` (replace the Task 2 placeholder)**

```js
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
```

- [ ] **Step 4: Manually verify view-mode persistence**

Reload the extension with this real `view-mode.js` in place (and the placeholder removed). In DevTools console:

```js
window.ViewMode.get() // expect "list" on first load
window.ViewMode.set("grid")
```

Expected: `#file-grid` becomes visible (`display: grid`), `#file-table-wrap` hides, `#btn-view-grid` gets `.active` class. Reload the extension page (not the whole Chrome extension, just the manager tab) — expect grid mode to persist (since `init()` will be wired in Task 6 to run on startup and read from storage). Note: until Task 6 wires `init()` into manager.js startup and `renderGrid` into `renderFileTable()`, this task's own manual verification is limited to calling `ViewMode.set`/`get` directly, since nothing populates `#file-grid` with real items yet.

- [ ] **Step 5: Manually verify `renderGrid` renders cards with placeholder icons**

In DevTools console, simulate a call using current folder data:

```js
const folders = window.ManagerCtx.getAllFolders().map(f => ({key: f, name: window.ManagerCtx.getFileName(f), isFolder: true, size: -1, lastModified: ""}));
const files = window.ManagerCtx.getAllFiles().map(f => ({key: f.key, name: window.ManagerCtx.getFileName(f.key), isFolder: false, size: f.size, lastModified: f.lastModified}));
window.ViewMode.renderGrid([...folders, ...files], window.ManagerCtx.getSelectedKeys());
```

Expected: `#file-grid` populates with one card per item; image/video files show an icon placeholder immediately, then (after the `IntersectionObserver` fires, which happens immediately for visible cards) swap to a real `<img>`/`<video>` thumbnail within a second or two. Folders show the folder icon. Non-media files show their extension-based icon. No console errors.

---

## Task 6: Integrate `ViewMode` into `manager.js` render pipeline + replace conflict auto-skip with real modal

**Files:**
- Modify: `manager.js` (call `ViewMode.init()` on startup, call `ViewMode.renderGrid()` from `renderFileTable()`, wire view-toggle buttons, wire grid click/checkbox/dblclick delegation, replace the Task 4 Step 4 `resolveConflict` stub with a real modal-driven implementation)
- Modify: `manager.html` (add conflict-resolution modal markup)
- Modify: `styles.css` (conflict modal styles, reusing `.modal-overlay`/`.modal` classes already defined for other modals)

**Interfaces:**
- Consumes: `window.ViewMode.init/set/get/renderGrid`, `window.Clipboard.paste`.
- Produces: fully working grid/list toggle wired to real data, and a real per-conflict Skip/Replace/Rename modal with "apply to all" used as the `resolveConflict` callback passed to `Clipboard.paste`.

- [ ] **Step 1: Modify `renderFileTable()` in `manager.js` to also drive the grid**

Locate `renderFileTable()` (original lines 405-471). After the line that builds `const items = [...folders, ...files];` (original line 432) and before the `if (items.length === 0)` check, the function currently only renders the table. Restructure so both renders share the same `items` array. Replace the whole function body from `const items = [...folders, ...files];` onward with:

```js
    const items = [...folders, ...files];

    if (window.ViewMode.get() === "grid") {
      document.getElementById("empty-state").style.display = items.length === 0 ? "block" : "none";
      window.ViewMode.renderGrid(items, selectedKeys);
      return;
    }

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
```

(This keeps the existing table markup byte-for-byte, only adding the grid branch before it.)

- [ ] **Step 2: Call `ViewMode.init()` during startup and wire toggle buttons**

Find where `manager.js` initializes the app after a successful connection (search for where `loadFolder` is first called after connecting — this is in the connect/login flow). Add, near the top of the IIFE after `ServerManager.init(ENCRYPTION_PASS);` (original line 18):

```js
  window.ViewMode.init();

  document.getElementById("btn-view-list").addEventListener("click", async () => {
    await window.ViewMode.set("list");
    renderFileTable();
  });

  document.getElementById("btn-view-grid").addEventListener("click", async () => {
    await window.ViewMode.set("grid");
    renderFileTable();
  });
```

- [ ] **Step 3: Wire grid click/checkbox/dblclick delegation in `manager.js`**

Add near the existing `file-tbody` event listeners (after the dblclick rename handler block, original lines 587-629):

```js
  // ── Grid view events ──

  document.getElementById("file-grid").addEventListener("click", (e) => {
    if (e.target.classList.contains("grid-card-check")) return; // handled by change listener
    const card = e.target.closest(".grid-card");
    if (!card) return;
    const key = card.dataset.key;
    const isFolder = card.dataset.folder === "1";
    if (isFolder) {
      loadFolder(key);
    } else if (isPreviewable(getFileName(key))) {
      previewFile(key);
    }
  });

  document.getElementById("file-grid").addEventListener("change", (e) => {
    if (!e.target.classList.contains("grid-card-check")) return;
    const key = e.target.dataset.key;
    if (e.target.checked) selectedKeys.add(key);
    else selectedKeys.delete(key);
    updateSelectionBtns();
    e.target.closest(".grid-card").classList.toggle("selected", e.target.checked);
  });
```

Note: per spec, double-click in list view enters folders/previews on single click for folders (the existing list view actually triggers on single click via `.file-name` click handler, not dblclick — dblclick is reserved for rename). Grid view mirrors that: single click on a folder card navigates, single click on a previewable file card opens preview, consistent with how `.file-name` (not `.row-check`) click behaves in the table.

- [ ] **Step 4: Add conflict-resolution modal markup to `manager.html`**

Add after the existing `confirm-modal` block in `manager.html` (after original line 210):

```html
  <!-- Conflict Resolution Modal -->
  <div class="modal-overlay" id="conflict-modal">
    <div class="confirm-dialog">
      <h3>File Already Exists</h3>
      <p id="conflict-message"></p>
      <label style="display:flex;align-items:center;gap:6px;margin:10px 0;font-size:13px">
        <input type="checkbox" id="conflict-apply-all"> Apply to all remaining conflicts
      </label>
      <div id="conflict-rename-row" style="display:none;margin-bottom:10px">
        <input type="text" id="conflict-rename-input" class="rename-input" style="width:100%">
      </div>
      <div class="actions">
        <button class="btn" id="conflict-skip">Skip</button>
        <button class="btn" id="conflict-rename">Rename</button>
        <button class="btn btn-primary" id="conflict-replace">Replace</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 5: Implement the real `resolveConflict` handler in `manager.js`**

Replace the `btn-paste` click handler from Task 4 Step 4 with:

```js
  function resolveConflictViaModal(conflictingKey, isFolder) {
    return new Promise((resolve) => {
      const modal = document.getElementById("conflict-modal");
      const msg = document.getElementById("conflict-message");
      const applyAllCheck = document.getElementById("conflict-apply-all");
      const renameRow = document.getElementById("conflict-rename-row");
      const renameInput = document.getElementById("conflict-rename-input");
      const skipBtn = document.getElementById("conflict-skip");
      const renameBtn = document.getElementById("conflict-rename");
      const replaceBtn = document.getElementById("conflict-replace");

      const name = getFileName(conflictingKey);
      msg.textContent = `"${name}" already exists in this folder.`;
      renameRow.style.display = "none";
      applyAllCheck.checked = false;
      modal.classList.add("active");

      const cleanup = () => {
        modal.classList.remove("active");
        skipBtn.removeEventListener("click", onSkip);
        renameBtn.removeEventListener("click", onRenameClick);
        replaceBtn.removeEventListener("click", onReplace);
      };

      const finish = (result) => {
        cleanup();
        resolve({ ...result, applyToAll: applyAllCheck.checked });
      };

      const onSkip = () => finish({ action: "skip" });
      const onReplace = () => finish({ action: "replace" });
      const onRenameClick = () => {
        if (renameRow.style.display === "none") {
          renameRow.style.display = "block";
          const ext = name.includes(".") ? "." + name.split(".").pop() : "";
          const base = ext ? name.slice(0, -ext.length) : name;
          renameInput.value = `${base} (1)${ext}`;
          renameInput.focus();
          renameInput.select();
          return;
        }
        finish({ action: "rename", newName: renameInput.value.trim() || name });
      };

      skipBtn.addEventListener("click", onSkip);
      renameBtn.addEventListener("click", onRenameClick);
      replaceBtn.addEventListener("click", onReplace);
    });
  }

  document.getElementById("btn-paste").addEventListener("click", async () => {
    const pasteBtn = document.getElementById("btn-paste");
    pasteBtn.disabled = true;
    try {
      const result = await window.Clipboard.paste(resolveConflictViaModal);
      toast(`Pasted: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`, result.failed > 0 ? "error" : "success");
    } catch (e) {
      toast("Paste failed: " + e.message, "error");
      log("Paste failed: " + e.message, "error");
    } finally {
      updateClipboardBar();
    }
  });
```

- [ ] **Step 6: Manually verify grid view shows real folder contents**

Reload the extension, connect to a test server with a mix of image files, regular files, and at least one subfolder. Click the grid toggle button. Expect: cards for every item, image files show a real thumbnail (or icon briefly before the thumbnail loads), folders show the folder icon, clicking a folder card navigates into it, clicking an image file card opens the existing preview modal, checking a card's checkbox updates the selection count shown on Delete/Copy/Move buttons identically to list view.

- [ ] **Step 7: Manually verify list/grid toggle preserves selection**

In grid view, check 2 file checkboxes. Click the list toggle button. Expect: the same 2 rows appear checked in the table. Switch back to grid — expect the same 2 cards still show as checked. This confirms `selectedKeys` is shared state, not duplicated.

- [ ] **Step 8: Manually verify the conflict modal end-to-end (Skip / Replace / Rename)**

Copy a file, paste it into the same source folder (guaranteed conflict). Expect the conflict modal to appear with the correct file name in the message.
- Click "Skip": expect toast "Pasted: 0 succeeded, 0 failed, 1 skipped", no new file.
- Repeat copy+paste, this time click "Replace": expect toast "Pasted: 1 succeeded...", and the file's `lastModified` timestamp updates (visible in list view's Modified column) confirming it was overwritten.
- Repeat copy+paste with 2 different files both conflicting, click "Rename" on the first, check "Apply to all remaining conflicts" before confirming — wait, "apply to all" should be checked before clicking the resolution button. Re-verify: check "Apply to all remaining conflicts" checkbox, then click "Rename" (which on first click reveals the rename input — click "Rename" a second time to confirm with the input visible), and confirm the second conflicting file is automatically renamed too without the modal reappearing.

- [ ] **Step 9: Manually verify folder-into-itself rejection**

Select a folder, click "Move", navigate into that same folder (or a subfolder of it), click "Paste". Expect a toast reading "Paste failed: Cannot move folder "<name>" into itself" and no changes made.

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage check:** Toolbar Copy/Move buttons (Task 4), persistent clipboard bar surviving navigation (Task 4, state lives outside `currentPrefix`), Paste enabled anywhere including source folder (Task 3/4 — no folder-equality guard blocks paste), conflict modal with Skip/Replace/Rename + apply-to-all (Task 6), recursive folder copy/move (Task 3 `buildPasteQueue`), copy persists clipboard / move clears it (Task 3 `paste()`), folder-into-itself rejection (Task 3 `buildPasteQueue` throw), progress/log entries reusing existing `log()` (Task 3 `ctx.log` calls), list/grid toggle defaulting to list (Task 5/6, `chrome.storage.local` default), thumbnails for image/video with icon fallback for others (Task 5 `buildThumbContent`/`loadThumbnail`), lazy-load via `IntersectionObserver` (Task 5), shared selection/sort/filter state between views (Task 6 Step 1 restructure of `renderFileTable`). All spec sections are covered.
- **Placeholder scan:** No TBD/TODO markers; every step has runnable code or an exact manual verification sequence.
- **Type consistency check:** `Clipboard.getState()` shape `{mode, sourcePrefix, items}` used consistently in Task 2 (definition), Task 3 (`paste`), Task 4 (`updateClipboardBar`). `ViewMode.renderGrid(items, selectedKeys)` signature matches between Task 5 (definition) and Task 6 Step 1 (call site). `ManagerCtx` member names (`getFileName`, `getFileIcon`, `isImage`, `isVideo`, `formatSize`, `escapeHtml`, `log`, `toast`, `getClient`, `getCurrentPrefix`, `getAllFolders`, `getAllFiles`, `getSelectedKeys`, `clearSelectedKeys`, `reloadCurrentFolder`, `isPreviewable`, `previewFile`) are identical across Task 1 (definition) and all consumers in Tasks 2, 3, 5.
- **Known limitation carried forward from spec:** Cross-server copy/move remains explicitly out of scope; no task implements it.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-30-copy-move-paste-grid-list.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
