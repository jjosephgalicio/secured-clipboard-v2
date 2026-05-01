const assets = [
  "/fonts/worksans-regular.woff2",
  "/fonts/worksans-semibold.woff2",
  "/fonts/worksans-bold.woff2",
];

const db = new PouchDB("secure_clipboard");
const dbTabs = new PouchDB("secure_clipboard_tabs");
const dbSmartFields = new PouchDB("smart-fields");

const itemList = document.getElementById("itemList");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const modal = document.getElementById("modal");
const addForm = document.getElementById("addForm");
const addInput = document.getElementById("addInput");
const toggleDarkMode = document.getElementById("toggleDarkMode");
const importBtn = document.getElementById("import");
const exportBtn = document.getElementById("export");
const tabBar = document.getElementById("tabBar");
let currentActiveTab = null;
let selectedSmartFieldType = null;
let selectedSmartFieldFormat = null;
let quillEditor = null;

// Reset both databases
// async function resetDatabases() {
//   try {
//     await db.destroy();
//     console.log("secure_clipboard reset successfully.");

//     await dbTabs.destroy();
//     console.log("secure_clipboard_tabs reset successfully.");

//     // Recreate fresh instances
//     window.db = new PouchDB("secure_clipboard");
//     window.dbTabs = new PouchDB("secure_clipboard_tabs");

//     await renderTabs();
//   } catch (err) {
//     console.error("Error resetting databases:", err);
//   }
// }

// resetDatabases();

async function getSmartFieldFormat(smartFieldId) {
  try {
    const doc = await dbSmartFields.get(smartFieldId);
    return doc.smartFieldFormat || null;
  } catch (err) {
    console.log("Smart field not found:", err);
    return null;
  }
}

async function getOrCreateSmartField(type, format) {
  // Fetch all docs
  const result = await dbSmartFields.allDocs({ include_docs: true });

  // Check for existing combination
  const existing = result.rows.find(
    (row) =>
      row.doc.smartFieldType === type && row.doc.smartFieldFormat === format,
  );

  if (existing) {
    // Combination exists → return its smartFieldId
    return existing.doc.smartFieldId;
  } else {
    // Create new entry
    const newId = `sf_${Date.now()}`;
    const doc = {
      _id: newId,
      smartFieldId: newId,
      smartFieldType: type,
      smartFieldFormat: format,
    };
    await dbSmartFields.put(doc);
    return newId;
  }
}

async function assignSmartField() {
  // Check for nulls before calling
  if (!selectedSmartFieldType || !selectedSmartFieldFormat) {
    console.warn("Smart field type or format not selected.");
    return null; // or handle gracefully (e.g., show error in UI)
  }

  // Safe call
  const sfId = await getOrCreateSmartField(
    selectedSmartFieldType,
    selectedSmartFieldFormat,
  );

  return sfId;
}

async function showDatabases() {
  const items = await db.allDocs({ include_docs: true });
  const tabs = await dbTabs.allDocs({ include_docs: true });
  const smartFields = await dbSmartFields.allDocs({ include_docs: true });
  console.log("=== Tabs DB ===");
  console.log(
    JSON.stringify(
      tabs.rows.map((r) => r.doc),
      null,
      2,
    ),
  );

  console.log("=== Items DB ===");
  console.log(
    JSON.stringify(
      items.rows.map((r) => r.doc),
      null,
      2,
    ),
  );

  console.log("=== Smart Fields DB ===");
  console.log(
    JSON.stringify(
      smartFields.rows.map((r) => r.doc),
      null,
      2,
    ),
  );
}

// showDatabases();

async function ensureGeneralTab() {
  console.log("(start)ensureGeneralTab");
  try {
    await dbTabs.get("tab_general");
    // ✅ Already exists, but also set currentActiveTab
    currentActiveTab = {
      id: "tab_general",
      name: "General",
      color: "#0044cc",
    };
    console.log("currentActiveTab:", currentActiveTab);
    console.log("(end)ensureGeneralTab");
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const generalTab = {
    _id: "tab_general", // consistent id
    name: "General", // display name
    color: "#0044cc",
    order: 0,
  };

  await dbTabs.put(generalTab);
  console.log("General tab recreated.");

  // ✅ Initialize currentActiveTab after creation
  currentActiveTab = {
    id: "tab_general",
    name: "General",
    color: generalTab.color,
  };

  // console.log("currentActiveTab: ", currentActiveTab);
  console.log("(end)ensureGeneralTab");

  await renderTabs();
}

ensureGeneralTab();

async function renderTabs() {
  console.log("--(start) renderTabs--");
  tabBar.innerHTML = "";

  // Load all tabs (General should already exist via ensureGeneralTab at startup)
  const result = await dbTabs.allDocs({ include_docs: true });
  const docs = result.rows.map((r) => r.doc);

  // Sort by order ascending
  docs.sort((a, b) => a.order - b.order);

  for (const tab of docs) {
    const count = await getRecordCount(tab._id);

    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.id = tab._id;
    btn.dataset.name = tab.name;
    btn.style.border = `2px solid ${tab.color}`;
    btn.style.setProperty("--tab-color", tab.color);
    btn.textContent = count > 0 ? `${tab.name} (${count})` : tab.name;

    if (tab._id !== "tab_general") {
      const closeBtn = document.createElement("span");
      closeBtn.className = "close-tab";
      closeBtn.textContent = "×";
      btn.appendChild(closeBtn);
    }

    tabBar.appendChild(btn);
  }

  console.log("--(end) renderTabs--");
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str)));
}

