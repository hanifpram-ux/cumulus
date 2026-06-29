const BatchRename = {
  applyRules(files, rules) {
    return files.map((file, index) => {
      let name = file.name;
      const ext = name.includes(".") ? name.substring(name.lastIndexOf(".")) : "";
      let baseName = name.includes(".") ? name.substring(0, name.lastIndexOf(".")) : name;

      for (const rule of rules) {
        if (!rule.enabled) continue;

        switch (rule.type) {
          case "find-replace":
            if (rule.useRegex) {
              try {
                const flags = rule.caseSensitive ? "g" : "gi";
                const re = new RegExp(rule.find, flags);
                baseName = baseName.replace(re, rule.replace || "");
              } catch {}
            } else {
              if (rule.caseSensitive) {
                baseName = baseName.split(rule.find).join(rule.replace || "");
              } else {
                const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                baseName = baseName.replace(new RegExp(escaped, "gi"), rule.replace || "");
              }
            }
            break;

          case "numbering": {
            const start = parseInt(rule.start) || 1;
            const step = parseInt(rule.step) || 1;
            const padding = parseInt(rule.padding) || 1;
            const num = start + index * step;
            const numStr = String(num).padStart(padding, "0");
            const separator = rule.separator || "_";

            if (rule.position === "prefix") {
              baseName = numStr + separator + baseName;
            } else if (rule.position === "suffix") {
              baseName = baseName + separator + numStr;
            } else if (rule.position === "replace") {
              baseName = numStr;
            }
            break;
          }

          case "case":
            if (rule.caseType === "lower") baseName = baseName.toLowerCase();
            else if (rule.caseType === "upper") baseName = baseName.toUpperCase();
            else if (rule.caseType === "title") {
              baseName = baseName.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
            } else if (rule.caseType === "sentence") {
              baseName = baseName.charAt(0).toUpperCase() + baseName.slice(1).toLowerCase();
            }
            break;

          case "trim":
            if (rule.trimType === "spaces") {
              baseName = baseName.trim().replace(/\s+/g, " ");
            } else if (rule.trimType === "leading") {
              baseName = baseName.replace(/^\s+/, "");
            } else if (rule.trimType === "trailing") {
              baseName = baseName.replace(/\s+$/, "");
            } else if (rule.trimType === "all-spaces") {
              baseName = baseName.replace(/\s+/g, "");
            } else if (rule.trimType === "custom") {
              const chars = (rule.chars || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              if (chars) baseName = baseName.replace(new RegExp(`[${chars}]`, "g"), "");
            }
            break;

          case "insert": {
            const pos = parseInt(rule.position) || 0;
            const text = rule.text || "";
            if (rule.fromEnd) {
              const insertAt = Math.max(0, baseName.length - pos);
              baseName = baseName.slice(0, insertAt) + text + baseName.slice(insertAt);
            } else {
              const insertAt = Math.min(pos, baseName.length);
              baseName = baseName.slice(0, insertAt) + text + baseName.slice(insertAt);
            }
            break;
          }

          case "remove": {
            const from = parseInt(rule.from) || 0;
            const count = parseInt(rule.count) || 0;
            if (count > 0 && from < baseName.length) {
              baseName = baseName.slice(0, from) + baseName.slice(from + count);
            }
            break;
          }

          case "extension":
            if (rule.extAction === "change" && rule.newExt) {
              const newExt = rule.newExt.startsWith(".") ? rule.newExt : "." + rule.newExt;
              return { ...file, newName: baseName + newExt };
            } else if (rule.extAction === "remove") {
              return { ...file, newName: baseName };
            } else if (rule.extAction === "lower") {
              return { ...file, newName: baseName + ext.toLowerCase() };
            } else if (rule.extAction === "upper") {
              return { ...file, newName: baseName + ext.toUpperCase() };
            }
            break;

          case "replace-spaces":
            baseName = baseName.replace(/\s+/g, rule.replacement || "_");
            break;

          case "date": {
            const now = new Date();
            const pad = n => String(n).padStart(2, "0");
            const dateStr = rule.format
              .replace("YYYY", now.getFullYear())
              .replace("MM", pad(now.getMonth() + 1))
              .replace("DD", pad(now.getDate()))
              .replace("hh", pad(now.getHours()))
              .replace("mm", pad(now.getMinutes()))
              .replace("ss", pad(now.getSeconds()));
            const sep = rule.separator || "_";
            if (rule.position === "prefix") baseName = dateStr + sep + baseName;
            else baseName = baseName + sep + dateStr;
            break;
          }
        }
      }

      return { ...file, newName: baseName + ext };
    });
  },

  getAvailableRules() {
    return [
      {
        type: "find-replace",
        label: "Find & Replace",
        icon: "🔍",
        defaults: { find: "", replace: "", useRegex: false, caseSensitive: false },
      },
      {
        type: "numbering",
        label: "Add Numbering",
        icon: "#️⃣",
        defaults: { start: 1, step: 1, padding: 3, position: "prefix", separator: "_" },
      },
      {
        type: "case",
        label: "Change Case",
        icon: "Aa",
        defaults: { caseType: "lower" },
      },
      {
        type: "trim",
        label: "Trim / Clean",
        icon: "✂️",
        defaults: { trimType: "spaces", chars: "" },
      },
      {
        type: "insert",
        label: "Insert Text",
        icon: "📝",
        defaults: { text: "", position: 0, fromEnd: false },
      },
      {
        type: "remove",
        label: "Remove Characters",
        icon: "🗑️",
        defaults: { from: 0, count: 0 },
      },
      {
        type: "replace-spaces",
        label: "Replace Spaces",
        icon: "⎵",
        defaults: { replacement: "_" },
      },
      {
        type: "extension",
        label: "Change Extension",
        icon: "📎",
        defaults: { extAction: "change", newExt: "" },
      },
      {
        type: "date",
        label: "Add Date/Time",
        icon: "📅",
        defaults: { format: "YYYY-MM-DD", position: "prefix", separator: "_" },
      },
    ];
  },

  renderRuleEditor(rule) {
    switch (rule.type) {
      case "find-replace":
        return `
          <div class="rule-row">
            <label>Find:</label>
            <input type="text" class="rule-input" data-field="find" value="${escapeAttr(rule.find || "")}" placeholder="Text to find">
          </div>
          <div class="rule-row">
            <label>Replace:</label>
            <input type="text" class="rule-input" data-field="replace" value="${escapeAttr(rule.replace || "")}" placeholder="Replace with">
          </div>
          <div class="rule-row rule-checkboxes">
            <label><input type="checkbox" class="rule-check" data-field="useRegex" ${rule.useRegex ? "checked" : ""}> Regex</label>
            <label><input type="checkbox" class="rule-check" data-field="caseSensitive" ${rule.caseSensitive ? "checked" : ""}> Case sensitive</label>
          </div>`;

      case "numbering":
        return `
          <div class="rule-row">
            <label>Start:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="start" value="${rule.start || 1}" min="0">
            <label>Step:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="step" value="${rule.step || 1}" min="1">
            <label>Padding:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="padding" value="${rule.padding || 3}" min="1" max="10">
          </div>
          <div class="rule-row">
            <label>Position:</label>
            <select class="rule-select" data-field="position">
              <option value="prefix" ${rule.position === "prefix" ? "selected" : ""}>Prefix</option>
              <option value="suffix" ${rule.position === "suffix" ? "selected" : ""}>Suffix</option>
              <option value="replace" ${rule.position === "replace" ? "selected" : ""}>Replace name</option>
            </select>
            <label>Separator:</label>
            <input type="text" class="rule-input rule-input-sm" data-field="separator" value="${escapeAttr(rule.separator || "_")}" maxlength="5">
          </div>`;

      case "case":
        return `
          <div class="rule-row">
            <label>Type:</label>
            <select class="rule-select" data-field="caseType">
              <option value="lower" ${rule.caseType === "lower" ? "selected" : ""}>lowercase</option>
              <option value="upper" ${rule.caseType === "upper" ? "selected" : ""}>UPPERCASE</option>
              <option value="title" ${rule.caseType === "title" ? "selected" : ""}>Title Case</option>
              <option value="sentence" ${rule.caseType === "sentence" ? "selected" : ""}>Sentence case</option>
            </select>
          </div>`;

      case "trim":
        return `
          <div class="rule-row">
            <label>Type:</label>
            <select class="rule-select" data-field="trimType">
              <option value="spaces" ${rule.trimType === "spaces" ? "selected" : ""}>Normalize spaces</option>
              <option value="leading" ${rule.trimType === "leading" ? "selected" : ""}>Leading spaces</option>
              <option value="trailing" ${rule.trimType === "trailing" ? "selected" : ""}>Trailing spaces</option>
              <option value="all-spaces" ${rule.trimType === "all-spaces" ? "selected" : ""}>All spaces</option>
              <option value="custom" ${rule.trimType === "custom" ? "selected" : ""}>Custom characters</option>
            </select>
          </div>
          ${rule.trimType === "custom" ? `
          <div class="rule-row">
            <label>Characters:</label>
            <input type="text" class="rule-input" data-field="chars" value="${escapeAttr(rule.chars || "")}" placeholder="e.g. _-#">
          </div>` : ""}`;

      case "insert":
        return `
          <div class="rule-row">
            <label>Text:</label>
            <input type="text" class="rule-input" data-field="text" value="${escapeAttr(rule.text || "")}" placeholder="Text to insert">
          </div>
          <div class="rule-row">
            <label>Position:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="position" value="${rule.position || 0}" min="0">
            <label><input type="checkbox" class="rule-check" data-field="fromEnd" ${rule.fromEnd ? "checked" : ""}> From end</label>
          </div>`;

      case "remove":
        return `
          <div class="rule-row">
            <label>From position:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="from" value="${rule.from || 0}" min="0">
            <label>Count:</label>
            <input type="number" class="rule-input rule-input-sm" data-field="count" value="${rule.count || 0}" min="0">
          </div>`;

      case "replace-spaces":
        return `
          <div class="rule-row">
            <label>Replace with:</label>
            <input type="text" class="rule-input rule-input-sm" data-field="replacement" value="${escapeAttr(rule.replacement || "_")}" maxlength="10">
          </div>`;

      case "extension":
        return `
          <div class="rule-row">
            <label>Action:</label>
            <select class="rule-select" data-field="extAction">
              <option value="change" ${rule.extAction === "change" ? "selected" : ""}>Change to</option>
              <option value="remove" ${rule.extAction === "remove" ? "selected" : ""}>Remove</option>
              <option value="lower" ${rule.extAction === "lower" ? "selected" : ""}>Lowercase</option>
              <option value="upper" ${rule.extAction === "upper" ? "selected" : ""}>Uppercase</option>
            </select>
            ${rule.extAction === "change" ? `<input type="text" class="rule-input rule-input-sm" data-field="newExt" value="${escapeAttr(rule.newExt || "")}" placeholder=".txt">` : ""}
          </div>`;

      case "date":
        return `
          <div class="rule-row">
            <label>Format:</label>
            <input type="text" class="rule-input" data-field="format" value="${escapeAttr(rule.format || "YYYY-MM-DD")}" placeholder="YYYY-MM-DD">
            <span class="rule-hint">YYYY, MM, DD, hh, mm, ss</span>
          </div>
          <div class="rule-row">
            <label>Position:</label>
            <select class="rule-select" data-field="position">
              <option value="prefix" ${rule.position === "prefix" ? "selected" : ""}>Prefix</option>
              <option value="suffix" ${rule.position === "suffix" ? "selected" : ""}>Suffix</option>
            </select>
            <label>Separator:</label>
            <input type="text" class="rule-input rule-input-sm" data-field="separator" value="${escapeAttr(rule.separator || "_")}" maxlength="5">
          </div>`;

      default:
        return "";
    }
  },
};

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
