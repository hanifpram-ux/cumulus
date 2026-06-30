# Copy/Move/Paste + Grid/List View — Design

## Context

Cumulus is a vanilla-JS Chrome Extension file manager for S3-compatible and WebDAV storage. It currently supports upload, download, rename (inline + batch), delete, copy-URL, and folder creation, but has **no copy/move-between-folders feature** and **only a table (list) view**. This spec adds:

1. Clipboard-style **Copy / Move / Paste** between folders.
2. A **Grid (preview) view** alongside the existing **List view**, toggleable, defaulting to List.

## Scope

- Copy/Move is **same-server only** (no cross-server transfer in this iteration — that requires download+upload through the browser and is deferred).
- Works for both files and folders (folders copied/moved recursively).
- Grid view covers thumbnails for images/video and icons for everything else.

## Architecture

Two new files, following the existing pattern of `batch-rename.js`:

- **`clipboard.js`** — clipboard state (copy/cut items + source prefix), conflict resolution, recursive copy/move execution using the storage client's existing `copyObject()` / `renameObject()` (both are server-side operations — S3 via `x-amz-copy-source`, WebDAV via `COPY`/`MOVE` methods — no data passes through the browser).
- **`view-mode.js`** — list/grid toggle state, grid rendering, thumbnail lazy-loading, persistence to `chrome.storage.local`.

`manager.html` gets two new `<script>` tags (after `batch-rename.js`, before `manager.js`). `manager.js` is modified minimally: wire new toolbar buttons, call into `clipboard.js`/`view-mode.js` functions, and call the grid renderer alongside `renderFileTable()` wherever the file list re-renders.

## Feature 1: Copy / Move / Paste

### Toolbar additions

New buttons inserted between "Batch Rename" and "Download Selected":
- `📋 Copy` — enabled when `selectedKeys.size > 0`.
- `✂️ Move` — enabled when `selectedKeys.size > 0`.

### Clipboard bar

A persistent bar appears above the toolbar when the clipboard is non-empty:

> `3 items copied from /folder-a/`  `[Paste]` `[Cancel]`

- Survives folder navigation (clipboard state is independent of `currentPrefix`).
- `Paste` is enabled in any folder, including the source folder (for duplication) and the original folder (for copy use case).
- `Cancel` clears the clipboard and hides the bar.

### Clipboard state (`clipboard.js`)

```js
clipboardState = {
  mode: "copy" | "cut" | null,
  sourcePrefix: string,
  items: [{ key, isFolder }],
}
```

- Clicking `Copy`/`Move` snapshots `selectedKeys` (resolved to `{key, isFolder}` pairs) and sets `mode`.
- Clicking a new `Copy`/`Move` while clipboard is non-empty overwrites it (no multi-clipboard).

### Paste flow

1. For each clipboard item, compute its destination key by swapping `sourcePrefix` for `currentPrefix` (preserving relative path), e.g. `folder-a/x.png` → `folder-b/x.png`.
2. For folders: list all objects under the source prefix recursively (same listing approach as `deleteFolderRecursive`), and queue each as an individual copy/move with the relative path preserved under the new folder prefix.
3. **Conflict check**: before executing, check each computed destination key against the already-loaded `allFiles`/`allFolders` of the destination folder.
   - If a conflict exists, show a modal dialog: **Skip / Replace / Rename** with a checkbox "Apply to all remaining conflicts" so batch pastes don't require per-file clicks.
   - "Rename" auto-suggests `name (1).ext` and lets the user edit before confirming.
4. Execute the queue:
   - **Copy** → `client.copyObject(srcKey, destKey)`.
   - **Move** → `client.renameObject(srcKey, destKey)` (existing copy+delete behavior).
5. Show a progress panel reusing the existing upload/download progress panel pattern (per-item status, success/fail counts), and log each operation to the Activity Log.
6. On completion:
   - **Move**: clipboard is cleared automatically.
   - **Copy**: clipboard persists so the user can paste into multiple folders, until they explicitly Cancel or start a new Copy/Move.
7. Refresh the destination folder listing (`loadFolder(currentPrefix)`) after paste completes.

### Edge cases

- Pasting a cut folder into its own descendant is rejected with an error toast ("Cannot move a folder into itself").
- If `client.copyObject` throws (e.g. permissions), the item is marked failed in the progress panel and others continue.

## Feature 2: List / Grid View Toggle

### Toolbar addition

A view-toggle button group near the search box: `▤` (List) / `▦` (Grid). Default: **List**.

### Persistence (`view-mode.js`)

- `chrome.storage.local` key `viewMode: "list" | "grid"`.
- Read on manager init; defaults to `"list"` when unset.
- Written whenever the user toggles.

### Grid rendering

- New container `#file-grid` sits alongside `#file-table-wrap`; exactly one of the two is visible at a time based on `viewMode`.
- Each item renders as a card: corner checkbox, large thumbnail/icon, name (ellipsis-truncated with `title` for full name), size below.
- **Thumbnails**:
  - Images (`jpg/png/gif/webp/svg/bmp`) and video (`mp4/webm/mov`) get a real thumbnail using the same signed URL mechanism as the existing preview modal.
  - Everything else (and folders) get a large icon based on extension/type, reusing the existing icon logic from the table view.
  - Lazy-loaded via `IntersectionObserver` — thumbnail `src` is only set once the card scrolls into view, to avoid flooding the storage endpoint with signed requests on large folders.
- Click behavior mirrors table rows: single click toggles selection, double-click enters folder / opens preview / triggers rename — reusing existing handlers rather than duplicating logic.
- Grid uses CSS `grid-template-columns: repeat(auto-fill, minmax(...))` for responsive sizing.

### Interaction with existing features

- Search/filter, sort, and selection state are shared between both views — switching views re-renders from the same underlying `allFiles`/`allFolders` + `selectedKeys`, no duplicated state.
- Sorting controls (currently table column headers) remain List-only; Grid view always reflects the last-applied sort order from List.

## Out of scope (deferred)

- Cross-server copy/move (would require download-then-upload through the browser).
- Drag-and-drop move within the grid/list.
- Per-folder or per-server view-mode preference (view mode is global).