function maskText(text, maxStars = 25) {
  const len = text.length;

  if (len <= 0) return "";
  if (len === 1) return text[0]; // single char, show as is
  if (len === 2) return text[0] + "*"; // ab -> a*
  if (len === 3) return text[0] + "**"; // abc -> a**

  if (len === 4) {
    // Special case: 4 chars -> show first + mask rest
    return text[0] + "*".repeat(len - 1); // wwww -> w***
  }

  // For length >= 5: show first 2 + stars + last 2
  const start = text.slice(0, 2);
  const end = text.slice(-2);
  const starsCount = Math.min(len - 4, maxStars);
  return start + "*".repeat(starsCount) + end;
}

async function loadItems(tabId) {
  console.log("currentActiveTab>>", currentActiveTab);
  console.log("--loadItems (start) --");
  tabId = tabId.toLowerCase();
  console.log("loadItems.param:", tabId);
  itemList.innerHTML = "";
  const result = await db.allDocs({ include_docs: true, descending: true });

  // Filter by tab
  const filtered = result.rows
    .map((r) => r.doc)
    .filter((doc) => !doc._deleted && doc.tab && doc.tab.id === tabId)
    .sort((a, b) => {
      const dateA = new Date(a.lastUsed || a.timestamp || 0).getTime();
      const dateB = new Date(b.lastUsed || b.timestamp || 0).getTime();
      return dateB - dateA;
    });

  if (filtered.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty-state";
    emptyDiv.textContent = "There's no items here yet 👀";
    itemList.appendChild(emptyDiv);
    return;
  }

  filtered.forEach((doc) => {
    let decoded = decodeBase64(doc.data);
    const plainText = stripHTML(decoded);
    const masked = maskText(plainText);
    const itemDiv = document.createElement("div");
    itemDiv.className = "item";

    // Label badge
    if (doc.label) {
      const badge = document.createElement("div");
      // console.log("label badge>>> ", doc);
      badge.textContent =
        doc.smartFieldId != null ? "⚡ " + doc.label : doc.label;
      badge.className = "item-badge";
      badge.style.backgroundColor = doc.color;
      badge.style.cursor = "pointer";

      badge.addEventListener("click", async () => {
        try {
          // Await the async call so you get the actual format string
          const sfFormat = await getSmartFieldFormat(doc.smartFieldId);

          console.log("doc.label>>> ", doc.label);
          console.log("doc.smartFieldId>>> ", doc.smartFieldId);
          console.log("sfFormat>>> ", sfFormat);

          let parsedLabelText =
            doc.smartFieldId != null && sfFormat
              ? formatTextWithDate(doc.label, sfFormat)
              : doc.label;

          console.log("parsedLabelText>>> ", parsedLabelText);

          await navigator.clipboard.writeText(parsedLabelText);

          doc.lastUsed = new Date().toISOString();
          await safeUpdate(doc);

          badge.textContent = "Copied!";
          setTimeout(() => {
            badge.textContent =
              doc.smartFieldId != null ? "⚡ " + doc.label : doc.label;
            loadItems(currentActiveTab.id);
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
          badge.textContent = "Error";
          setTimeout(() => {
            badge.textContent = doc.label;
            loadItems(currentActiveTab.id);
          }, 2000);
        }
      });

      itemDiv.appendChild(badge);
    }

    // Row for text + delete
    const rowDiv = document.createElement("div");
    rowDiv.className = "item-row";

    const span = document.createElement("span");
    const originalText =
      masked + " — " + new Date(doc.timestamp).toLocaleString();
    span.textContent = originalText;
    span.style.cursor = "pointer";

    span.addEventListener("click", async () => {
      try {
        console.log("decoded>>> ", decoded);
        const sfFormat = await getSmartFieldFormat(doc.smartFieldId);
        console.log("doc.smartFieldId>>> ", doc.smartFieldId);
        console.log("sfFormat>>> ", sfFormat);
        decoded = formatTextWithDate(decoded, sfFormat);
        console.log("decoded>>> ", decoded);

        // await navigator.clipboard.writeText(decoded);
        await copyRichText(decoded);

        doc.lastUsed = new Date().toISOString();
        await safeUpdate(doc);

        span.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" 
              width="16" height="16" 
              fill="currentColor" viewBox="0 0 16 16"
              style="vertical-align: middle; margin-right: 4px;">
            <path d="M13.485 1.929a.75.75 0 0 1 1.06 1.06l-8.25 8.25-4.25-4.25a.75.75 0 0 1 1.06-1.06l3.19 3.19 7.19-7.19z"/>
          </svg>Copied!
        `;

        setTimeout(() => {
          span.textContent = originalText;
          loadItems(currentActiveTab.id);
        }, 2000);
      } catch (err) {
        console.error("Copy failed:", err);
        span.textContent = "Error";
        setTimeout(() => {
          span.textContent = originalText;
          loadItems(currentActiveTab.id);
        }, 2000);
      }
    });

    // Create brutalist delete button
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    // Insert SVG icon inside the button
    delBtn.innerHTML = `
      <svg viewBox="0 0 15 17.5" height="17.5" width="15" xmlns="http://www.w3.org/2000/svg" class="icon">
        <path transform="translate(-2.5 -1.25)" d="M15,18.75H5A1.251,1.251,0,0,1,3.75,17.5V5H2.5V3.75h15V5H16.25V17.5A1.251,1.251,0,0,1,15,18.75ZM5,5V17.5H15V5Zm7.5,10H11.25V7.5H12.5V15ZM8.75,15H7.5V7.5H8.75V15ZM12.5,2.5h-5V1.25h5V2.5Z"></path>
      </svg>
    `;

    delBtn.onclick = () => deleteItem(doc._id, doc._rev);

    rowDiv.appendChild(span);
    rowDiv.appendChild(delBtn);
    itemDiv.appendChild(rowDiv);
    itemList.appendChild(itemDiv);

    // ===============================
    // Section Header (Small & Subtle)
    // ===============================
    const existingHeader = itemList.querySelector(".recentlyUsed");
    if (existingHeader) existingHeader.remove();

    if (filtered.length > 0) {
      const header = document.createElement("div");
      header.className = "recentlyUsed";
      header.textContent = "RECENTLY USED";

      itemList.insertBefore(header, itemList.firstChild);
    }

    // ===============================
    // Value-Based "MORE ITEMS" Label
    // ===============================
    const existingSeparator = itemList.querySelector(".more-items-label");
    if (existingSeparator) existingSeparator.remove();

    const SHOW_VALUE_SEPARATOR = true;
    const SEPARATOR_AFTER_INDEX = 1;

    if (SHOW_VALUE_SEPARATOR && filtered.length > SEPARATOR_AFTER_INDEX + 1) {
      const items = itemList.querySelectorAll(".item");
      const targetItem = items[SEPARATOR_AFTER_INDEX];

      if (targetItem) {
        const separator = document.createElement("div");
        separator.className = "more-items-label";
        separator.textContent = "MORE ITEMS";

        targetItem.insertAdjacentElement("afterend", separator);
      }
    }
  });

  console.log(`Loaded items for tab: ${tabId}`);
  console.log("--loadItems (start) --");
}

async function copyDecoded(encoded, doc_id) {
  const text = decodeBase64(encoded);

  try {
    // Reset all copied labels
    document.querySelectorAll(".copied-label").forEach((label) => {
      label.textContent = "";
    });

    // await navigator.clipboard.writeText(text);
    await copyRichText(parsedLabelText);
    // Update the text instead of alert
    // Show "Copied" only on the clicked item's label
    const targetLabel = document.getElementById(doc_id);
    if (targetLabel) {
      targetLabel.innerHTML = `
  <svg xmlns="http://www.w3.org/2000/svg" 
       width="16" height="16" 
       fill="green" viewBox="0 0 16 16">
    <path d="M13.485 1.929a.75.75 0 0 1 1.06 1.06l-8.25 8.25-4.25-4.25a.75.75 0 0 1 1.06-1.06l3.19 3.19 7.19-7.19z"/>
  </svg>
  Copied!
`;
    }
  } catch (err) {
    alert("Failed to copy: " + err);
  }
}

async function copyRichText(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;

  // Attach off-screen so innerText honors block/<br> line breaks per CSS rules
  // (detached elements produce inconsistent results across browsers).
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  temp.style.top = "0";
  document.body.appendChild(temp);
  // contenteditable structures like <div><br>line</div> emit \n\n for one visual
  // line break — collapse to single newlines for plain-text paste targets.
  const plainText = temp.innerText.replace(/\n{2,}/g, "\n");
  document.body.removeChild(temp);

  const blobHTML = new Blob([html], { type: "text/html" });
  const blobText = new Blob([plainText], { type: "text/plain" });

  const data = new ClipboardItem({
    "text/html": blobHTML,
    "text/plain": blobText,
  });

  await navigator.clipboard.write([data]);
}

function stripHTML(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

async function deleteItem(id, rev) {
  try {
    await db.remove(id, rev);

    // Refresh tab counts
    await renderTabs();

    // Restore the active tab after re-render
    const tabName = currentActiveTab?.id || "tab_general";
    console.log("tabName>>> ", currentActiveTab?.id);

    const tabBtn = tabBar.querySelector(`[data-id="${tabName}"]`);
    console.log("tabBtn>>> ", tabBtn);

    // Mark tab as active
    if (tabBtn) {
      tabBtn.classList.add("active");
      tabBtn.style.backgroundColor =
        getComputedStyle(tabBtn).getPropertyValue("--tab-color");
    }

    // Reload items for the active tab
    await loadItems(tabName);
  } catch (err) {
    console.error("Error deleting item:", err);
  }
}

// Modal Controls
closeModalBtn.addEventListener("click", () => (modal.style.display = "none"));

// Modal Backdrop Close
// window.addEventListener("click", (e) => {
//   if (e.target === modal) modal.style.display = "none";
// });

addForm.addEventListener("submit", async (e) => {
  console.log("--(start)addForm.addEventListener--");
  e.preventDefault();

  // --- Smart Mode Validation (Brutalist) ---
  if (enableFormula.checked && selectedSmartFieldType == null) {
    e.preventDefault();

    // Brutalist highlight
    formatToggle.classList.add("brutalist-error");

    // Remove after animation
    setTimeout(() => {
      formatToggle.classList.remove("brutalist-error");
    }, 700);

    return; // stop save
  }

  const label = addLabel.value.trim();

  // Quill normalizes pasted Word HTML via its clipboard module, so cleanWordHTML
  // (which strips ALL inline styles) would destroy Quill's color/background
  // formatting — DOMPurify alone is sufficient on Quill's output.
  let cleanHTML = DOMPurify.sanitize(quillEditor.root.innerHTML);

  const color = addColor.value;
  if (!cleanHTML || quillEditor.getText().trim() === "") return;

  const encoded = encodeBase64(cleanHTML);

  // Use active tab context (default to General if none)
  const tabContext = currentActiveTab || { name: "General", color: "#0044cc" };

  const sfId = await assignSmartField();

  const item = {
    _id: new Date().toISOString(),
    data: encoded,
    label: label,
    timestamp: Date.now(),
    color: color,
    tab: {
      id: tabContext.id.toLowerCase(),
      name: tabContext.name.toLowerCase(),
      color: tabContext.color,
    },
    smartFieldId: sfId,
  };

  await safeUpdate(item);
  await buildSearchIndex(); // refresh search index
  // Reset form
  addLabel.value = "";
  quillEditor.setContents([]);
  modal.style.display = "none";

  console.log("tabContext2:", tabContext);

  // Refresh UI
  await renderTabs();

  // Reset SmartMode
  resetAddForm();

  // Restore active tab styling
  const tabBtn = tabBar.querySelector(`[data-id="${tabContext.id}"]`);
  console.log("tabBtn:", tabBtn);
  if (tabBtn) {
    tabBtn.classList.add("active");
    tabBtn.style.backgroundColor = tabBtn.style.getPropertyValue("--tab-color");
  }

  // Reload items for the active tab
  console.log("tabContext:", tabContext.id);
  loadItems(tabContext.id);
  console.log("--(end)addForm.addEventListener--");
});

// Dark Mode Toggle
const app = document.getElementById("app");

// Dark Mode Toggle
function applyDarkMode(enabled) {
  document.body.classList.toggle("dark", enabled);
  app.classList.toggle("dark", enabled);
  localStorage.setItem("darkMode", enabled ? "1" : "0");
}

toggleDarkMode.addEventListener("click", () => {
  const isDark = app.classList.contains("dark");
  applyDarkMode(!isDark);
});

// restore saved preference
const savedPref = localStorage.getItem("darkMode");
applyDarkMode(savedPref !== "0");

// Save active tab whenever it changes
function setActiveTab(tabName) {
  currentActiveTab = { name: tabName };
  sessionStorage.setItem("activeTab", tabName);
}

// INITIALIZATION

async function initTabsAndItems() {
  await renderTabs();

  const savedTabId = sessionStorage.getItem("activeTab") || "tab_general";
  console.log("savedTabId:", savedTabId);

  const tabBtn = tabBar.querySelector(`[data-id="${savedTabId}"]`);

  if (tabBtn) {
    // Mark tab as active
    tabBtn.classList.add("active");
    tabBtn.style.backgroundColor = tabBtn.style.getPropertyValue("--tab-color");

    // ✅ Initialize currentActiveTab properly
    currentActiveTab = {
      id: savedTabId,
      name: tabBtn.dataset.name, // comes from renderTabs()
      color: tabBtn.style.borderColor || "#0044cc",
    };

    // Load items for this tab
    loadItems(savedTabId);

    // Update label immediately
    const tabLabel = document.getElementById("activeTabLabel");
    if (tabLabel) {
      tabLabel.textContent = currentActiveTab.name;
      tabLabel.style.backgroundColor = currentActiveTab.color;
    }
  }
}

async function initSmartFields() {
  const enableFormula = document.getElementById("enableFormula");
  const formulaOptions = document.getElementById("formulaOptions");

  // Toggle formula options visibility
  enableFormula.addEventListener("change", () => {
    formulaOptions.style.display = enableFormula.checked ? "block" : "none";
  });

  // Valid date formats
  const validFormats = [
    "yyyyMMdd",
    "MM/dd",
    "yyyy-MM-dd",
    "dd-MM-yyyy",
    "MM/dd/yyyy",
    "yyyy/MM/dd",
    "MMMM dd, yyyy",
    "EEE, MMM dd yyyy",
  ];

  // Populate dropdown with examples
  const today = new Date();
  const menu = document.getElementById("dateFormatMenu");
  const toggle = document.querySelector("#dateFormatDropdown .dropdown-toggle");

  validFormats.forEach((fmt) => {
    const li = document.createElement("li");
    li.dataset.value = fmt;
    li.textContent = dateFns.format(today, fmt); // show example
    li.addEventListener("click", () => {
      toggle.textContent = li.textContent; // update button label
      toggle.dataset.value = fmt; // store actual format
    });
    li.addEventListener("click", () => {
      // Update button label
      toggle.textContent = li.textContent;
      toggle.dataset.value = fmt;

      selectedSmartFieldType = li.textContent;
      selectedSmartFieldFormat = fmt;
      // Remove 'selected' from all options
      menu
        .querySelectorAll("li")
        .forEach((opt) => opt.classList.remove("selected"));

      // Add 'selected' to the clicked option
      li.classList.add("selected");
    });

    menu.appendChild(li);
  });
}

// OFFLINE CAPABILITY

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("✅ SW registered"))
      .catch((err) => console.error("❌ SW failed", err));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTabsAndItems();
  initSmartFields();
  initInstallImageZoom();
  initQuillEditor();
  initTabScroll();
});

function initTabScroll() {
  const tabBar = document.getElementById("tabBar");
  const leftBtn = document.getElementById("tabScrollLeft");
  const rightBtn = document.getElementById("tabScrollRight");
  if (!tabBar || !leftBtn || !rightBtn) return;

  function update() {
    const canLeft = tabBar.scrollLeft > 1;
    const canRight =
      tabBar.scrollLeft + tabBar.clientWidth < tabBar.scrollWidth - 1;
    leftBtn.classList.toggle("visible", canLeft);
    rightBtn.classList.toggle("visible", canRight);
  }

  function scrollByPage(direction) {
    const delta = Math.max(80, tabBar.clientWidth * 0.8) * direction;
    tabBar.scrollBy({ left: delta, behavior: "smooth" });
  }

  leftBtn.addEventListener("click", () => scrollByPage(-1));
  rightBtn.addEventListener("click", () => scrollByPage(1));

  // Vertical mouse wheel → horizontal scroll on the tab bar
  tabBar.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      tabBar.scrollLeft += e.deltaY;
    },
    { passive: false },
  );

  tabBar.addEventListener("scroll", update);

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(update).observe(tabBar);
  }
  new MutationObserver(update).observe(tabBar, {
    childList: true,
    subtree: true,
  });

  update();
}

// IMPORT EXPORT
async function exportDB() {
  try {
    // Fetch both DBs
    const [itemsResult, tabsResult, smartFieldsResult] = await Promise.all([
      db.allDocs({ include_docs: true }),
      dbTabs.allDocs({ include_docs: true }),
      dbSmartFields.allDocs({ include_docs: true }),
    ]);

    const items = itemsResult.rows.map((r) => r.doc);
    const tabs = tabsResult.rows.map((r) => r.doc);
    const smartFields = smartFieldsResult.rows.map((r) => r.doc);

    // Prompt for password
    const password = prompt("Enter a password to encrypt the export file:");
    if (!password) {
      alert("Export cancelled: no password provided.");
      return;
    }

    // Prepare combined payload
    const exportData = { items, tabs, smartFields };
    const jsonData = JSON.stringify(exportData);

    // Derive key
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    // Encrypt
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(jsonData),
    );

    // Bundle export payload
    const exportPayload = {
      ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
      iv: uint8ToBase64(iv),
      salt: uint8ToBase64(salt),
      timestamp: new Date().toISOString(),
    };

    // Save file
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `secure_clipboard_export_${exportPayload.timestamp.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);

    alert("Export complete! Items + Tabs encrypted.");
  } catch (err) {
    console.error("Export error:", err);
    alert("Export failed.");
  }
}

async function importDB(file) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const payload = JSON.parse(e.target.result);

      // Prompt for password
      const password = prompt("Enter the password to decrypt the import file:");
      if (!password) {
        alert("Import cancelled: no password provided.");
        return;
      }

      // Decode base64 → Uint8Array
      function b64ToBytes(b64) {
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      }
      const salt = b64ToBytes(payload.salt);
      const iv = b64ToBytes(payload.iv);
      const ciphertext = b64ToBytes(payload.ciphertext);

      // Derive key
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );

      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext,
      );
      const jsonData = new TextDecoder().decode(decrypted);
      const { items, tabs, smartFields } = JSON.parse(jsonData);

      if (
        !confirm(
          "This will clear all existing data (items + tabs) and replace it with the imported file. Continue?",
        )
      ) {
        return;
      }

      // Clear both DBs
      async function clearDB(dbInstance) {
        const allDocs = await dbInstance.allDocs();
        const deletions = allDocs.rows.map((row) => ({
          _id: row.id,
          _rev: row.value.rev,
          _deleted: true,
        }));
        if (deletions.length > 0) {
          await dbInstance.bulkDocs(deletions);
        }
      }
      await clearDB(db);
      await clearDB(dbTabs);

      // Strip _rev and validate schema
      const cleanItems = items.map((doc) => {
        const { _rev, ...cleanDoc } = doc;
        if (!cleanDoc._id) throw new Error("Invalid item: missing _id");
        return cleanDoc;
      });
      const cleanTabs = tabs.map((doc) => {
        const { _rev, ...cleanDoc } = doc;
        if (!cleanDoc._id) throw new Error("Invalid tab: missing _id");
        return cleanDoc;
      });
      const cleanSmartFields = smartFields.map((doc) => {
        const { _rev, ...cleanDoc } = doc;
        if (!cleanDoc._id) throw new Error("Invalid smartfield: missing _id");
        return cleanDoc;
      });

      // Insert fresh
      await db.bulkDocs(cleanItems);
      await dbTabs.bulkDocs(cleanTabs);
      await dbSmartFields.bulkDocs(cleanSmartFields);

      alert("Items + Tabs restored from encrypted file!");

      initTabsAndItems();
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed: wrong password or invalid file.");
    }
  };
  reader.readAsText(file);
}

// Export button
document.getElementById("exportBtn").addEventListener("click", exportDB);

// Import button
document.getElementById("importBtn").addEventListener("click", () => {
  const fileInput = document.getElementById("importFile");
  fileInput.click();

  fileInput.onchange = () => {
    if (fileInput.files.length > 0) {
      importDB(fileInput.files[0]); // will also call loadItems()
      fileInput.value = ""; // reset so onchange will fire again
    } else {
      alert("Please select a file to import.");
    }
  };
});

// const settingsBtn = document.getElementById("settingsBtn");
const newTabBtn = document.getElementById("newTabBtn");
const tabModal = document.getElementById("tabModal");
const closeTabModalBtn = document.getElementById("closeTabModalBtn");

newTabBtn.addEventListener("click", () => {
  tabModal.style.display = "block";
});

closeTabModalBtn.addEventListener("click", () => {
  tabModal.style.display = "none";
});

window.addEventListener("click", (event) => {
  if (event.target === tabModal) {
    tabModal.style.display = "none";
  }
});

async function getRecordCount(tabId) {
  try {
    if (typeof tabId !== "string") {
      console.error("Invalid tabId:", tabId);
      return 0;
    }

    // ✅ Look up tab doc by id to get its name
    const tabDoc = await dbTabs.get(tabId);

    // Count items by tab.name
    const result = await db.allDocs({ include_docs: true });
    const docs = result.rows.map((r) => r.doc);

    const count = docs.filter((doc) => doc.tab && doc.tab.id === tabId).length;
    return count;
  } catch (err) {
    console.error("Error getting record count:", err);
    return 0;
  }
}

// Save Tab
document.getElementById("addTabForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("tabName").value.trim();
  const color = document.getElementById("tabColor").value;
  if (!name) return;

  const newTabId = `tab_${name.toLowerCase()}`;
  const newTab = { _id: newTabId, name, color, order: Date.now() };

  try {
    await dbTabs.put(newTab);
    tabModal.style.display = "none";
    // ✅ Clear all inputs in the form
    document.getElementById("addTabForm").reset();
    // ✅ Wait for renderTabs to finish
    await renderTabs();

    // Now query safely
    const newTabElement = document.querySelector(`.tab[data-id="${newTabId}"]`);

    if (newTabElement) {
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      newTabElement.classList.add("active");
      currentActiveTab = { id: newTabId, name, color };
      loadItems(name);
      newTabElement.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  } catch (err) {
    console.error("Error saving tab:", err);
  }
});

// let currentActiveTab = { name: "General", color: "#0044cc" }; // default

tabBar.addEventListener("click", async (e) => {
  const colorPicker = document.getElementById("addColor");
  colorPicker.value = rgbToHex(currentActiveTab.color);

  // Handle tab close (×)
  if (e.target.classList.contains("close-tab")) {
    e.stopPropagation();

    const parentBtn = e.target.closest(".tab");
    const tabId = parentBtn.dataset.id; // ✅ use _id
    const tabName = parentBtn.textContent.replace("×", "").trim();

    if (!confirm(`Delete tab "${tabName.toUpperCase()}" and all its items?`))
      return;

    try {
      // Remove tab doc
      const tabDoc = await dbTabs.get(tabId);
      if (tabDoc) await dbTabs.remove(tabDoc);

      // Remove items under this tab
      const itemsResult = await db.allDocs({ include_docs: true });
      const toDelete = itemsResult.rows
        .map((r) => r.doc)
        .filter((doc) => doc.tab && doc.tab.id === tabId);

      for (const item of toDelete) {
        await db.remove(item);
      }

      // Re-render tabs
      await renderTabs();

      // ✅ Reset active tab to General with same activation logic
      const generalTab = tabBar.querySelector('[data-id="tab_general"]');
      if (generalTab) {
        document
          .querySelectorAll(".tab")
          .forEach((t) => t.classList.remove("active"));
        generalTab.classList.add("active");
        currentActiveTab = {
          id: "tab_general",
          name: "General",
          color: generalTab.style.borderColor || "#0044cc",
        };

        await loadItems("tab_general");
        generalTab.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      }
    } catch (err) {
      console.error("Error deleting tab:", err);
    }
    return; // prevent falling through to normal tab click
  }

  // Handle normal tab click
  const btn = e.target.closest(".tab");
  if (!btn) return;

  const tabId = btn.dataset.id;
  const tabColor = btn.style.getPropertyValue("--tab-color");
  const tabName = btn.textContent.replace("×", "").trim();

  console.log("tabColor>>> ", tabColor);
  currentActiveTab = { id: tabId, name: tabName, color: tabColor };

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.remove("active");
    t.style.backgroundColor = "";
  });
  btn.classList.add("active");
  btn.style.backgroundColor = tabColor;

  await loadItems(tabId);
});

