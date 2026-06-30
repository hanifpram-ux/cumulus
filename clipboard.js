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

  async function buildPasteQueue(destPrefix) {
    const ctx = window.ManagerCtx;
    const client = ctx.getClient();
    const { sourcePrefix, items } = state;
    const queue = []; // { srcKey, destKey, isFolder, topLevelKey }

    for (const item of items) {
      const destKey = computeDestinationKey(item.key, sourcePrefix, destPrefix);

      if (item.isFolder) {
        // Only reject *true* nesting (destination strictly inside the source folder).
        // Pasting back into the exact same parent with the exact same name (destKey === item.key)
        // is an ordinary duplicate-in-place and must fall through to conflict resolution instead.
        const isTrueNesting =
          (destKey !== item.key && destKey.startsWith(item.key)) || destPrefix.startsWith(item.key);
        if (isTrueNesting) {
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
    const replacedTopLevel = new Set(); // folder top-level keys resolved via "replace"

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
      } else if (resolution.action === "replace" && item.isFolder) {
        // File replace needs no special-case: copyObject/renameObject overwrite a single file in place.
        // Folder replace does: createFolder() is a no-op (S3 marker PUT) or swallows 405 (WebDAV MKCOL),
        // so pre-existing destination contents that aren't part of the source folder would otherwise
        // survive the paste, turning "replace" into a silent merge. Wipe the destination folder first.
        replacedTopLevel.add(item.key);
      }
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

    if (replacedTopLevel.size > 0) {
      for (const topLevelKey of replacedTopLevel) {
        const destKey = computeDestinationKey(topLevelKey, state.sourcePrefix, destPrefix);
        try {
          const existingChildKeys = await listFolderContentsRecursive(client, destKey);
          for (const childKey of existingChildKeys) {
            try {
              ctx.log(`Replacing: deleting existing ${ctx.getFileName(childKey)}...`);
              await client.deleteObject(childKey);
            } catch (e) {
              ctx.log(`Failed to delete existing ${ctx.getFileName(childKey)} before replace: ${e.message}`, "error");
            }
          }
          ctx.log(`Replacing: deleting existing folder marker ${ctx.getFileName(destKey)}...`);
          await client.deleteObject(destKey);
        } catch (e) {
          ctx.log(`Failed to clear existing folder ${ctx.getFileName(destKey)} before replace: ${e.message}`, "error");
        }
      }
    }

    let succeeded = 0;
    let failed = 0;
    const topLevelFailed = new Set(); // topLevelKeys that had at least one failed queue entry

    for (const { srcKey, destKey, isFolder, topLevelKey } of queue) {
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
        topLevelFailed.add(topLevelKey);
      }
    }

    if (mode === "cut" && succeeded > 0) {
      // Folders themselves are recreated at destination above; remove the now-empty source folder markers.
      // Only delete a folder's own source marker if every queue entry belonging to that folder (the
      // marker itself plus all recursively-listed children) succeeded - otherwise its un-moved contents
      // would be orphaned at the source with no parent marker.
      for (const item of state.items) {
        if (item.isFolder && !skippedTopLevel.has(item.key) && !topLevelFailed.has(item.key)) {
          try { await client.deleteObject(item.key); } catch {}
        }
      }
    }

    if (mode === "cut") clear();

    ctx.reloadCurrentFolder();
    return { succeeded, failed, skipped: skippedTopLevel.size };
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
    paste,
  };
})();