// When opening modal, show current tab context
// Open Save Item Modal
openModalBtn.addEventListener("click", () => {
  const tabLabel = document.getElementById("activeTabLabel");
  const colorPicker = document.getElementById("addColor");
  const textArea = document.getElementById("addLabel");

  // Update label text + background
  console.log("currentActiveTab:", currentActiveTab);
  tabLabel.textContent = getTabNameFromId(currentActiveTab.id);
  tabLabel.style.backgroundColor = currentActiveTab.color;

  console.log("currentActiveTab.color:", currentActiveTab.color);
  // Update color picker to match tab color
  colorPicker.value = rgbToHex(currentActiveTab.color) || "#0044cc";

  // Show modal
  document.getElementById("modal").style.display = "block";

  // Auto-focus on textarea
  textArea.focus();
});

function getTabNameFromId(tabId) {
  if (!tabId) return "";
  return tabId.startsWith("tab_") ? tabId.slice(4) : tabId;
}

// if (confirm("Are you sure you want to reset all data? This cannot be undone.")) {
//   resetDatabases();
// }
function formatTextWithDate(text, userFormat = "dd-MM-yyyy") {
  console.log("formatTextWithDate.param1>>> ", text);
  console.log("formatTextWithDate.param2>>> ", userFormat);

  return text.replace(/%d([^]*?)%d/g, (_, token) => {
    let date = new Date();

    // Handle relative days
    const minusMatch = token.match(/minus\s+(\d+)/i);
    const plusMatch = token.match(/plus\s+(\d+)/i);

    if (minusMatch) {
      const days = parseInt(minusMatch[1], 10);
      date.setDate(date.getDate() - days);
      return dateFns.format(date, userFormat);
    } else if (plusMatch) {
      const days = parseInt(plusMatch[1], 10);
      date.setDate(date.getDate() + days);
      return dateFns.format(date, userFormat);
    } else {
      // ✅ For any other text (including empty %%), return current date
      return dateFns.format(date, userFormat);
    }
  });
}
const enableFormula = document.getElementById("enableFormula");
const formatToggle = document.querySelector(
  "#dateFormatDropdown .dropdown-toggle",
);
const smartFormatInput = document.getElementById("smartFormatInput");
const formulaOptions = document.getElementById("formulaOptions");

// Toggle Smart Mode
enableFormula.addEventListener("change", () => {
  if (enableFormula.checked) {
    formulaOptions.style.display = "block";
    smartFormatInput.required = true;
  } else {
    formulaOptions.style.display = "none";
    smartFormatInput.required = false;
    smartFormatInput.value = ""; // clear hidden input
    formatToggle.textContent = "Select Format"; // reset UI label
    delete formatToggle.dataset.value; // remove stored value
  }
});

// When user picks a format
document.querySelectorAll("#dateFormatMenu li").forEach((li) => {
  li.addEventListener("click", () => {
    formatToggle.textContent = li.textContent;
    formatToggle.dataset.value = li.dataset.value;
    smartFormatInput.value = li.dataset.value; // set hidden input
  });
});

function resetAddForm() {
  // Smart Mode toggle
  enableFormula.checked = false;

  // Hide formula options
  formulaOptions.style.display = "none";

  // Reset hidden input
  smartFormatInput.value = "";
  smartFormatInput.required = false;

  // Reset dropdown UI
  formatToggle.textContent = "Select Format";
  formatToggle.style.border = "";
  delete formatToggle.dataset.value;

  // Remove any brutalist error state
  formatToggle.classList.remove("brutalist-error");
}

function rgbToHex(color) {
  if (!color) return null;

  // Already full hex (#rrggbb)
  if (/^#([0-9a-f]{6})$/i.test(color)) {
    return color.toLowerCase();
  }

  // Short hex (#rgb) → expand to #rrggbb
  if (/^#([0-9a-f]{3})$/i.test(color)) {
    return (
      "#" +
      color
        .substring(1)
        .split("")
        .map((c) => c + c)
        .join("")
    ).toLowerCase();
  }

  // rgb / rgba
  const result = color.match(/\d+/g);
  if (!result) return null;

  return (
    "#" +
    result
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
  ).toLowerCase();
}

// Recently Used Sorting
async function markAsUsed(docId) {
  try {
    const doc = await db.get(docId);

    // If doc was deleted or invalid
    if (!doc || doc._deleted) return;

    // Always update or initialize lastUsed
    doc.lastUsed = new Date().toISOString();

    await safeUpdate(doc);
  } catch (err) {
    if (err.status !== 404) {
      console.error("Error updating lastUsed:", err);
    }
  }
}

// Installation Button
const installBtn = document.getElementById("installationBtn");
const installModal = document.getElementById("installModal");
const closeInstallModal = document.getElementById("closeInstallModal");

installBtn.addEventListener("click", () => {
  installModal.style.display = "block";
});

closeInstallModal.addEventListener("click", () => {
  installModal.style.display = "none";

  if (panzoomInstance) {
    panzoomInstance.reset();
  }
});

/* PANZOOM */
let panzoomInstance;

/* PANZOOM */
function initInstallImageZoom() {
  const elem = document.getElementById("installImage");

  if (!elem || panzoomInstance) return;

  panzoomInstance = Panzoom(elem, {
    maxScale: 5,
    minScale: 1,
  });

  elem.parentElement.addEventListener("wheel", panzoomInstance.zoomWithWheel);

  elem.addEventListener("dblclick", () => {
    panzoomInstance.zoom(2);
  });

  elem.addEventListener("mousedown", () => {
    elem.style.cursor = "grabbing";
  });

  elem.addEventListener("mouseup", () => {
    elem.style.cursor = "grab";
  });
}

function initQuillEditor() {
  // Switch size & font from class-based (bucketed) to style-based (exact px/family)
  // so pasted Word content keeps its actual sizes, not Quill's small/normal/large.
  const Size = Quill.import("attributors/style/size");
  const Font = Quill.import("attributors/style/font");
  Size.whitelist = null;
  Font.whitelist = null;
  Quill.register(Size, true);
  Quill.register(Font, true);

  // NOTE: quill-better-table is loaded in HTML but not registered here. Its UMD
  // export shape doesn't match Quill 1.3.7's module API in our setup — registering
  // it crashed initQuillEditor (TypeError on .pop() inside the better-table
  // constructor), which left quillEditor null and broke save. Tables paste in
  // linearized form (cells become stacked paragraphs) but every other format
  // (color, background, bold, italic, underline, font-size, images) survives.
  // See follow-up to revisit better-table integration or swap to Quill 2.x.

  quillEditor = new Quill("#editor", {
    placeholder: "Paste plain or formatted text content...",
    theme: "snow",
    modules: { toolbar: false },
  });
}

function cleanWordHTML(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // remove MS Word classes
  doc
    .querySelectorAll('[class^="Mso"]')
    .forEach((el) => el.removeAttribute("class"));

  // remove inline styles
  doc.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));

  // remove empty spans
  doc.querySelectorAll("span").forEach((span) => {
    if (!span.textContent.trim()) span.remove();
  });

  return doc.body.innerHTML;
}

const searchBtn = document.getElementById("searchBtn");
const searchModal = document.getElementById("searchModal");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

// OPEN SEARCH
searchBtn.addEventListener("click", async () => {
  await buildSearchIndex();

  searchModal.style.display = "flex";
  searchInput.focus();
});

// CLOSE SEARCH
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchModal.style.display = "none";
    searchResults.innerHTML = "";
    searchInput.value = "";
  }
});

// LIVE SEARCH
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.innerHTML = "";
    return;
  }

  const results = fuseIndex.search(query).slice(0, 15);

  renderSearchResults(results.map((r) => r.item));
});

function renderSearchResults(items) {
  searchResults.innerHTML = "";

  if (items.length === 0) {
    searchResults.innerHTML =
      "<div class='search-empty-state'>No results</div>";
    return;
  }

  items.forEach((doc) => {
    let decoded = decodeBase64(doc.data);
    const plain = stripHTML(decoded);
    const masked = maskText(plain);

    const itemDiv = document.createElement("div");
    itemDiv.className = "item";

    // LABEL BADGE
    if (doc.label) {
      const badge = document.createElement("div");

      badge.className = "item-badge";
      badge.style.backgroundColor = doc.color;
      badge.style.cursor = "pointer";

      badge.textContent = doc.smartFieldId ? "⚡ " + doc.label : doc.label;

      badge.addEventListener("click", async () => {
        try {
          const sfFormat = await getSmartFieldFormat(doc.smartFieldId);

          let parsedLabelText =
            doc.smartFieldId && sfFormat
              ? formatTextWithDate(doc.label, sfFormat)
              : doc.label;

          await navigator.clipboard.writeText(parsedLabelText);

          badge.textContent = "Copied!";

          setTimeout(() => {
            badge.textContent = doc.smartFieldId
              ? "⚡ " + doc.label
              : doc.label;
          }, 1500);
        } catch (err) {
          badge.textContent = "Error";
        }
      });

      itemDiv.appendChild(badge);
    }

    // ROW
    const rowDiv = document.createElement("div");
    rowDiv.className = "item-row";

    const span = document.createElement("span");

    const originalText =
      masked + " — " + new Date(doc.timestamp).toLocaleString();
    span.textContent = originalText;

    span.style.cursor = "pointer";

    span.addEventListener("click", async () => {
      const sfFormat = await getSmartFieldFormat(doc.smartFieldId);

      decoded = formatTextWithDate(decoded, sfFormat);

      await copyRichText(decoded);

      doc.lastUsed = new Date().toISOString();
      await safeUpdate(doc);

      span.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" 
              width="16" height="16" 
              fill="currentColor" viewBox="0 0 16 16"
              style="vertical-align: middle; margin-right: 4px;">
            <path d="M13.485 1.929a.75.75 0 0 1 1.06 1.06l-8.25 8.25-4.25-4.25a.75.75 0 0 1 1.06-1.06l3.19 3.19 7.19-7.19z"/>
          </svg>Copied!
        `;

      setTimeout(() => {
        span.textContent = originalText;
        loadItems(currentActiveTab.id);
      }, 2000);
      // searchModal.style.display = "none";
      // search content

      loadItems(currentActiveTab.id);
    });

    rowDiv.appendChild(span);

    itemDiv.appendChild(rowDiv);

    searchResults.appendChild(itemDiv);
  });
}

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    searchBtn.click();
  }

  if (e.key === "Escape") {
    searchModal.style.display = "none";
    searchInput.value = "";
    searchResults.innerHTML = "";
  }
});

let fuseIndex = null;
let allSearchDocs = [];

// Build search index
async function buildSearchIndex() {
  const result = await db.allDocs({ include_docs: true });

  const searchable = result.rows
    .map((r) => r.doc)
    .filter((doc) => !doc._deleted)
    .map((doc) => {
      let decoded = "";

      try {
        decoded = decodeBase64(doc.data || "");
      } catch {
        decoded = "";
      }

      const plain = stripHTML(decoded);

      return {
        ...doc,
        searchContent: plain.toLowerCase(),
        searchLabel: (doc.label || "").toLowerCase(),
      };
    });

  fuseIndex = new Fuse(searchable, {
    keys: ["searchLabel", "searchContent"],
    threshold: 0.35,
    includeScore: true,
    ignoreLocation: true,
  });
}

const closeSearchBtn = document.getElementById("closeSearchBtn");

function closeSearch() {
  searchModal.style.display = "none";
  searchInput.value = "";
  searchResults.innerHTML = "";
}

closeSearchBtn.addEventListener("click", closeSearch);

async function safeUpdate(doc) {
  try {
    await db.put(doc);
  } catch (err) {
    if (err.status === 409) {
      const latest = await db.get(doc._id);
      doc._rev = latest._rev;
      await db.put(doc);
    } else {
      console.error(err);
    }
  }
}

function uint8ToBase64(u8) {
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks

  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

const networkBanner = document.getElementById("networkBanner");

function updateNetworkStatus() {
  if (navigator.onLine) {
    networkBanner.textContent = "🟢 You're online!";
    networkBanner.classList.remove("offline");
    networkBanner.classList.add("online", "show");

    // Auto-hide after 2s when back online
    setTimeout(() => {
      networkBanner.classList.remove("show");
    }, 2000);
  } else {
    networkBanner.textContent =
      "⚡Working offline - everything is saved locally!";
    networkBanner.classList.remove("online");
    networkBanner.classList.add("offline", "show");
  }
}

// Listen for changes
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

updateNetworkStatus();
