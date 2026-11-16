"use strict";

/* ==========================================
   TRADELEDGER - COMPLETE REPLACEMENT
   Existing IndexedDB data preserved
========================================== */

const $ = id => document.getElementById(id);

// TradeLedger stable build: existing IndexedDB data preserved.
const TRADELEDGER_BUILD = "20261116-2330";

const DB_NAME = "TradeLedgerDB";
const SETTINGS_KEY = "TradeLedgerColumnSettings";
const MODE_SETTINGS_KEY = "TradeLedgerModeFieldSettings";
const DRIVE_CONNECTION_KEY = "TradeLedgerDriveConnection";
const REPORTS_KEY = "TradeLedgerReports";
const REPORT_SETTINGS_KEY = "TradeLedgerReportSettings";
const BROKER_DATA_KEY = "TradeLedgerBrokerTransactions";

const GOOGLE_CLIENT_ID =
  "396461936533-4ku2jc0qecn82ge1n2ohguq9ih1p5n68.apps.googleusercontent.com";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "TradeLedger Backups";
const DRIVE_BACKUP_NAME = "TradeLedger-Backup.json";

let db = null;
let trades = [];
let fields = [];
let currentMode = "intraday";
let currentSection = "dashboardSection";
let editingTradeId = null;
let currentAttachments = [];

let currentReportPeriod = "daily";
let selectedReportCell = null;
let selectedReportColumn = null;
let reportData = {};
let reportSettings = {};
let brokerData = {headings:["Date","Amount Paid","Amount Received"],rows:[],widths:[120,150,170],rowHeights:{},cells:{},columnStyles:{},defaultStyle:{}};
let selectedBrokerCell = null;
let selectedBrokerColumn = null;

let driveAccessToken = null;
let driveTokenClient = null;
let driveFolderId = null;
let driveBackupFileId = null;
let drivePendingResolve = null;
let drivePendingReject = null;

let eventsInitialized = false;
let databaseReady = false;
let databaseReadyPromise = null;
let tradeLedgerBooted = false;

const STANDARD_FIELDS = [
  {key:"date",label:"Date",section:"basic",type:"date"},
  {key:"exitDate",label:"Exit Date",section:"basic",type:"date"},
  {key:"voucherNumber",label:"Voucher Number",section:"basic",type:"text"},
  {key:"stockName",label:"Stock Name",section:"basic",type:"text"},
  {key:"capital",label:"Capital",section:"basic",type:"number"},
  {key:"leverage",label:"Leverage",section:"basic",type:"number"},
  {key:"strategy",label:"Strategy",section:"basic",type:"text"},
  {key:"riskReward",label:"Risk / Reward",section:"basic",type:"text"},
  {key:"tradeResult",label:"Trade Result",section:"basic",type:"text"},
  {key:"buyQty",label:"Buy Quantity",section:"buy",type:"number"},
  {key:"buyPrice",label:"Buy Price",section:"buy",type:"number"},
  {key:"buyStockValue",label:"Buy Stock Value",section:"buy",type:"number"},
  {key:"buyCharge",label:"Buy Charges",section:"buy",type:"number"},
  {key:"extraBuyCharge",label:"Extra Buy Charges",section:"buy",type:"number"},
  {key:"totalBuyCharges",label:"Total Buy Charges",section:"buy",type:"number"},
  {key:"totalBuyValue",label:"Total Buy Value",section:"buy",type:"number"},
  {key:"sellQty",label:"Sell Quantity",section:"sell",type:"number"},
  {key:"sellPrice",label:"Sell Price",section:"sell",type:"number"},
  {key:"sellStockValue",label:"Sell Stock Value",section:"sell",type:"number"},
  {key:"sellCharge",label:"Sell Charges",section:"sell",type:"number"},
  {key:"extraSellCharge",label:"Extra Sell Charges",section:"sell",type:"number"},
  {key:"totalSellCharges",label:"Total Sell Charges",section:"sell",type:"number"},
  {key:"totalSellValue",label:"Total Sell Value",section:"sell",type:"number"},
  {key:"priceMovement",label:"Price Movement",section:"pl",type:"number"},
  {key:"grossPL",label:"Gross Profit / Loss",section:"pl",type:"number"},
  {key:"totalCharges",label:"Total Charges",section:"pl",type:"number"},
  {key:"netPL",label:"Net Profit / Loss",section:"pl",type:"number"},
  {key:"notes",label:"Notes",section:"attachments",type:"textarea"}
];

const REPORT_HEADINGS = {
  daily:["Voucher Number","Date","Gross Profit","Charges","Net Profit"],
  weekly:["Voucher Number","Weeks","Gross Profit","Charges","Net Profit"],
  monthly:["Voucher Number","Month","Gross Profit","Charges","Net Profit"],
  yearly:["Voucher Number","Year","Gross Profit","Charges","Net Profit"]
};

const SPREADSHEET_DEFAULT_STYLE = {
  color:"#edf3fc",
  background:"#111c2e",
  fontSize:14,
  fontFamily:"Arial",
  align:"left",
  vertical:"middle",
  wrap:true
};

function cloneSpreadsheetStyle(style) {
  return {...SPREADSHEET_DEFAULT_STYLE,...(style || {})};
}

const SECTION_INFO = {
  basic:{container:"basicFieldsContainer",custom:"customBasicFields"},
  buy:{container:"buyFieldsContainer",custom:"customBuyFields"},
  sell:{container:"sellFieldsContainer",custom:"customSellFields"},
  pl:{container:"plFieldsContainer",custom:"customPLFields"},
  attachments:{container:"attachmentFieldsContainer",custom:"customAttachmentFields"}
};

/* ==========================================
   UTILITIES
========================================== */

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}

function numberValue(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value) {
  return "₹" + numberValue(value).toFixed(2);
}

function makeId() {
  return "TL-" + Date.now().toString(36) +
    "-" + Math.random().toString(36).slice(2,8);
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"),2800);
}

function readJSON(key,fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch(error) {
    console.error("JSON read error:",key,error);
    return fallback;
  }
}

function writeJSON(key,value) {
  localStorage.setItem(key,JSON.stringify(value));
}

function getFormValue(id) {
  return $(id)?.value ?? "";
}

function requireDatabase() {
  if (!db || !databaseReady) throw new Error("Database is not ready.");
}

async function waitForDatabase() {
  if (databaseReady && db) return;
  if (databaseReadyPromise) await databaseReadyPromise;
  requireDatabase();
}

/* ==========================================
   INDEXED DB
   Existing stores are never deleted.
========================================== */

function requestResult(request) {
  return new Promise((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("IndexedDB request failed.")
    );
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve,reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("Database transaction failed.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Database transaction aborted.")
    );
  });
}

function createMissingStores(database) {
  if (!database.objectStoreNames.contains("trades")) {
    database.createObjectStore("trades",{keyPath:"id"});
  }
  if (!database.objectStoreNames.contains("fields")) {
    database.createObjectStore("fields",{keyPath:"id"});
  }
  if (!database.objectStoreNames.contains("reports")) {
    database.createObjectStore("reports",{keyPath:"id"});
  }
}

async function openDatabase() {
  databaseReady = false;
  const first = await requestResult(indexedDB.open(DB_NAME));
  const required = ["trades","fields","reports"];
  const missing = required.some(name => !first.objectStoreNames.contains(name));

  if (!missing) {
    db = first;
  } else {
    const oldVersion = first.version;
    first.close();

    db = await new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME,oldVersion + 1);
      request.onupgradeneeded = event => createMissingStores(event.target.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(
        request.error || new Error("Database upgrade failed.")
      );
      request.onblocked = () => reject(
        new Error("Database upgrade is blocked. Close other TradeLedger tabs.")
      );
    });
  }

  for (const name of required) {
    if (!db.objectStoreNames.contains(name)) {
      db.close();
      db = null;
      throw new Error("Required database store missing: " + name);
    }
  }

  db.onversionchange = () => {
    databaseReady = false;
    db.close();
    showToast("Database updated. Reload TradeLedger.");
  };

  return db;
}

async function getAllFromStore(storeName) {
  if (!db || !db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readonly");
  return requestResult(transaction.objectStore(storeName).getAll());
}

async function putIntoStore(storeName,value) {
  await waitForDatabase();
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(storeName).put(value);
  await done;
}

async function deleteFromStore(storeName,id) {
  await waitForDatabase();
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error("Database store unavailable: " + storeName);
  }
  const transaction = db.transaction(storeName,"readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(storeName).delete(id);
  await done;
}

async function loadDatabaseData() {
  trades = await getAllFromStore("trades");
  fields = await getAllFromStore("fields");
  ensureModeFieldSettings();
  reportData = readJSON(REPORTS_KEY,{});
  reportSettings = readJSON(REPORT_SETTINGS_KEY,{});

  ["daily","weekly","monthly","yearly"].forEach(period => {
    if (!Array.isArray(reportData[period])) reportData[period] = [];
  });
  loadBrokerData();
}

/* ==========================================
   REPORT STORAGE
========================================== */

function saveReportsLocally() {
  writeJSON(REPORTS_KEY,reportData);
  writeJSON(REPORT_SETTINGS_KEY,reportSettings);
}

async function saveReportToDatabase() {
  await putIntoStore("reports",{
    id:"main-reports",
    data:reportData,
    settings:reportSettings,
    updatedAt:new Date().toISOString()
  });
  saveReportsLocally();
}

async function loadReportsFromDatabase() {
  const records = await getAllFromStore("reports");
  const saved = records.find(item => item.id === "main-reports");

  if (saved) {
    reportData = saved.data || reportData;
    reportSettings = saved.settings || reportSettings;
  }

  ["daily","weekly","monthly","yearly"].forEach(period => {
    if (!Array.isArray(reportData[period])) reportData[period] = [];
  });
  loadBrokerData();

  saveReportsLocally();
}

/* ==========================================
   TRADING MODE / NAVIGATION
========================================== */

function ensureModeFieldManagerSections() {
  const base = $("fieldManagerSection");
  const intraday = $("intradayWorkspace");
  if (!base || !intraday) return;

  const definitions = [
    ["swingWorkspace", "swingFieldManagerSection", "swingFieldManagerList", "swingAddFieldBtn"],
    ["longtermWorkspace", "longtermFieldManagerSection", "longtermFieldManagerList", "longtermAddFieldBtn"]
  ];

  definitions.forEach(([workspaceId, sectionId, listId, buttonId]) => {
    const workspace = $(workspaceId);
    if (!workspace || $(sectionId)) return;
    const clone = base.cloneNode(true);
    clone.id = sectionId;
    const list = clone.querySelector("#fieldManagerList");
    if (list) {
      list.id = listId;
      list.classList.add("mode-field-manager-list");
    }
    const addButton = clone.querySelector("#addFieldBtn");
    if (addButton) {
      addButton.id = buttonId;
      addButton.classList.add("mode-add-field-btn");
    }
    workspace.appendChild(clone);
    const navButton = workspace.querySelector('[data-section="fieldManagerSection"]');
    if (navButton) navButton.dataset.section = sectionId;
  });

  const baseList = base.querySelector("#fieldManagerList");
  if (baseList) baseList.classList.add("mode-field-manager-list");
  const baseButton = base.querySelector("#addFieldBtn");
  if (baseButton) baseButton.classList.add("mode-add-field-btn");
}

function getModeFieldManagerSectionId(mode = currentMode) {
  if (mode === "swing") return "swingFieldManagerSection";
  if (mode === "longterm") return "longtermFieldManagerSection";
  return "fieldManagerSection";
}

function mountSharedTradeSections(workspaceId) {
  const workspace = $(workspaceId);
  const form = $("tradeFormSection");
  const journal = $("tradeJournalSection");
  const period = $("periodOverviewSection");
  const reports = $("reportsSection");
  const fieldManager = $(getModeFieldManagerSectionId());
  if (!workspace || !form || !journal || !period || !reports || !fieldManager) return;

  // Keep the shared data logic, but always mount the visible sections only
  // inside the active workspace. This prevents Swing/Long Term from showing
  // Add Trade/Journal/Period/Reports/Field Manager underneath Dashboard.
  [form,journal,period,reports,fieldManager].forEach(section => {
    section.classList.remove("active");
    section.classList.add("hidden");
    section.parentElement?.appendChild(section);
  });

  workspace.appendChild(form);
  workspace.appendChild(journal);
  workspace.appendChild(period);
  workspace.appendChild(reports);
  workspace.appendChild(fieldManager);

  [form,journal,period,reports,fieldManager].forEach(section => {
    section.classList.remove("active");
    section.classList.add("hidden");
  });

  renderStandardFormFields();
  renderCustomFormFields();
  renderJournal();
  renderPeriodOverview();
  renderFieldList();
}

function setModeNav(sectionId) {
  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionId || button.dataset.modeDashboard === sectionId);
  });
}

function setWorkspaceTitle(mode) {
  const title = $("workspaceModeTitle");
  const subtitle = $("workspaceModeSubtitle");
  if (!title || !subtitle) return;
  const labels = {
    intraday:["Intraday Trading","Intraday trade journal"],
    swing:["Swing Trading","Swing trade journal"],
    longterm:["Long Term Trading","Long-term investment journal"]
  };
  const value = labels[mode] || labels.intraday;
  title.textContent = value[0];
  subtitle.textContent = value[1];
}

function setTradingMode(mode) {
  if (!["intraday","swing","longterm","broker","backup","install"].includes(mode)) return;

  currentMode = mode;
  ensureModeFieldSettings();
  document.querySelectorAll(".mode-btn").forEach(button => {
    button.classList.toggle("active",button.dataset.mode === mode);
  });

  ["intradayWorkspace","swingWorkspace","longtermWorkspace","brokerWorkspace","backupWorkspace","installWorkspace"].forEach(id => $(id)?.classList.add("hidden"));

  if (mode === "broker") {
    $("brokerWorkspace")?.classList.remove("hidden");
    currentSection = "brokerWorkspace";
    renderBrokerSheet();
    return;
  }

  if (mode === "install") {
    $("installWorkspace")?.classList.remove("hidden");
    currentSection = "installWorkspace";
    return;
  }

  if (mode === "backup") {
    $("backupWorkspace")?.classList.remove("hidden");
    currentSection = "backupWorkspace";
    updateDriveStatus();
    return;
  }

  // Add Trade and Journal are shared sections. Move the same DOM nodes into
  // the active trading workspace so IndexedDB data, Field Manager, custom
  // fields, attachments and calculations remain one unified implementation.
  const workspaceId = mode === "intraday" ? "intradayWorkspace" : mode === "swing" ? "swingWorkspace" : "longtermWorkspace";
  mountSharedTradeSections(workspaceId);
  $(workspaceId)?.classList.remove("hidden");
  setWorkspaceTitle(mode);

  if (mode === "swing" || mode === "longterm") {
    const dashboardId = mode === "swing" ? "swingDashboardSection" : "longtermDashboardSection";
    currentSection = dashboardId;
    const workspace = $(workspaceId);
    workspace?.querySelectorAll(".page-section").forEach(section => {
      const active = section.id === dashboardId;
      section.classList.toggle("active", active);
      section.classList.toggle("hidden", !active);
    });
    setModeNav(dashboardId);
    renderModeDashboard(mode);
  } else {
    if (["swingDashboardSection","longtermDashboardSection"].includes(currentSection)) currentSection = "dashboardSection";
    showSection(currentSection);
  }

  if (mode !== "backup") {
    renderDashboard();
    renderJournal();
    renderFieldList();
  }
}

function getPerformanceDate(trade) {
  // Intraday keeps the entry/trade date. Swing and Long Term use Exit Date
  // for performance ordering and period-based views, with a safe fallback
  // to the existing trade date for older records.
  if (currentMode === "swing" || currentMode === "longterm") {
    return trade.exitDate ||
      trade.customValues?.exitDate ||
      trade.customValues?.exit_date ||
      trade.date ||
      "";
  }
  return trade.date || "";
}

function getDashboardDate(trade) {
  return getPerformanceDate(trade);
}

function renderModeDashboard(mode) {
  const list = trades.filter(trade => (trade.mode || "intraday") === mode);
  const total = list.length;
  const gross = list.reduce((s,t) => s + numberValue(t.grossPL),0);
  const charges = list.reduce((s,t) => s + numberValue(t.totalCharges),0);
  const net = list.reduce((s,t) => s + numberValue(t.netPL),0);
  const wins = list.filter(t => numberValue(t.netPL) > 0).length;
  const losses = list.filter(t => numberValue(t.netPL) < 0).length;
  const winRate = total ? wins / total * 100 : 0;
  const lossRate = total ? losses / total * 100 : 0;
  const prefix = mode === "swing" ? "swing" : "longterm";
  const values = {
    [`${prefix}DashTotalTrades`]: total,
    [`${prefix}DashWins`]: wins,
    [`${prefix}DashLosses`]: losses,
    [`${prefix}DashWinRate`]: winRate.toFixed(1) + "%",
    [`${prefix}DashLossRate`]: lossRate.toFixed(1) + "%",
    [`${prefix}DashGrossPL`]: money(gross),
    [`${prefix}DashCharges`]: money(charges),
    [`${prefix}DashNetPL`]: money(net)
  };
  Object.entries(values).forEach(([id,value]) => {
    if ($(id)) $(id).textContent = value;
  });
  const netEl = $(`${prefix}DashNetPL`);
  if (netEl) netEl.className = net >= 0 ? "profit" : "loss";
}

function renderModeWorkspace() {
  renderModeDashboard(currentMode);
}

function showSection(sectionId) {
  const target = $(sectionId);
  if (!target) {
    console.warn("TradeLedger section not found:",sectionId);
    return;
  }

  currentSection = sectionId;

  // Workspaces contain mode-specific dashboard sections plus the shared
  // Add Trade / Journal sections. Scope the active-state change to the
  // currently visible workspace so another hidden workspace cannot override
  // the section that was just selected.
  const activeWorkspace = $(
    currentMode === "intraday" ? "intradayWorkspace" :
    currentMode === "swing" ? "swingWorkspace" :
    currentMode === "longterm" ? "longtermWorkspace" :
    "backupWorkspace"
  );

  if (activeWorkspace) {
    activeWorkspace.querySelectorAll(".page-section").forEach(section => {
      const active = section === target;
      section.classList.toggle("active", active);
      section.classList.toggle("hidden", !active);
    });

    activeWorkspace.querySelectorAll(".nav-btn").forEach(button => {
      button.classList.toggle("active",
        button.dataset.section === sectionId ||
        button.dataset.modeDashboard === sectionId
      );
    });
  } else {
    document.querySelectorAll(".page-section").forEach(section => {
      section.classList.toggle("active",section.id === sectionId);
    });
  }

  if (sectionId === "reportsSection") renderReportTable();
  if (sectionId === "fieldManagerSection") {
    renderFieldList();
    // Ensure the active mode's Field Manager content is mounted and visible.
    const activeWorkspace = currentMode === "intraday" ? $("intradayWorkspace") :
      currentMode === "swing" ? $("swingWorkspace") : $("longtermWorkspace");
    const fm = activeWorkspace?.querySelector("#fieldManagerSection");
    if (fm) fm.classList.add("active");
  }
  if (sectionId === "tradeFormSection") {
    renderStandardFormFields();
    renderCustomFormFields();
    calculateTrade();
  }
  if (sectionId === "tradeJournalSection") renderJournal();
  if (sectionId === "periodOverviewSection") renderPeriodOverview();
}

/* ==========================================
   TRADE CALCULATIONS
========================================== */

function calculateTrade() {
  const buyQty = numberValue($("buyQty")?.value);
  const buyPrice = numberValue($("buyPrice")?.value);
  const buyCharge = numberValue($("buyCharge")?.value);
  const extraBuyCharge = numberValue($("extraBuyCharge")?.value);
  const sellQty = numberValue($("sellQty")?.value);
  const sellPrice = numberValue($("sellPrice")?.value);
  const sellCharge = numberValue($("sellCharge")?.value);
  const extraSellCharge = numberValue($("extraSellCharge")?.value);

  const buyStockValue = buyQty * buyPrice;
  const sellStockValue = sellQty * sellPrice;
  const totalBuyCharges = buyCharge + extraBuyCharge;
  const totalSellCharges = sellCharge + extraSellCharge;
  const totalBuyValue = buyStockValue + totalBuyCharges;
  const totalSellValue = sellStockValue - totalSellCharges;
  const matchedQty = Math.min(buyQty,sellQty);
  const grossPL = matchedQty * (sellPrice - buyPrice);
  const totalCharges = totalBuyCharges + totalSellCharges;
  const netPL = grossPL - totalCharges;
  const priceMovement = sellPrice - buyPrice;

  const values = {
    buyStockValue,totalBuyCharges,totalBuyValue,
    sellStockValue,totalSellCharges,totalSellValue,
    priceMovement,grossPL,totalCharges,netPL
  };

  Object.entries(values).forEach(([id,value]) => {
    const target = $(
      id === "grossPL" ? "grossPLInput" :
      id === "totalCharges" ? "totalChargesInput" :
      id === "netPL" ? "netPLInput" : id
    );
    if (target) target.value = value.toFixed(2);
  });

  return values;
}

/* ==========================================
   TRADE FORM / CUSTOM FIELD VALUES
========================================== */

function getCustomFieldValues() {
  const existing = editingTradeId
    ? (trades.find(item => item.id === editingTradeId)?.customValues || {})
    : {};
  const values = {...existing};
  fields.filter(field => (field.mode || "intraday") === currentMode).forEach(field => {
    const element = $("custom_" + field.id);
    if (element) values[field.id] = element.value;
  });
  return values;
}

function getStandardFieldSettings(key) {
  return getFieldSettings()[key] || {};
}

function isStandardFieldDeleted(key) {
  return Boolean(getStandardFieldSettings(key).deleted);
}

function isStandardFieldHidden(key) {
  return Boolean(getStandardFieldSettings(key).hidden);
}

function getStandardFieldPosition(key) {
  const saved = getStandardFieldSettings(key);
  const defaultPosition = getModeStandardFields().findIndex(item => item.key === key) + 1;
  return numberValue(saved.position) || defaultPosition;
}

function getStandardFieldsForForm() {
  return getModeStandardFields()
    .filter(field => !isStandardFieldDeleted(field.key))
    .sort((a,b) => getStandardFieldPosition(a.key) - getStandardFieldPosition(b.key));
}

function getAllJournalFields() {
  const settings = getFieldSettings();
  const standard = getModeStandardFields()
    .filter(field => !settings[field.key]?.deleted && !settings[field.key]?.hidden)
    .map(field => ({
      key:field.key,
      label:settings[field.key]?.label || field.label,
      type:field.type,
      standard:true,
      position:getStandardFieldPosition(field.key)
    }));

  const custom = fields
    .filter(field => (field.mode || "intraday") === currentMode && field.inForm !== false && !field.hidden)
    .map(field => ({
      key:"custom:" + field.id,
      customId:String(field.id),
      label:field.label || field.name || "Custom Field",
      type:field.type || "text",
      standard:false,
      position:numberValue(field.position) || 9999
    }));

  return [...standard,...custom].sort((a,b) => a.position - b.position || String(a.key).localeCompare(String(b.key)));
}

function createStandardInput(field) {
  const settings = getStandardFieldSettings(field.key);
  const label = field.key === "date" ? "Entry Date" : (settings.label || field.label);
  const placeholder = settings.placeholder || "";
  const readonly = ["buyStockValue","totalBuyCharges","totalBuyValue","sellStockValue","totalSellCharges","totalSellValue","priceMovement","grossPL","totalCharges","netPL"].includes(field.key);

  const labelElement = document.createElement("label");
  if (field.key === "notes") labelElement.classList.add("full-width");
  labelElement.dataset.standardField = field.key;
  labelElement.appendChild(document.createTextNode(label + (field.type === "number" ? " (₹)" : "")));

  let input;
  if (field.key === "tradeResult") {
    input = document.createElement("select");
    input.innerHTML = '<option value="">Select result</option><option value="Win">Win</option><option value="Loss">Loss</option><option value="Breakeven">Breakeven</option>';
  } else if (field.type === "select") {
    input = document.createElement("select");
    const options = Array.isArray(field.options) ? field.options : [];
    input.innerHTML = '<option value="">Select</option>' + options.map(option => `<option value="${safeText(option)}">${safeText(option)}</option>`).join("");
  } else if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else {
    input = document.createElement("input");
    input.type = field.type === "number" ? "number" : field.type;
    if (field.type === "number") input.step = "any";
    if (["capital","buyQty","sellQty","buyCharge","extraBuyCharge","sellCharge","extraSellCharge","leverage"].includes(field.key)) input.min = "0";
  }

  input.id = field.key === "date" ? "tradeDate" : field.key === "grossPL" ? "grossPLInput" : field.key === "totalCharges" ? "totalChargesInput" : field.key === "netPL" ? "netPLInput" : field.key;
  input.placeholder = placeholder;
  input.readOnly = readonly;
  if (field.key === "tradeDate") input.required = true;
  if (field.key === "exitDate" && currentMode !== "intraday") input.required = true;
  if (field.key === "stockName") input.required = true;
  if (field.key === "leverage" && !input.value) input.value = "1";
  if (["buyCharge","extraBuyCharge","sellCharge","extraSellCharge"].includes(field.key) && !input.value) input.value = "0";
  labelElement.appendChild(input);
  return labelElement;
}

function renderStandardFormFields() {
  Object.values(SECTION_INFO).forEach(info => {
    const container = $(info.container);
    if (container) container.innerHTML = "";
  });

  getStandardFieldsForForm().forEach(field => {
    const info = SECTION_INFO[field.section];
    const container = info ? $(info.container) : null;
    if (!container) return;
    container.appendChild(createStandardInput(field));
  });

  // Attachment controls remain standard UI controls but are not trade-value fields.
  const attachmentContainer = $(SECTION_INFO.attachments.container);
  if (attachmentContainer) {
    const chart = document.createElement("label");
    chart.innerHTML = 'Chart Images<input type="file" id="chartImages" accept="image/*" multiple>';
    attachmentContainer.appendChild(chart);
    const contract = document.createElement("label");
    contract.innerHTML = 'Contract Note<input type="file" id="contractNote" accept="image/*,.pdf">';
    attachmentContainer.appendChild(contract);
    const info = document.createElement("div");
    info.id = "attachmentInfo";
    info.className = "full-width muted-text";
    attachmentContainer.appendChild(info);
  }

  const tradeDate = $("tradeDate");
  if (tradeDate && !tradeDate.value) tradeDate.value = new Date().toISOString().slice(0,10);
  ["buyQty","buyPrice","buyCharge","extraBuyCharge","sellQty","sellPrice","sellCharge","extraSellCharge"].forEach(id => {
    $(id)?.addEventListener("input",calculateTrade);
  });
  $("chartImages")?.addEventListener("change",handleAttachmentChange);
  $("contractNote")?.addEventListener("change",handleAttachmentChange);
}


function renderCustomFormFields() {
  Object.values(SECTION_INFO).forEach(info => {
    const container = $(info.custom);
    if (container) container.innerHTML = "";
  });

  const ordered = [...fields]
    .filter(field => (field.mode || "intraday") === currentMode && field.inForm !== false)
    .sort((a,b) => numberValue(a.position) - numberValue(b.position) || String(a.id).localeCompare(String(b.id)));

  ordered.forEach(field => {
    const info = SECTION_INFO[field.section] || SECTION_INFO.basic;
    const container = $(info.custom);
    if (!container) return;

    const label = document.createElement("label");
    label.dataset.customField = String(field.id);
    if (field.type === "textarea") label.classList.add("full-width");
    label.appendChild(document.createTextNode(field.label || field.name || "Custom Field"));

    let input;
    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else if (field.type === "select") {
      input = document.createElement("select");
      const options = Array.isArray(field.options) ? field.options : [];
      input.innerHTML = '<option value="">Select</option>' + options.map(option =>
        `<option value="${safeText(option)}">${safeText(option)}</option>`
      ).join("");
    } else {
      input = document.createElement("input");
      input.type = ["number","date","text","email","url","tel"].includes(field.type) ? field.type : "text";
      if (field.type === "number") input.step = "any";
    }

    input.id = "custom_" + field.id;
    input.name = "custom_" + field.id;
    input.placeholder = field.placeholder || "";
    input.required = Boolean(field.required);
    label.appendChild(input);
    container.appendChild(label);
  });
}

function collectTradeData() {
  const calculated = calculateTrade();
  return {
    id:editingTradeId || makeId(),
    mode:currentMode,
    date:getFormValue("tradeDate"),
    exitDate:currentMode === "intraday" ? "" : getFormValue("exitDate"),
    voucherNumber:getFormValue("voucherNumber"),
    stockName:getFormValue("stockName"),
    capital:numberValue(getFormValue("capital")),
    leverage:currentMode === "intraday" ? numberValue(getFormValue("leverage")) : 0,
    strategy:getFormValue("strategy"),
    riskReward:getFormValue("riskReward"),
    tradeResult:getFormValue("tradeResult"),
    buyQty:numberValue(getFormValue("buyQty")),
    buyPrice:numberValue(getFormValue("buyPrice")),
    buyStockValue:calculated.buyStockValue,
    buyCharge:numberValue(getFormValue("buyCharge")),
    extraBuyCharge:numberValue(getFormValue("extraBuyCharge")),
    totalBuyCharges:calculated.totalBuyCharges,
    totalBuyValue:calculated.totalBuyValue,
    sellQty:numberValue(getFormValue("sellQty")),
    sellPrice:numberValue(getFormValue("sellPrice")),
    sellStockValue:calculated.sellStockValue,
    sellCharge:numberValue(getFormValue("sellCharge")),
    extraSellCharge:numberValue(getFormValue("extraSellCharge")),
    totalSellCharges:calculated.totalSellCharges,
    totalSellValue:calculated.totalSellValue,
    priceMovement:calculated.priceMovement,
    grossPL:calculated.grossPL,
    totalCharges:calculated.totalCharges,
    netPL:calculated.netPL,
    notes:getFormValue("notes"),
    customValues:getCustomFieldValues(),
    attachments:currentAttachments,
    updatedAt:new Date().toISOString()
  };
}

async function saveTrade(event) {
  event.preventDefault();

  if (!getFormValue("stockName").trim()) {
    showToast("Please enter stock name.");
    return;
  }

  const trade = collectTradeData();

  if (!trade.date) {
    showToast("Please select trade date.");
    return;
  }
  if (trade.buyQty < 0 || trade.sellQty < 0) {
    showToast("Quantity cannot be negative.");
    return;
  }
  if (trade.sellQty > trade.buyQty) {
    showToast("Sell quantity cannot exceed buy quantity.");
    return;
  }

  try {
    const index = trades.findIndex(item => item.id === trade.id);
    if (index < 0) trade.createdAt = new Date().toISOString();

    await putIntoStore("trades",trade);

    if (index >= 0) trades[index] = trade;
    else trades.push(trade);

    showToast(index >= 0 ? "Trade updated." : "Trade saved.");
    resetForm();
    await renderEverything();
    showSection("tradeJournalSection");
  } catch(error) {
    console.error(error);
    showToast("Unable to save trade: " + error.message);
  }
}

function resetForm() {
  $("tradeForm")?.reset();
  editingTradeId = null;
  currentAttachments = [];

  if ($("tradeId")) $("tradeId").value = "";
  if ($("leverage")) $("leverage").value = "1";

  ["buyCharge","extraBuyCharge","sellCharge","extraSellCharge"].forEach(id => {
    if ($(id)) $(id).value = "0";
  });

  if ($("tradeFormTitle")) $("tradeFormTitle").textContent = "Add Trade";
  if ($("saveTradeBtn")) $("saveTradeBtn").textContent = "Save Trade";
  if ($("attachmentInfo")) $("attachmentInfo").textContent = "";

  renderCustomFormFields();
  calculateTrade();
}

function editTrade(id) {
  const trade = trades.find(item => item.id === id);
  if (!trade) return;

  editingTradeId = id;
  currentMode = trade.mode || "intraday";
  setTradingMode(currentMode);

  const mapping = {
    tradeDate:trade.date,
    exitDate:trade.exitDate || "",
    voucherNumber:trade.voucherNumber,
    stockName:trade.stockName,
    capital:trade.capital,
    leverage:trade.leverage,
    strategy:trade.strategy,
    riskReward:trade.riskReward,
    tradeResult:trade.tradeResult,
    buyQty:trade.buyQty,
    buyPrice:trade.buyPrice,
    buyCharge:trade.buyCharge,
    extraBuyCharge:trade.extraBuyCharge,
    sellQty:trade.sellQty,
    sellPrice:trade.sellPrice,
    sellCharge:trade.sellCharge,
    extraSellCharge:trade.extraSellCharge,
    notes:trade.notes
  };

  Object.entries(mapping).forEach(([key,value]) => {
    if ($(key)) $(key).value = value ?? "";
  });

  if ($("tradeId")) $("tradeId").value = trade.id;

  currentAttachments = Array.isArray(trade.attachments)
    ? [...trade.attachments] : [];

  renderCustomFormFields();

  fields.filter(field => (field.mode || "intraday") === currentMode).forEach(field => {
    const element = $("custom_" + field.id);
    if (element) element.value = trade.customValues?.[field.id] ?? "";
  });

  calculateTrade();
  if ($("tradeFormTitle")) $("tradeFormTitle").textContent = "Edit Trade";
  if ($("saveTradeBtn")) $("saveTradeBtn").textContent = "Update Trade";
  showSection("tradeFormSection");
}

async function removeTrade(id) {
  const trade = trades.find(item => item.id === id);
  if (!trade) return;
  if (!confirm("Delete trade " + (trade.stockName || "") + "?")) return;

  try {
    await deleteFromStore("trades",id);
    trades = trades.filter(item => item.id !== id);
    showToast("Trade deleted.");
    await renderEverything();
  } catch(error) {
    showToast("Delete failed: " + error.message);
  }
}

function attachmentSummary(trade) {
  const list = Array.isArray(trade.attachments) ? trade.attachments : [];
  return list.length ? list.map(item => item.name || item.type || "Attachment").join(", ") : "";
}

function formatJournalValue(field,trade) {
  let value;
  if (field.standard) value = trade[field.key];
  else value = trade.customValues?.[field.customId];
  if (["buyPrice","sellPrice","capital","buyStockValue","buyCharge","extraBuyCharge","totalBuyCharges","totalBuyValue","sellStockValue","sellCharge","extraSellCharge","totalSellCharges","totalSellValue","priceMovement","grossPL","totalCharges","netPL"].includes(field.key)) return money(value);
  if (field.key === "attachments") return attachmentSummary(trade);
  return value ?? "";
}

function viewTrade(id) {
  const trade = trades.find(item => item.id === id);
  const content = $("viewTradeContent");
  if (!trade || !content) return;

  const fieldsForView = getAllJournalFields();
  const rows = fieldsForView.map(field => [field.label,formatJournalValue(field,trade)]);
  rows.push(["Chart / Contract Attachments",attachmentSummary(trade)]);

  content.innerHTML = `<div class="table-wrap"><table><tbody>
    ${rows.map(([label,value]) => `<tr><th>${safeText(label)}</th><td>${safeText(value)}</td></tr>`).join("")}
  </tbody></table></div>`;
  $("viewModal")?.classList.remove("hidden");
}

/* ==========================================
   JOURNAL
========================================== */

function getVisibleTrades() {
  return trades.filter(trade => (trade.mode || "intraday") === currentMode);
}

function renderJournal() {
  const head = $("journalHead");
  const body = $("journalBody");
  if (!head || !body) return;

  const search = getFormValue("journalSearch").toLowerCase().trim();
  const columns = getAllJournalFields();
  columns.push({key:"attachments",label:"Attachments",standard:true,position:999999});

  head.innerHTML = `<tr>${columns.map(column => `<th>${safeText(column.label)}</th>`).join("")}<th>Actions</th></tr>`;

  const visible = getVisibleTrades().filter(trade => {
    const searchable = [
      trade.stockName,trade.voucherNumber,trade.notes,trade.strategy,
      ...Object.values(trade.customValues || {})
    ].join(" ").toLowerCase();
    return searchable.includes(search);
  }).sort((a,b) => String(getPerformanceDate(b) || "").localeCompare(String(getPerformanceDate(a) || "")));

  if ($("journalTradeCount")) $("journalTradeCount").textContent = visible.length + " trades";
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="${columns.length + 1}" class="empty-cell">No trades found.</td></tr>`;
    return;
  }

  body.innerHTML = visible.map(trade => `<tr>
    ${columns.map(column => `<td>${safeText(formatJournalValue(column,trade))}</td>`).join("")}
    <td><div class="table-action">
      <button class="small-btn" data-view-trade="${safeText(trade.id)}">View</button>
      <button class="small-btn" data-edit-trade="${safeText(trade.id)}">Edit</button>
      <button class="small-btn" data-delete-trade="${safeText(trade.id)}">Delete</button>
    </div></td>
  </tr>`).join("");
}

/* ==========================================
   DASHBOARD - EXACTLY 8 METRICS
   Eight dashboard metrics only
========================================== */

function renderDashboard() {
  const list = getVisibleTrades();
  const total = list.length;
  const gross = list.reduce((s,t) => s + numberValue(t.grossPL),0);
  const charges = list.reduce((s,t) => s + numberValue(t.totalCharges),0);
  const net = list.reduce((s,t) => s + numberValue(t.netPL),0);
  const wins = list.filter(t => numberValue(t.netPL) > 0).length;
  const losses = list.filter(t => numberValue(t.netPL) < 0).length;
  const winRate = total ? wins / total * 100 : 0;
  const lossRate = total ? losses / total * 100 : 0;

  const values = {
    dashTotalTrades:total,
    dashWins:wins,
    dashLosses:losses,
    dashWinRate:winRate.toFixed(1) + "%",
    dashLossRate:lossRate.toFixed(1) + "%",
    dashGrossPL:money(gross),
    dashCharges:money(charges),
    dashNetPL:money(net)
  };

  Object.entries(values).forEach(([id,value]) => {
    if ($(id)) $(id).textContent = value;
  });

  if ($("dashNetPL")) {
    $("dashNetPL").className = net >= 0 ? "profit" : "loss";
  }
}

/* ==========================================
   PERIOD OVERVIEW
========================================== */

function renderPeriodOverview() {
  const start = getFormValue("periodStartDate");
  const end = getFormValue("periodEndDate");

  const filtered = getVisibleTrades().filter(trade => {
    // Swing + Long Term use Exit Date for period performance. Older records
    // without Exit Date fall back to the stored trade date in
    // getPerformanceDate(), preserving existing data.
    const performanceDate = getPerformanceDate(trade);
    if (start && performanceDate < start) return false;
    if (end && performanceDate > end) return false;
    return true;
  });

  const gross = filtered.reduce((s,t) => s + numberValue(t.grossPL),0);
  const charges = filtered.reduce((s,t) => s + numberValue(t.totalCharges),0);
  const net = filtered.reduce((s,t) => s + numberValue(t.netPL),0);

  if ($("periodGrossPL")) $("periodGrossPL").textContent = money(gross);
  if ($("periodTotalCharges")) $("periodTotalCharges").textContent = money(charges);
  if ($("periodNetPL")) $("periodNetPL").textContent = money(net);
  if ($("periodMessage")) {
    $("periodMessage").textContent =
      filtered.length + " trades in selected period.";
  }
}

/* ==========================================
   BROKER TRANSACTION DETAILS - SHEETS STYLE
========================================== */

function defaultBrokerData(){
  return {headings:["Date","Amount Received","Amount Paid"],rows:[],widths:[120,120,120],rowHeights:{},cells:{},columnStyles:{}};
}
function loadBrokerData(){
  const saved=readJSON(BROKER_DATA_KEY,null);
  brokerData=saved && Array.isArray(saved.headings) ? saved : defaultBrokerData();
  // Migrate the previous Broker column order without losing existing values.
  if (brokerData.headings.length >= 3 && brokerData.headings[0] === "Date" && brokerData.headings[1] === "Amount Paid" && brokerData.headings[2] === "Amount Received") {
    brokerData.rows = (brokerData.rows || []).map(row => [row?.[0] ?? "", row?.[2] ?? "", row?.[1] ?? ""]);
    const oldWidths = Array.isArray(brokerData.widths) ? brokerData.widths : [];
    brokerData.widths = [oldWidths[0] || 120, oldWidths[2] || 170, oldWidths[1] || 150];
    const oldCells = brokerData.cells || {};
    const newCells = {};
    Object.entries(oldCells).forEach(([key, value]) => {
      const [row, col] = key.split(":").map(Number);
      if (col === 0) newCells[row + ":0"] = value;
      else if (col === 1) newCells[row + ":2"] = value;
      else if (col === 2) newCells[row + ":1"] = value;
    });
    brokerData.cells = newCells;
    const oldStyles = brokerData.columnStyles || {};
    brokerData.columnStyles = {0: oldStyles[0] || {}, 1: oldStyles[2] || {}, 2: oldStyles[1] || {}};
    saveBrokerData();
  }
  if(brokerData.headings.length===0) brokerData.headings=["Date","Amount Received","Amount Paid"];
  brokerData.widths=Array.isArray(brokerData.widths)?brokerData.widths:[];
  // Compact-sheet migration: normalize the existing Broker columns once.
  if (!brokerData.compactWidthsApplied) {
    brokerData.widths = brokerData.headings.map(() => 120);
    brokerData.compactWidthsApplied = true;
  }
  brokerData.headings.forEach((_,i)=>{ if(!brokerData.widths[i]) brokerData.widths[i]=120; });
  brokerData.rowHeights=brokerData.rowHeights||{};
  // Normalize legacy oversized broker rows so the editable cell itself is the
  // compact row, without blank space above/below it.
  if (brokerData.compactRowHeightsVersion !== 2) {
    Object.keys(brokerData.rowHeights).forEach(key => {
      const h = Number(brokerData.rowHeights[key]);
      if (!Number.isFinite(h) || h > 60 || h < 32) brokerData.rowHeights[key] = 44;
    });
    brokerData.compactRowHeightsApplied = true;
    brokerData.compactRowHeightsVersion = 2;
  }
  brokerData.cells=brokerData.cells||{}; brokerData.columnStyles=brokerData.columnStyles||{}; brokerData.defaultStyle=cloneSpreadsheetStyle(brokerData.defaultStyle);
}
function saveBrokerData(){ writeJSON(BROKER_DATA_KEY,brokerData); }
function brokerColumnName(index){let n=index+1,r="";while(n){let rem=(n-1)%26;r=String.fromCharCode(65+rem)+r;n=Math.floor((n-1)/26);}return r;}
function brokerStyle(style){
  return [style.color?`color:${style.color}`:"",style.background?`background:${style.background}`:"",style.fontSize?`font-size:${style.fontSize}px`:"",style.fontFamily?`font-family:${style.fontFamily}`:"",style.bold?"font-weight:bold":"",style.italic?"font-style:italic":"",style.align?`text-align:${style.align}`:"",style.vertical?`vertical-align:${style.vertical}`:"",style.wrap===false?"white-space:nowrap":"white-space:pre-wrap"].filter(Boolean).join(";");
}
function renderBrokerSheet(){
  const c=$("brokerTableContainer"); if(!c)return;
  const h=brokerData.headings;
  const header=h.map((heading,col)=>`<th data-broker-select-column="${col}" style="width:${Number(brokerData.widths[col])||150}px"><div class="sheet-col-letter">${brokerColumnName(col)}</div><div class="report-header-content"><input class="report-heading-input" data-broker-heading="${col}" value="${safeText(heading)}"></div><span class="report-resize-handle" data-broker-resize-column="${col}"></span></th>`).join("");
  const body=brokerData.rows.map((row,r)=>{const height=Number(brokerData.rowHeights[r])||44;const cells=h.map((heading,col)=>{const key=r+":"+col;const merged={...brokerData.defaultStyle,...(brokerData.columnStyles[col]||{}),...(brokerData.cells[key]||{})};const css=brokerStyle(merged);return `<td data-broker-cell="${key}" style="${css};height:${height}px"><textarea class="report-cell-input broker-cell-input" data-broker-input="${key}" style="${css}">${safeText(row[col]||"")}</textarea></td>`}).join("");return `<tr data-broker-row="${r}" style="height:${height}px"><td class="report-row-number"><span>${r+1}</span><span class="report-row-resize" data-broker-resize-row="${r}"></span></td>${cells}</tr>`}).join("");
  c.innerHTML=`<table class="report-table broker-sheet"><thead><tr><th class="report-row-number sheet-corner">#</th>${header}</tr></thead><tbody>${body||`<tr><td colspan="${h.length+1}" class="empty-cell">No transaction rows. Click Add Row to begin.</td></tr>`}</tbody></table>`;
  attachBrokerEvents();
}
function brokerSelectedCells(){
  if(!selectedBrokerCell)return []; const [r,c]=selectedBrokerCell.split(":").map(Number); return [{row:r,column:c}];
}
function getBrokerInheritanceStyle() {
  if (selectedBrokerCell) {
    const [row,column] = selectedBrokerCell.split(":").map(Number);
    return cloneSpreadsheetStyle({
      ...(brokerData.columnStyles[column] || {}),
      ...(brokerData.cells[row + ":" + column] || {})
    });
  }
  if (selectedBrokerColumn !== null) {
    return cloneSpreadsheetStyle(brokerData.columnStyles[selectedBrokerColumn] || brokerData.defaultStyle);
  }
  return cloneSpreadsheetStyle(brokerData.defaultStyle);
}
function applyBrokerFormatting(type,value){
  brokerData.defaultStyle=cloneSpreadsheetStyle(brokerData.defaultStyle);
  brokerData.defaultStyle[type]=value;
  const cells=brokerSelectedCells();
  if(cells.length){cells.forEach(({row,column})=>{const key=row+":"+column;brokerData.cells[key]=brokerData.cells[key]||{};brokerData.cells[key][type]=value;});}
  else if(selectedBrokerColumn!==null){brokerData.columnStyles[selectedBrokerColumn]=brokerData.columnStyles[selectedBrokerColumn]||{};brokerData.columnStyles[selectedBrokerColumn][type]=value;}
  else {showToast("Select a cell or column first.");return;}
  saveBrokerData();renderBrokerSheet();
}
function toggleBrokerFormatting(type){
  brokerData.defaultStyle=cloneSpreadsheetStyle(brokerData.defaultStyle);
  const cells=brokerSelectedCells();
  let value;
  if(cells.length){
    const {row,column}=cells[0];
    const key=row+":"+column;
    const current=brokerData.cells[key]?.[type] ?? brokerData.columnStyles[column]?.[type] ?? brokerData.defaultStyle[type];
    value=!current;
    cells.forEach(({row,column})=>{const k=row+":"+column;brokerData.cells[k]=brokerData.cells[k]||{};brokerData.cells[k][type]=value;});
  } else if(selectedBrokerColumn!==null){
    const st=brokerData.columnStyles[selectedBrokerColumn]||(brokerData.columnStyles[selectedBrokerColumn]={});
    value=!(st[type] ?? brokerData.defaultStyle[type]);
    st[type]=value;
  } else {showToast("Select a cell or column first.");return;}
  brokerData.defaultStyle[type]=value;
  saveBrokerData();renderBrokerSheet();
}
function addBrokerRow(){brokerData.defaultStyle=cloneSpreadsheetStyle(brokerData.defaultStyle);brokerData.rows.push(Array(brokerData.headings.length).fill(""));saveBrokerData();renderBrokerSheet();}
function deleteBrokerRow(){if(!selectedBrokerCell){showToast("Select a cell in the row first.");return;}const r=Number(selectedBrokerCell.split(":")[0]);if(!confirm(`Delete transaction row ${r+1}?`))return;brokerData.rows.splice(r,1);const cells={};Object.entries(brokerData.cells).forEach(([k,v])=>{const [row,col]=k.split(":").map(Number);if(row<r)cells[k]=v;else if(row>r)cells[(row-1)+":"+col]=v;});brokerData.cells=cells;saveBrokerData();selectedBrokerCell=null;renderBrokerSheet();}
function addBrokerColumn(){const name=prompt("Enter new column heading:");if(name===null||!name.trim())return;const newIndex=brokerData.headings.length;brokerData.headings.push(name.trim());brokerData.widths.push(120);brokerData.columnStyles[newIndex]=getBrokerInheritanceStyle();brokerData.rows.forEach(r=>r.push(""));saveBrokerData();renderBrokerSheet();}
function editBrokerColumn(){if(selectedBrokerColumn===null){showToast("Select a column heading first.");return;}const n=prompt("Edit column heading:",brokerData.headings[selectedBrokerColumn]);if(n===null||!n.trim())return;brokerData.headings[selectedBrokerColumn]=n.trim();saveBrokerData();renderBrokerSheet();}
function deleteBrokerColumn(){if(selectedBrokerColumn===null){showToast("Select a column heading first.");return;}if(brokerData.headings.length<=1){showToast("At least one column must remain.");return;}const i=selectedBrokerColumn;if(!confirm(`Delete column '${brokerData.headings[i]}'?`))return;brokerData.headings.splice(i,1);brokerData.widths.splice(i,1);brokerData.rows.forEach(r=>r.splice(i,1));const cells={};Object.entries(brokerData.cells).forEach(([k,v])=>{const [row,col]=k.split(":").map(Number);if(col<i)cells[k]=v;else if(col>i)cells[row+":"+(col-1)]=v;});brokerData.cells=cells;const styles={};Object.entries(brokerData.columnStyles).forEach(([k,v])=>{const col=Number(k);if(col<i)styles[col]=v;else if(col>i)styles[col-1]=v;});brokerData.columnStyles=styles;selectedBrokerColumn=null;selectedBrokerCell=null;saveBrokerData();renderBrokerSheet();}
function attachBrokerEvents(){
  document.querySelectorAll("[data-broker-input]").forEach(input=>{input.addEventListener("focus",()=>{selectedBrokerCell=input.dataset.brokerInput;selectedBrokerColumn=null;document.querySelectorAll(".report-selected-cell").forEach(x=>x.classList.remove("report-selected-cell"));input.closest("td")?.classList.add("report-selected-cell");});input.addEventListener("input",()=>{const [r,c]=input.dataset.brokerInput.split(":").map(Number);while(brokerData.rows.length<=r)brokerData.rows.push(Array(brokerData.headings.length).fill(""));brokerData.rows[r][c]=input.value;saveBrokerData();});input.addEventListener("paste",e=>{const t=e.clipboardData?.getData("text/plain")||"";if(!t.includes("\t")&&!t.includes("\n"))return;e.preventDefault();const [sr,sc]=input.dataset.brokerInput.split(":").map(Number);t.replace(/\r/g,"").split("\n").forEach((line,ro)=>line.split("\t").forEach((v,co)=>{const r=sr+ro,c=sc+co;while(brokerData.rows.length<=r)brokerData.rows.push(Array(brokerData.headings.length).fill(""));while(brokerData.headings.length<=c){const newCol=brokerData.headings.length;brokerData.headings.push("New Column");brokerData.widths.push(120);brokerData.columnStyles[newCol]=getBrokerInheritanceStyle();}while(brokerData.rows[r].length<=c)brokerData.rows[r].push("");brokerData.rows[r][c]=v;}));saveBrokerData();renderBrokerSheet();});});
  document.querySelectorAll("[data-broker-select-column]").forEach(h=>h.addEventListener("click",e=>{if(e.target.closest("input"))return;selectedBrokerColumn=Number(h.dataset.brokerSelectColumn);selectedBrokerCell=null;document.querySelectorAll(".report-selected-cell").forEach(x=>x.classList.remove("report-selected-cell"));showToast("Column selected.");}));
  document.querySelectorAll("[data-broker-heading]").forEach(i=>i.addEventListener("change",()=>{const c=Number(i.dataset.brokerHeading);brokerData.headings[c]=i.value.trim()||brokerData.headings[c];saveBrokerData();}));
  document.querySelectorAll("[data-broker-resize-column]").forEach(handle=>handle.addEventListener("pointerdown",e=>brokerResizeColumn(e,Number(handle.dataset.brokerResizeColumn))));
  document.querySelectorAll("[data-broker-resize-row]").forEach(handle=>handle.addEventListener("pointerdown",e=>brokerResizeRow(e,Number(handle.dataset.brokerResizeRow))));
}
function brokerResizeColumn(e,col){e.preventDefault();const startX=e.clientX,startW=Number(brokerData.widths[col])||150;const move=ev=>{brokerData.widths[col]=Math.max(60,startW+ev.clientX-startX);renderBrokerSheet();};const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);saveBrokerData();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);}
function brokerResizeRow(e,row){e.preventDefault();const startY=e.clientY,startH=Number(brokerData.rowHeights[row])||44;const move=ev=>{brokerData.rowHeights[row]=Math.max(24,startH+ev.clientY-startY);renderBrokerSheet();};const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);saveBrokerData();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);}
function setupBrokerToolbar(){
  $("brokerAddRowBtn")?.addEventListener("click",addBrokerRow);$("brokerDeleteRowBtn")?.addEventListener("click",deleteBrokerRow);$("brokerSaveBtn")?.addEventListener("click",()=>{saveBrokerData();if($("brokerMessage"))$("brokerMessage").textContent="Transaction details saved successfully.";});$("brokerAddColumnBtn")?.addEventListener("click",addBrokerColumn);$("brokerEditColumnBtn")?.addEventListener("click",editBrokerColumn);$("brokerDeleteColumnBtn")?.addEventListener("click",deleteBrokerColumn);
  $("brokerTextColor")?.addEventListener("input",e=>applyBrokerFormatting("color",e.target.value));$("brokerCellColor")?.addEventListener("input",e=>applyBrokerFormatting("background",e.target.value));$("brokerFontSize")?.addEventListener("change",e=>applyBrokerFormatting("fontSize",e.target.value));$("brokerFontFamily")?.addEventListener("change",e=>applyBrokerFormatting("fontFamily",e.target.value));document.querySelectorAll("[data-broker-halign]").forEach(button=>button.addEventListener("click",()=>{applyBrokerFormatting("align",button.dataset.brokerHalign);document.querySelectorAll("[data-broker-halign]").forEach(x=>x.classList.toggle("active",x===button));}));document.querySelectorAll("[data-broker-valign]").forEach(button=>button.addEventListener("click",()=>{applyBrokerFormatting("vertical",button.dataset.brokerValign);document.querySelectorAll("[data-broker-valign]").forEach(x=>x.classList.toggle("active",x===button));}));$("brokerBoldBtn")?.addEventListener("click",()=>toggleBrokerFormatting("bold"));$("brokerItalicBtn")?.addEventListener("click",()=>toggleBrokerFormatting("italic"));$("brokerWrapBtn")?.addEventListener("click",()=>toggleBrokerFormatting("wrap"));
  setupExportMenu("brokerExportBtn", "brokerExportMenu", {
    "broker-csv": exportBrokerCSV,
    "broker-pdf": exportBrokerPDF
  });
}

/* ==========================================
   CSV EXPORT
========================================== */

function csvEscape(value) {
  return '"' + String(value ?? "").replace(/"/g,'""') + '"';
}

function downloadFile(filename,content,type) {
  const blob = new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function setupExportMenu(triggerId, menuId, actions) {
  const trigger = $(triggerId);
  const menu = $(menuId);
  if (!trigger || !menu) return;
  trigger.onclick = e => {
    e.stopPropagation();
    document.querySelectorAll(".export-menu:not(.hidden)").forEach(other => {
      if (other !== menu) other.classList.add("hidden");
    });
    menu.classList.toggle("hidden");
  };
  menu.querySelectorAll("[data-export-action]").forEach(item => {
    item.onclick = e => {
      e.stopPropagation();
      menu.classList.add("hidden");
      const action = actions[item.dataset.exportAction];
      if (typeof action === "function") action();
    };
  });
}
if (!window.__tradeLedgerExportMenuBound) {
  document.addEventListener("click", () => document.querySelectorAll(".export-menu").forEach(menu => menu.classList.add("hidden")));
  window.__tradeLedgerExportMenuBound = true;
}
function getJournalExportColumns() {
  const columns = getAllJournalFields().map(field => ({label:field.label,key:field.key,field}));
  columns.push({label:"Attachments",key:"attachments",field:{key:"attachments",label:"Attachments"}});
  return columns;
}
function getJournalExportRows() {
  const columns = getJournalExportColumns();
  return getVisibleTrades().map(trade => columns.map(column => column.key === "attachments" ? attachmentSummary(trade) : formatJournalValue(column.field,trade)));
}
function getJournalExportTitle() {
  const modeName = currentMode === "intraday" ? "Intraday Trading" : currentMode === "swing" ? "Swing Trading" : "Long Term Trading";
  return `${modeName} - Trade Journal`;
}
function exportJournalCSV() {
  const columns=getJournalExportColumns(), rows=getJournalExportRows();
  const output=[columns.map(c=>csvEscape(c.label)).join(","),...rows.map(row=>row.map(csvEscape).join(","))];
  downloadFile(getJournalExportTitle().replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".csv","\uFEFF"+output.join("\r\n"),"text/csv;charset=utf-8");
  showToast("CSV exported.");
}
function exportJournalPDF() {
  const columns=getJournalExportColumns(), rows=getJournalExportRows(), title=getJournalExportTitle();
  const head=columns.map(c=>`<th>${safeText(c.label)}</th>`).join("");
  const body=rows.map(row=>`<tr>${row.map(v=>`<td>${safeText(v)}</td>`).join("")}</tr>`).join("");
  const win=window.open("","_blank","noopener,noreferrer");
  if(!win){showToast("Allow pop-ups to export PDF.",true);return;}
  win.document.write(`<!doctype html><html><head><title>${safeText(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#111;background:#fff;font-size:9px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:5px 6px;text-align:left;vertical-align:middle;word-break:break-word}th{background:#e9eef5;font-weight:700}</style></head><body><h1>${safeText(title)}</h1><p>TradeLedger</p><table><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${columns.length}">No trades found.</td></tr>`}</tbody></table></body></html>`);
  win.document.close(); setTimeout(()=>{win.focus();win.print();},250);
}
function exportBrokerCSV() {
  const output=[brokerData.headings.map(csvEscape).join(","),...brokerData.rows.map(row=>brokerData.headings.map((_,i)=>csvEscape(row[i]||"")).join(","))];
  downloadFile("TradeLedger-Broker-Transactions.csv","\uFEFF"+output.join("\r\n"),"text/csv;charset=utf-8"); showToast("CSV exported.");
}
function exportBrokerPDF() {
  const title="TradeLedger - Broker Transactions", head=brokerData.headings.map(h=>`<th>${safeText(h)}</th>`).join("");
  const body=brokerData.rows.map(row=>`<tr>${brokerData.headings.map((_,i)=>`<td>${safeText(row[i]||"")}</td>`).join("")}</tr>`).join("");
  const win=window.open("","_blank","noopener,noreferrer"); if(!win){showToast("Allow pop-ups to export PDF.",true);return;}
  win.document.write(`<!doctype html><html><head><title>${safeText(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#111;background:#fff;font-size:10px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:6px 7px;text-align:left;vertical-align:middle;word-break:break-word}th{background:#e9eef5;font-weight:700}</style></head><body><h1>${safeText(title)}</h1><p>TradeLedger</p><table><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${brokerData.headings.length}">No transaction rows.</td></tr>`}</tbody></table></body></html>`);
  win.document.close(); setTimeout(()=>{win.focus();win.print();},250);
}

/* ==========================================
   FIELD MANAGER
========================================== */

function getFieldSettings() {
  const allModes = readJSON(MODE_SETTINGS_KEY,null);
  if (allModes && allModes[currentMode]) return allModes[currentMode];
  return readJSON(SETTINGS_KEY,{});
}
function saveFieldSettings(settings) {
  const allModes = readJSON(MODE_SETTINGS_KEY,{});
  allModes[currentMode] = settings;
  writeJSON(MODE_SETTINGS_KEY,allModes);
}
function ensureModeFieldSettings() {
  const existing = readJSON(MODE_SETTINGS_KEY,null);
  if (existing && existing.intraday && existing.swing && existing.longterm) return;
  const global = readJSON(SETTINGS_KEY,{});
  const modes = existing || {};
  ["intraday","swing","longterm"].forEach(mode => {
    if (!modes[mode]) modes[mode] = JSON.parse(JSON.stringify(global || {}));
  });
  modes.intraday.date = {...(modes.intraday.date||{}), hidden:false, deleted:false, label:"Entry Date"};
  modes.intraday.exitDate = {...(modes.intraday.exitDate||{}), hidden:true};
  modes.intraday.leverage = {...(modes.intraday.leverage||{}), hidden:false, deleted:false};
  ["swing","longterm"].forEach(mode => {
    modes[mode].date = {...(modes[mode].date||{}), hidden:false, deleted:false, label:"Entry Date"};
    modes[mode].exitDate = {...(modes[mode].exitDate||{}), hidden:false, deleted:false, label:"Exit Date"};
    modes[mode].leverage = {...(modes[mode].leverage||{}), hidden:true};
  });
  writeJSON(MODE_SETTINGS_KEY,modes);
}
function isFieldAllowedForMode(key) {
  if (currentMode === "intraday") return key !== "exitDate";
  return key !== "leverage";
}
function getModeStandardFields() {
  const settings = getFieldSettings();
  return STANDARD_FIELDS.filter(field => isFieldAllowedForMode(field.key)).map(field => ({
    ...field,
    label: settings[field.key]?.label || field.label,
    placeholder: settings[field.key]?.placeholder || "",
    type: settings[field.key]?.type || field.type,
    section: settings[field.key]?.section || field.section,
    options: Array.isArray(settings[field.key]?.options) ? settings[field.key].options : []
  }));
}

function normalizeStandardPositions() {
  const settings = getFieldSettings();
  getModeStandardFields().forEach((field,index) => {
    settings[field.key] = {...(settings[field.key] || {}),position:getStandardFieldPosition(field.key)};
  });
  saveFieldSettings(settings);
}

function getUnifiedFieldOrder() {
  const settings = getFieldSettings();
  const standard = getModeStandardFields().map(field => ({
    id: field.key,
    kind: "standard",
    field,
    position: getStandardFieldPosition(field.key),
    label: settings[field.key]?.label || field.label,
    deleted: Boolean(settings[field.key]?.deleted),
    hidden: Boolean(settings[field.key]?.hidden)
  }));
  const custom = fields.filter(field => (field.mode || "intraday") === currentMode).map(field => ({
    id: String(field.id),
    kind: "custom",
    field,
    position: numberValue(field.position) || 9999,
    label: field.label || field.name || "Custom Field",
    deleted: false,
    hidden: Boolean(field.hidden)
  }));
  return [...standard, ...custom].sort((a,b) =>
    a.position - b.position || String(a.id).localeCompare(String(b.id))
  );
}

function getActiveFieldManagerList() {
  const workspaceId = currentMode === "intraday" ? "intradayWorkspace" :
    currentMode === "swing" ? "swingWorkspace" :
    currentMode === "longterm" ? "longtermWorkspace" : "";
  const workspace = workspaceId ? $(workspaceId) : null;
  return workspace?.querySelector(".mode-field-manager-list") || workspace?.querySelector("#fieldManagerList");
}

function renderFieldList() {
  const container = getActiveFieldManagerList();
  if (!container) return;

  const ordered = getUnifiedFieldOrder();
  const html = ordered.map((item,index) => {
    const first = index === 0;
    const last = index === ordered.length - 1;
    const field = item.field;
    const status = item.kind === "standard"
      ? (item.deleted ? " · Deleted from Add Trade" : item.hidden ? " · Hidden from Journal" : "")
      : (item.hidden ? " · Hidden from Journal" : "");

    return `<div class="field-manager-item">
      <div class="field-manager-info">
        <strong>${safeText(item.label)}</strong>
        <small>ID: <code>${safeText(item.id)}</code> · ${item.kind === "standard" ? "Standard" : "Custom"} · ${safeText(field.section || "basic")} · ${safeText(field.type || "text")}${status}</small>
      </div>
      <div class="field-manager-actions">
        <button type="button" class="field-arrow-btn" data-move-unified="${safeText(item.id)}" data-kind="${item.kind}" data-direction="up" ${first ? "disabled" : ""}>↑</button>
        <button type="button" class="field-arrow-btn" data-move-unified="${safeText(item.id)}" data-kind="${item.kind}" data-direction="down" ${last ? "disabled" : ""}>↓</button>
        <button type="button" data-edit-${item.kind}="${safeText(item.id)}">Edit</button>
        <button type="button" class="delete-field-btn" data-delete-${item.kind}="${safeText(item.id)}">${item.kind === "standard" && item.deleted ? "Restore" : "Delete"}</button>
        <button type="button" data-toggle-${item.kind}="${safeText(item.id)}">${item.hidden ? "Show" : "Hide"}</button>
      </div>
    </div>`;
  }).join("");

  container.innerHTML = `<h3>All Fields</h3>
    <p class="muted-text field-manager-note">Field Manager controls the same field definitions used by Add Trade and Journal. Edit changes the field definition, Hide hides it from Journal without deleting saved values, Delete removes the field from the form/Journal while preserving existing trade data, and ↑ / ↓ changes the shared column order.</p>
    ${html || '<p class="muted-text">No fields available.</p>'}`;
}

async function moveUnifiedField(id,kind,direction) {
  const ordered = getUnifiedFieldOrder();
  const index = ordered.findIndex(item => item.kind === kind && String(item.id) === String(id));
  if (index < 0) return;
  const target = index + (direction === "up" ? -1 : 1);
  if (target < 0 || target >= ordered.length) return;

  [ordered[index],ordered[target]] = [ordered[target],ordered[index]];

  try {
    const settings = getFieldSettings();
    for (let i=0; i<ordered.length; i++) {
      const item = ordered[i];
      if (item.kind === "standard") {
        settings[item.id] = {...(settings[item.id] || {}), position:i+1};
      } else {
        const field = {...item.field, position:i+1};
        await putIntoStore("fields",field);
        fields = fields.map(existing => String(existing.id) === String(field.id) ? field : existing);
      }
    }
    saveFieldSettings(settings);
    renderFieldList();
    renderStandardFormFields();
    renderCustomFormFields();
    renderJournal();
    showToast("Field order updated.");
  } catch(error) {
    console.error(error);
    showToast("Unable to change field order: " + error.message);
  }
}

async function toggleStandardField(key) {
  const settings=getFieldSettings();
  const current=settings[key]||{};
  settings[key]={...current,hidden:!current.hidden};
  saveFieldSettings(settings);
  renderFieldList(); renderJournal();
  showToast(settings[key].hidden ? "Field hidden from Journal." : "Field shown in Journal.");
}

async function deleteStandardField(key) {
  const field=getModeStandardFields().find(item=>item.key===key); if(!field)return;
  const settings=getFieldSettings(); const current=settings[key]||{};
  const deleted=!current.deleted;
  if(deleted && !confirm("Delete '"+(current.label||field.label)+"' from Add Trade and Journal? Stored trade values will be preserved.")) return;
  settings[key]={...current,deleted};
  saveFieldSettings(settings);
  renderFieldList(); renderStandardFormFields(); renderCustomFormFields(); renderJournal();
  showToast(deleted ? "Field deleted from form and Journal." : "Field restored.");
}

function openFieldModal(){ $("fieldManagerModal")?.classList.remove("hidden"); }
function closeFieldModal(){
  $("fieldManagerModal")?.classList.add("hidden"); $("fieldForm")?.reset();
  if($("fieldId"))$("fieldId").value=""; if($("fieldCustomId"))$("fieldCustomId").value="";
  if($("fieldModalTitle"))$("fieldModalTitle").textContent="Add Custom Field";
  if($("fieldType"))$("fieldType").disabled=false; if($("fieldSection"))$("fieldSection").disabled=false;
}
function editStandardField(key){
  const field=getModeStandardFields().find(item=>item.key===key); if(!field)return;
  const current=getFieldSettings()[key]||{};
  if($("fieldId"))$("fieldId").value="standard:"+key;
  if($("fieldCustomId"))$("fieldCustomId").value=key;
  if($("fieldName"))$("fieldName").value=current.label||field.label;
  if($("fieldPlaceholder"))$("fieldPlaceholder").value=current.placeholder||"";
  if($("fieldType")){ $("fieldType").value=field.type; $("fieldType").disabled=false; }
  if($("fieldSection")){ $("fieldSection").value=field.section; $("fieldSection").disabled=false; }
  if($("fieldOptions"))$("fieldOptions").value=(current.options||[]).join(", ");
  if($("fieldPosition"))$("fieldPosition").value=current.position||getStandardFieldPosition(key);
  if($("fieldInForm"))$("fieldInForm").checked=true;
  if($("fieldRequired"))$("fieldRequired").checked=false;
  if($("fieldModalTitle"))$("fieldModalTitle").textContent="Edit Standard Field";
  openFieldModal();
}
function editCustomField(id){
  const field=fields.find(item=>String(item.id)===String(id)); if(!field)return;
  if($("fieldId"))$("fieldId").value=field.id; if($("fieldCustomId"))$("fieldCustomId").value=field.id;
  if($("fieldName"))$("fieldName").value=field.label||field.name||""; if($("fieldPlaceholder"))$("fieldPlaceholder").value=field.placeholder||"";
  if($("fieldType")){ $("fieldType").value=field.type||"text"; $("fieldType").disabled=false; }
  if($("fieldSection")){ $("fieldSection").value=field.section||"basic"; $("fieldSection").disabled=false; }
  if($("fieldOptions"))$("fieldOptions").value=(field.options||[]).join(", "); if($("fieldPosition"))$("fieldPosition").value=field.position||1;
  if($("fieldInForm"))$("fieldInForm").checked=field.inForm!==false; if($("fieldRequired"))$("fieldRequired").checked=Boolean(field.required);
  if($("fieldModalTitle"))$("fieldModalTitle").textContent="Edit Custom Field"; openFieldModal();
}

async function saveField(event){
  event.preventDefault();
  const id=$("fieldId")?.value||"", label=$("fieldName")?.value.trim()||"", placeholder=$("fieldPlaceholder")?.value.trim()||"", requestedCustomId=$("fieldCustomId")?.value.trim()||"";
  if(!label){showToast("Enter a field heading.");return;}
  try{
    if(id.startsWith("standard:")){
      const key=id.slice(9); const standard=STANDARD_FIELDS.find(item=>item.key===key); if(!standard)return;
      const settings=getFieldSettings();
      settings[key]={...(settings[key]||{}),label,placeholder,
        type:$("fieldType")?.value || standard.type,
        section:$("fieldSection")?.value || standard.section,
        options:($("fieldOptions")?.value||"").split(",").map(x=>x.trim()).filter(Boolean),
        position:numberValue($("fieldPosition")?.value)||getStandardFieldPosition(key)};
      saveFieldSettings(settings);
      closeFieldModal(); renderFieldList(); renderStandardFormFields(); renderJournal(); showToast("Standard field updated."); return;
    }
    const original=id?fields.find(item=>String(item.id)===String(id)):null;
    if(id&&!original)throw new Error("Custom field was not found.");
    const cleanCustomId=requestedCustomId.replace(/[^A-Za-z0-9_-]/g,"").replace(/^-+/,"").slice(0,80);
    const nextId=cleanCustomId||(original?String(original.id):makeId());
    const duplicate=fields.find(item=>(item.mode || "intraday")===currentMode && String(item.id)===nextId&&String(item.id)!==String(original?.id||"")); if(duplicate)throw new Error("This Field ID is already in use.");
    const maxPosition=fields.reduce((m,f)=>Math.max(m,numberValue(f.position)),0);
    const field={...(original||{}),id:nextId,label,name:label,placeholder,type:$("fieldType")?.value||"text",section:$("fieldSection")?.value||"basic",options:($("fieldOptions")?.value||"").split(",").map(x=>x.trim()).filter(Boolean),position:original?numberValue($("fieldPosition")?.value)||original.position||1:maxPosition+1,inForm:$("fieldInForm")?.checked!==false,required:Boolean($("fieldRequired")?.checked),hidden:original?Boolean(original.hidden):false,mode:original?.mode || currentMode};
    if(original&&String(original.id)!==String(field.id)){
      const tx=db.transaction(["trades","fields"],"readwrite"), ts=tx.objectStore("trades"), fs=tx.objectStore("fields"), req=ts.getAll();
      await new Promise((resolve,reject)=>{req.onsuccess=()=>{(req.result||[]).forEach(trade=>{if(trade.customValues&&Object.prototype.hasOwnProperty.call(trade.customValues,String(original.id))){trade.customValues[field.id]=trade.customValues[String(original.id)];delete trade.customValues[String(original.id)];ts.put(trade);}});fs.delete(original.id);fs.put(field);resolve();};req.onerror=()=>reject(req.error);});
      await transactionComplete(tx);
    } else await putIntoStore("fields",field);
    fields=original?fields.map(item=>String(item.id)===String(id)?field:item):[...fields,field];
    if(original&&String(original.id)!==String(field.id)) trades=trades.map(trade=>{const cv={...(trade.customValues||{})};if(Object.prototype.hasOwnProperty.call(cv,String(original.id))){cv[field.id]=cv[String(original.id)];delete cv[String(original.id)];return {...trade,customValues:cv};}return trade;});
    closeFieldModal(); renderFieldList(); renderStandardFormFields(); renderCustomFormFields(); renderJournal(); showToast(original?"Custom field updated.":"Custom field added.");
  }catch(error){console.error(error);showToast("Unable to save field: "+error.message);}
}

async function toggleCustomField(id){const original=fields.find(item=>String(item.id)===String(id));if(!original)return;const field={...original,hidden:!original.hidden};try{await putIntoStore("fields",field);fields=fields.map(item=>String(item.id)===String(id)?field:item);renderFieldList();renderCustomFormFields();renderJournal();showToast(field.hidden?"Field hidden from Journal.":"Field shown in Journal.");}catch(error){showToast("Unable to update field: "+error.message);}}
async function deleteCustomField(id){const field=fields.find(item=>String(item.id)===String(id));if(!field)return;if(!confirm("Delete custom field "+(field.label||field.name)+"? Existing trade values will be preserved but the field definition will be removed."))return;try{await deleteFromStore("fields",field.id);fields=fields.filter(item=>String(item.id)!==String(id));renderFieldList();renderCustomFormFields();renderJournal();showToast("Custom field deleted.");}catch(error){showToast("Unable to delete field: "+error.message);}}

/* ==========================================
   REPORTS & ANALYTICS
========================================== */

function getReportRows(period = currentReportPeriod) {
  if (!Array.isArray(reportData[period])) reportData[period] = [];
  return reportData[period];
}

function getReportConfig(period = currentReportPeriod) {
  if (!reportSettings[period]) {
    reportSettings[period] = {
      headings:[...REPORT_HEADINGS[period]],
      widths:[120,120,120,120,120],
      rowHeights:{},
      cells:{},
      columnStyles:{},
      defaultStyle:cloneSpreadsheetStyle()
    };
  }

  const config = reportSettings[period];

  if (!Array.isArray(config.headings)) {
    config.headings = [...REPORT_HEADINGS[period]];
  }

  if (!Array.isArray(config.widths)) config.widths = [];

  // Compact-sheet migration: older report sheets used stretched columns.
  // Apply the compact width once, then preserve any manual resizing.
  if (!config.compactWidthsApplied) {
    config.widths = config.widths.map(() => 120);
    config.compactWidthsApplied = true;
  }

  if (!config.rowHeights) config.rowHeights = {};
  // Keep spreadsheet rows compact. Older versions could leave an oversized
  // saved row height, which makes the 44px editable cell appear with large
  // blank areas above and below it. Normalize those legacy oversized rows once.
  if (config.compactRowHeightsVersion !== 5) {
    Object.keys(config.rowHeights).forEach(key => {
      config.rowHeights[key] = 44;
    });
    config.compactRowHeightsApplied = true;
    config.compactRowHeightsVersion = 5;
  }
  if (!config.cells) config.cells = {};
  if (!config.columnStyles) config.columnStyles = {};
  config.defaultStyle = cloneSpreadsheetStyle(config.defaultStyle);

  while (config.headings.length < 5) {
    config.headings.push(REPORT_HEADINGS[period][config.headings.length]);
  }

  while (config.widths.length < config.headings.length) {
    config.widths.push(150);
  }

  // Ensure old report rows are extended for additional columns.
  getReportRows(period).forEach(row => {
    while (row.length < config.headings.length) row.push("");
  });

  return config;
}

function setReportPeriod(period) {
  if (!REPORT_HEADINGS[period]) return;

  captureReportInputs();
  currentReportPeriod = period;
  selectedReportCell = null;
  selectedReportColumn = null;

  document.querySelectorAll(".report-tab").forEach(button => {
    button.classList.toggle("active",button.dataset.reportPeriod === period);
  });

  renderReportTable();
}

/* Add/Edit/Delete controls are inserted into the existing Reports section. */
function ensureReportColumnToolbar(container) {
  let toolbar = $("reportColumnToolbar");

  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "reportColumnToolbar";
    toolbar.className = "report-column-toolbar";
    toolbar.style.cssText =
      "display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;";

    container.parentElement?.insertBefore(toolbar,container);
  }

  toolbar.innerHTML = `
    <button type="button" id="reportAddColumnBtn" class="primary-btn">+ Add Column</button>
    <button type="button" id="reportEditColumnBtn" class="secondary-btn">Edit Selected Column</button>
    <button type="button" id="reportDeleteColumnBtn" class="danger-btn">Delete Selected Column</button>
    <div class="export-menu-wrap">
      <button type="button" id="reportExportBtn" class="secondary-btn export-menu-trigger">Export ▾</button>
      <div id="reportExportMenu" class="export-menu hidden">
        <button type="button" data-export-action="report-csv">Export CSV</button>
        <button type="button" data-export-action="report-pdf">Export PDF</button>
      </div>
    </div>
  `;

  $("reportAddColumnBtn").addEventListener("click",addReportColumn);
  $("reportEditColumnBtn").addEventListener("click",editReportColumn);
  $("reportDeleteColumnBtn").addEventListener("click",deleteReportColumn);
  setupExportMenu("reportExportBtn", "reportExportMenu", {
    "report-csv": exportCurrentReportCSV,
    "report-pdf": exportCurrentReportPDF
  });
}

function reportColumnName(index) {
  let n = Number(index) + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function renderReportTable() {
  const container = $("reportTableContainer");
  if (!container) return;

  ensureReportColumnToolbar(container);

  const rows = getReportRows();
  const config = getReportConfig();
  const count = config.headings.length;

  const headerHTML = config.headings.map((heading,column) => `
    <th data-report-select-column="${column}"
      style="width:${numberValue(config.widths[column]) || 150}px">
      <div class="sheet-col-letter">${reportColumnName(column)}</div>
      <div class="report-header-content">
        <input class="report-heading-input"
          data-report-heading="${column}"
          value="${safeText(heading)}"
          aria-label="Column heading ${column + 1}">
      </div>
      <span class="report-resize-handle" data-resize-column="${column}"></span>
    </th>
  `).join("");

  const bodyHTML = rows.map((row,rowIndex) => {
    const height = numberValue(config.rowHeights[rowIndex]) || 44;
    const cells = config.headings.map((heading,column) => {
      const key = rowIndex + ":" + column;
      const style = config.cells[key] || {};
      const columnStyle = config.columnStyles[column] || {};
      const merged = {...config.defaultStyle,...columnStyle,...style};
      const css = [
        merged.color ? "color:" + merged.color : "",
        merged.background ? "background:" + merged.background : "",
        merged.fontSize ? "font-size:" + merged.fontSize + "px" : "",
        merged.fontFamily ? "font-family:" + merged.fontFamily : "",
        merged.bold ? "font-weight:bold" : "",
        merged.italic ? "font-style:italic" : "",
        merged.align ? "text-align:" + merged.align : "",
        merged.vertical ? "vertical-align:" + merged.vertical : "",
        merged.wrap === false ? "white-space:nowrap" : "white-space:pre-wrap"
      ].filter(Boolean).join(";");

      return `<td style="${css};height:${height}px" data-report-cell="${rowIndex}:${column}">
        <textarea class="report-cell-input" data-report-input="${rowIndex}:${column}"
          aria-label="${safeText(heading)} row ${rowIndex + 1}" style="${css}">${safeText(row[column] || "")}</textarea>
      </td>`;
    }).join("");

    return `<tr data-report-row="${rowIndex}" style="height:${height}px">
      <td class="report-row-number"><span>${rowIndex + 1}</span><span class="report-row-resize" data-resize-row="${rowIndex}"></span></td>
      ${cells}
    </tr>`;
  }).join("");

  container.innerHTML = `
    <table class="report-table">
      <thead><tr>
        <th class="report-row-number sheet-corner">#</th>
        ${headerHTML}
      </tr></thead>
      <tbody>
        ${bodyHTML || `<tr><td colspan="${count + 1}" class="empty-cell">No report rows. Click Add Row to begin.</td></tr>`}
      </tbody>
    </table>
  `;

  attachReportCellEvents();
}

/* ==========================================
   REPORT EXPORT
========================================== */

function getCurrentReportExportTitle() {
  const modeName = currentMode === "intraday" ? "Intraday Trading" : currentMode === "swing" ? "Swing Trading" : "Long Term Trading";
  const periodName = String(currentReportPeriod || "daily").charAt(0).toUpperCase() + String(currentReportPeriod || "daily").slice(1);
  return `${modeName} - ${periodName} Report`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCurrentReportCSV() {
  captureReportInputs();
  const rows = getReportRows();
  const config = getReportConfig();
  const output = [config.headings.map(csvEscape).join(",")];
  rows.forEach(row => {
    output.push(config.headings.map((_, i) => csvEscape(row[i] || "")).join(","));
  });
  const blob = new Blob(["\ufeff" + output.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getCurrentReportExportTitle().replace(/[^a-z0-9]+/gi,"-").toLowerCase() + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("CSV exported.");
}

function exportCurrentReportPDF() {
  captureReportInputs();
  const rows = getReportRows();
  const config = getReportConfig();
  const title = getCurrentReportExportTitle();
  const head = config.headings.map(h => `<th>${safeText(h)}</th>`).join("");
  const body = rows.map(row => `<tr>${config.headings.map((_, i) => `<td>${safeText(row[i] || "")}</td>`).join("")}</tr>`).join("");
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    showToast("Allow pop-ups to export PDF.", true);
    return;
  }
  win.document.write(`<!doctype html><html><head><title>${safeText(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @page{size:A4 landscape;margin:12mm}
    body{font-family:Arial,sans-serif;color:#111;background:#fff;font-size:11px}
    h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#555}
    table{width:100%;border-collapse:collapse;table-layout:auto}
    th,td{border:1px solid #888;padding:6px 7px;text-align:left;vertical-align:middle;word-break:break-word}
    th{background:#e9eef5;font-weight:700}
    @media print{button{display:none}}
  </style></head><body><h1>${safeText(title)}</h1><p>TradeLedger</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 250);
}

/* ==========================================
   REPORT COLUMN MANAGEMENT
========================================== */

async function addReportColumn() {
  const heading = prompt("Enter new column heading:");
  if (heading === null) return;

  const name = heading.trim();
  if (!name) {
    showToast("Column heading cannot be empty.");
    return;
  }

  captureReportInputs();

  const config = getReportConfig();
  const rows = getReportRows();

  const inheritedStyle = getReportInheritanceStyle();
  const newColumnIndex = config.headings.length;
  config.headings.push(name);
  config.widths.push(120);
  config.columnStyles[newColumnIndex] = inheritedStyle;
  rows.forEach(row => row.push(""));

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("New column added.");
  } catch(error) {
    config.headings.pop();
    config.widths.pop();
    rows.forEach(row => row.pop());
    showToast("Column add failed: " + error.message);
  }
}

async function editReportColumn() {
  if (selectedReportColumn === null) {
    showToast("Select a column heading first.");
    return;
  }

  const config = getReportConfig();
  const index = selectedReportColumn;

  if (index < 0 || index >= config.headings.length) return;

  const updated = prompt("Edit column heading:",config.headings[index]);
  if (updated === null) return;

  if (!updated.trim()) {
    showToast("Column heading cannot be empty.");
    return;
  }

  captureReportInputs();
  config.headings[index] = updated.trim();

  try {
    await saveReportToDatabase();
    renderReportTable();
    selectedReportColumn = index;
    showToast("Column heading updated.");
  } catch(error) {
    showToast("Column edit failed: " + error.message);
  }
}

async function deleteReportColumn() {
  if (selectedReportColumn === null) {
    showToast("Select a column heading first.");
    return;
  }

  const config = getReportConfig();
  const index = selectedReportColumn;

  if (config.headings.length <= 1) {
    showToast("At least one report column must remain.");
    return;
  }

  if (!confirm("Delete column '" + config.headings[index] +
      "' and all its values from this report period?")) return;

  captureReportInputs();

  config.headings.splice(index,1);
  config.widths.splice(index,1);

  getReportRows().forEach(row => row.splice(index,1));

  const remapped = {};
  Object.entries(config.cells).forEach(([key,value]) => {
    const [row,column] = key.split(":").map(Number);
    if (column < index) remapped[key] = value;
    if (column > index) remapped[row + ":" + (column - 1)] = value;
  });
  config.cells = remapped;

  const newStyles = {};
  Object.entries(config.columnStyles).forEach(([key,value]) => {
    const column = Number(key);
    if (column < index) newStyles[column] = value;
    if (column > index) newStyles[column - 1] = value;
  });
  config.columnStyles = newStyles;

  selectedReportColumn = null;
  selectedReportCell = null;

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("Column deleted.");
  } catch(error) {
    showToast("Column delete failed: " + error.message);
  }
}

/* ==========================================
   REPORT DATA SAVING
========================================== */

function saveReportCell(rowIndex,column,value) {
  const rows = getReportRows();
  const config = getReportConfig();

  while (rows.length <= rowIndex) {
    rows.push(Array(config.headings.length).fill(""));
  }

  while (rows[rowIndex].length < config.headings.length) {
    rows[rowIndex].push("");
  }

  rows[rowIndex][column] = value;
}

function captureReportInputs() {
  document.querySelectorAll("[data-report-input]").forEach(input => {
    const [row,column] = input.dataset.reportInput.split(":").map(Number);
    saveReportCell(row,column,input.value);
  });

  document.querySelectorAll("[data-report-heading]").forEach(input => {
    const column = Number(input.dataset.reportHeading);
    const config = getReportConfig();
    if (column < 5) {
      config.headings[column] =
        input.value.trim() || REPORT_HEADINGS[currentReportPeriod][column];
    } else {
      config.headings[column] = input.value.trim() || "New Column";
    }
  });
}

async function addReportRow() {
  captureReportInputs();
  const rows = getReportRows();
  const config = getReportConfig();
  const oldLength = rows.length;

  rows.push(Array(config.headings.length).fill(""));

  try {
    await saveReportToDatabase();
    renderReportTable();
    showToast("Report row added.");
  } catch(error) {
    rows.splice(oldLength,1);
    renderReportTable();
    showToast("Save failed: " + error.message);
  }
}

async function deleteReportRow(index) {
  if (!confirm("Delete report row " + (index + 1) + "?")) return;

  captureReportInputs();
  getReportRows().splice(index,1);

  const config = getReportConfig();
  const newCells = {};

  Object.entries(config.cells).forEach(([key,value]) => {
    const [row,column] = key.split(":").map(Number);
    if (row < index) newCells[key] = value;
    if (row > index) newCells[(row - 1) + ":" + column] = value;
  });
  config.cells = newCells;

  const newHeights = {};
  Object.entries(config.rowHeights).forEach(([key,value]) => {
    const row = Number(key);
    if (row < index) newHeights[row] = value;
    if (row > index) newHeights[row - 1] = value;
  });
  config.rowHeights = newHeights;

  await saveReportToDatabase();
  renderReportTable();
}

async function saveReportColumn(column) {
  captureReportInputs();
  await saveReportToDatabase();
  showToast("Column saved.");
}

async function saveAllReportData() {
  captureReportInputs();
  await saveReportToDatabase();

  if ($("reportMessage")) {
    $("reportMessage").textContent = "Report saved successfully.";
  }
  showToast("Report saved.");
}

/* ==========================================
   REPORT CELL EVENTS
========================================== */

function attachReportCellEvents() {
  document.querySelectorAll("[data-report-input]").forEach(input => {
    input.addEventListener("focus",() => {
      selectedReportCell = input.dataset.reportInput;
      selectedReportColumn = null;

      document.querySelectorAll(".report-selected-cell").forEach(cell => {
        cell.classList.remove("report-selected-cell");
      });

      input.closest("td")?.classList.add("report-selected-cell");
    });

    input.addEventListener("input",() => {
      const [row,column] = input.dataset.reportInput.split(":").map(Number);
      saveReportCell(row,column,input.value);
    });
  });

  document.querySelectorAll("[data-report-input]").forEach(input => {
    input.addEventListener("paste", event => {
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!text.includes("\t") && !text.includes("\n")) return;
      event.preventDefault();
      const [startRow,startCol] = input.dataset.reportInput.split(":").map(Number);
      const matrix = text.replace(/\r/g, "").split("\n").map(line => line.split("\t"));
      const rows = getReportRows();
      const config = getReportConfig();
      matrix.forEach((values,rOffset) => {
        const r = startRow + rOffset;
        while (rows.length <= r) rows.push(Array(config.headings.length).fill(""));
        values.forEach((value,cOffset) => {
          const c = startCol + cOffset;
          while (config.headings.length <= c) {
            const newCol = config.headings.length;
            config.headings.push("New Column");
            config.widths.push(150);
            config.columnStyles[newCol] = getReportInheritanceStyle();
          }
          while (rows[r].length <= c) rows[r].push("");
          rows[r][c] = value;
        });
      });
      saveReportToDatabase().then(renderReportTable).catch(error => showToast("Paste save failed: " + error.message));
    });
  });

  document.querySelectorAll("[data-report-select-column]").forEach(header => {
    header.addEventListener("click",event => {
      if (event.target.closest("button,input")) return;

      selectedReportColumn = Number(header.dataset.reportSelectColumn);
      selectedReportCell = null;

      document.querySelectorAll(".report-selected-cell").forEach(cell => {
        cell.classList.remove("report-selected-cell");
      });

      showToast("Column selected.");
    });
  });

  document.querySelectorAll("[data-report-heading]").forEach(input => {
    input.addEventListener("focus",() => {
      selectedReportColumn = Number(input.dataset.reportHeading);
      selectedReportCell = null;
    });

    input.addEventListener("change",async () => {
      const column = Number(input.dataset.reportHeading);
      const config = getReportConfig();

      config.headings[column] = input.value.trim() ||
        (column < 5
          ? REPORT_HEADINGS[currentReportPeriod][column]
          : "New Column");

      try {
        await saveReportToDatabase();
      } catch(error) {
        showToast("Heading save failed: " + error.message);
      }
    });
  });

  document.querySelectorAll("[data-delete-report-row]").forEach(button => {
    button.addEventListener("click",() => {
      deleteReportRow(Number(button.dataset.deleteReportRow))
        .catch(error => showToast("Row delete failed: " + error.message));
    });
  });

  attachColumnResizeEvents();
  attachRowResizeEvents();
}

/* ==========================================
   REPORT RESIZING
========================================== */

document.addEventListener("keydown", event => {
  const active = document.activeElement?.closest?.("[data-report-input]");
  if (!active) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    const text = active.value || "";
    navigator.clipboard?.writeText(text).catch(() => {});
  }
});

function attachColumnResizeEvents() {
  document.querySelectorAll("[data-resize-column]").forEach(handle => {
    handle.addEventListener("pointerdown",event => {
      event.preventDefault();

      const column = Number(handle.dataset.resizeColumn);
      const config = getReportConfig();
      const startX = event.clientX;
      const startWidth = numberValue(config.widths[column]) || 150;

      const move = moveEvent => {
        config.widths[column] = Math.max(
          80,startWidth + moveEvent.clientX - startX
        );

        const header = $("reportTableContainer")
          ?.querySelectorAll("thead th")[column + 1];

        if (header) header.style.width = config.widths[column] + "px";
      };

      const end = async () => {
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",end);
        try {
          await saveReportToDatabase();
        } catch(error) {
          showToast("Column width save failed: " + error.message);
        }
      };

      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",end);
    });
  });
}

function attachRowResizeEvents() {
  document.querySelectorAll("[data-resize-row]").forEach(handle => {
    handle.addEventListener("pointerdown",event => {
      event.preventDefault();

      const rowIndex = Number(handle.dataset.resizeRow);
      const row = handle.closest("tr");
      const startY = event.clientY;
      const startHeight = row?.getBoundingClientRect().height || 44;
      const config = getReportConfig();

      const move = moveEvent => {
        const height = Math.max(32,startHeight + moveEvent.clientY - startY);
        config.rowHeights[rowIndex] = height;
        if (row) row.style.height = height + "px";
      };

      const end = async () => {
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",end);
        try {
          await saveReportToDatabase();
        } catch(error) {
          showToast("Row height save failed: " + error.message);
        }
      };

      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",end);
    });
  });
}

/* ==========================================
   REPORT FORMATTING
========================================== */

function getSelectedReportCells() {
  if (!selectedReportCell) return [];
  const [row,column] = selectedReportCell.split(":").map(Number);
  return [{row,column}];
}

function getReportInheritanceStyle() {
  const config = getReportConfig();
  if (selectedReportCell) {
    const [row,column] = selectedReportCell.split(":").map(Number);
    return cloneSpreadsheetStyle({
      ...(config.columnStyles[column] || {}),
      ...(config.cells[row + ":" + column] || {})
    });
  }
  if (selectedReportColumn !== null) {
    return cloneSpreadsheetStyle(config.columnStyles[selectedReportColumn] || config.defaultStyle);
  }
  return cloneSpreadsheetStyle(config.defaultStyle);
}

function applyReportFormatting(property,value) {
  const config = getReportConfig();
  const selected = getSelectedReportCells();

  config.defaultStyle = cloneSpreadsheetStyle(config.defaultStyle);
  config.defaultStyle[property] = value;

  if (selected.length) {
    selected.forEach(({row,column}) => {
      const key = row + ":" + column;
      config.cells[key] = config.cells[key] || {};
      config.cells[key][property] = value;
    });
  } else if (selectedReportColumn !== null) {
    const column = selectedReportColumn;
    config.columnStyles[column] = config.columnStyles[column] || {};
    config.columnStyles[column][property] = value;
  } else {
    showToast("Select a cell or column first.");
    return;
  }

  saveReportToDatabase()
    .then(renderReportTable)
    .catch(error => showToast("Formatting save failed: " + error.message));
}

function toggleReportFormatting(property) {
  const config = getReportConfig();
  const selected = getSelectedReportCells();
  let value;

  if (selected.length) {
    const {row,column} = selected[0];
    const key = row + ":" + column;
    const current = config.cells[key]?.[property] ?? config.columnStyles[column]?.[property] ?? config.defaultStyle[property];
    value = !current;
    selected.forEach(({row,column}) => {
      const k = row + ":" + column;
      config.cells[k] = config.cells[k] || {};
      config.cells[k][property] = value;
    });
  } else if (selectedReportColumn !== null) {
    const column = selectedReportColumn;
    const st = config.columnStyles[column] || (config.columnStyles[column] = {});
    value = !(st[property] ?? config.defaultStyle[property]);
    st[property] = value;
  } else {
    showToast("Select a cell or column first.");
    return;
  }

  config.defaultStyle[property] = value;
  saveReportToDatabase()
    .then(renderReportTable)
    .catch(error => showToast(error.message));
}

/* ==========================================
   GOOGLE DRIVE CONNECTION
========================================== */


function getDriveConnection() {
  return readJSON(DRIVE_CONNECTION_KEY,null);
}

function saveDriveConnection(data) {
  writeJSON(DRIVE_CONNECTION_KEY,data);
}

function updateDriveStatus() {
  const saved = getDriveConnection();
  const connected = Boolean(saved?.connected);

  if ($("driveStatus")) {
    $("driveStatus").textContent = connected
      ? "Connected to Google Drive"
      : "Not connected";
  }

  if ($("connectDriveBtn")) {
    $("connectDriveBtn").disabled = false;
    $("connectDriveBtn").textContent = connected
      ? "Reconnect Google Drive"
      : "Connect Google Drive";
  }

  if ($("disconnectDriveBtn")) {
    $("disconnectDriveBtn").disabled = !connected;
  }
  if ($("driveBackupBtn")) {
    $("driveBackupBtn").disabled = !connected;
  }
  if ($("restoreDriveBackupBtn")) {
    $("restoreDriveBackupBtn").disabled = !connected;
  }

  driveFolderId = connected ? saved.folderId || null : null;
  driveBackupFileId = connected ? saved.backupFileId || null : null;
}

function showDriveMessage(message,isError = false) {
  const element = $("driveMessage");
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "#ef4444" : "#22c55e";
}

/* ==========================================
   GOOGLE OAUTH - GIS TOKEN CLIENT
========================================== */

function initializeDriveTokenClient() {
  if (!window.google?.accounts?.oauth2) {
    showDriveMessage("Google Identity Services is unavailable.",true);
    return false;
  }

  if (driveTokenClient) return true;

  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id:GOOGLE_CLIENT_ID,
    scope:DRIVE_SCOPE,

    callback:response => {
      if (response.error || !response.access_token) {
        const error = new Error(
          response.error || "Google authorization failed."
        );

        drivePendingReject?.(error);
        drivePendingResolve = null;
        drivePendingReject = null;
        const detail = response.error_description || response.error || "Google authorization failed.";
        showDriveMessage("Google authorization failed: " + detail,true);
        return;
      }

      driveAccessToken = response.access_token;
      drivePendingResolve?.(driveAccessToken);
      drivePendingResolve = null;
      drivePendingReject = null;
    }
  });

  return true;
}

function requestDriveToken(promptValue) {
  if (!initializeDriveTokenClient()) {
    return Promise.reject(
      new Error("Google Identity Services unavailable.")
    );
  }

  return new Promise((resolve,reject) => {
    drivePendingResolve = resolve;
    drivePendingReject = reject;

    try {
      driveTokenClient.requestAccessToken({prompt:promptValue});
    } catch(error) {
      drivePendingResolve = null;
      drivePendingReject = null;
      reject(error);
    }
  });
}

async function connectGoogleDrive() {
  try {
    showDriveMessage("Opening Google authorization...");
    await requestDriveToken("consent");
    await finishDriveConnection();
  } catch(error) {
    showDriveMessage("Google Drive connection failed: " + error.message,true);
  }
}

async function refreshDriveToken() {
  if (driveAccessToken) return driveAccessToken;

  try {
    return await requestDriveToken("");
  } catch(error) {
    throw new Error(
      "Drive session expired. Tap Reconnect Google Drive and authorize again."
    );
  }
}

function getDriveHeaders() {
  if (!driveAccessToken) {
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }
  return {Authorization:"Bearer " + driveAccessToken};
}

/* ==========================================
   DRIVE API REQUESTS
========================================== */

async function driveRequest(url,options = {}) {
  const response = await fetch(url,{
    ...options,
    headers:{
      ...getDriveHeaders(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    driveAccessToken = null;
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Google Drive error " + response.status + ": " + detail);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function findDriveFolder() {
  const query = encodeURIComponent(
    "name='" + DRIVE_FOLDER_NAME +
    "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );

  const result = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?q=" +
    query + "&fields=files(id,name,mimeType)"
  );

  return result.files?.[0] || null;
}

async function createDriveFolder() {
  return driveRequest("https://www.googleapis.com/drive/v3/files",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      name:DRIVE_FOLDER_NAME,
      mimeType:"application/vnd.google-apps.folder"
    })
  });
}

async function findDriveBackupFile(folderId) {
  const query = encodeURIComponent(
    "'" + folderId + "' in parents and name='" +
    DRIVE_BACKUP_NAME + "' and trashed=false"
  );

  const result = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?q=" +
    query + "&fields=files(id,name,mimeType,modifiedTime)"
  );

  return result.files?.[0] || null;
}

async function ensureDriveFolder() {
  let folder = driveFolderId ? {id:driveFolderId} : null;
  if (!folder) folder = await findDriveFolder();
  if (!folder) folder = await createDriveFolder();

  driveFolderId = folder.id;
  return folder.id;
}

async function ensureDriveBackupFile() {
  const folderId = await ensureDriveFolder();
  const file = await findDriveBackupFile(folderId);
  driveBackupFileId = file?.id || null;
  return file;
}

async function finishDriveConnection() {
  showDriveMessage("Checking Google Drive...");

  const folderId = await ensureDriveFolder();
  const file = await findDriveBackupFile(folderId);

  driveFolderId = folderId;
  driveBackupFileId = file?.id || null;

  saveDriveConnection({
    connected:true,
    folderId,
    backupFileId:driveBackupFileId,
    connectedAt:new Date().toISOString()
  });

  updateDriveStatus();
  showDriveMessage("Google Drive connected successfully.");
}

/* ==========================================
   DISCONNECT GOOGLE DRIVE
========================================== */

function disconnectGoogleDrive() {
  if (!confirm("Disconnect Google Drive from this browser?")) return;

  const token = driveAccessToken;

  driveAccessToken = null;
  driveFolderId = null;
  driveBackupFileId = null;
  driveTokenClient = null;
  drivePendingResolve = null;
  drivePendingReject = null;

  localStorage.removeItem(DRIVE_CONNECTION_KEY);

  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token,() => {});
  }

  updateDriveStatus();
  showDriveMessage("Google Drive disconnected.");
}

/* ==========================================
   BACKUP DATA
========================================== */

async function createDriveBackupData() {
  captureReportInputs();
  await saveReportToDatabase();

  return {
    app:"TradeLedger",
    version:7,
    backupDate:new Date().toISOString(),
    trades,
    fields,
    columnSettings:getFieldSettings(),
    reports:reportData,
    reportSettings,
    brokerData,
    metadata:{
      reportStorage:"IndexedDB + localStorage",
      tradeModes:["intraday","swing","longterm"]
    }
  };
}

function validateBackup(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backup file.");
  }
  if (!Array.isArray(data.trades)) {
    throw new Error("Backup does not contain a valid trades list.");
  }
  if (!Array.isArray(data.fields)) {
    throw new Error("Backup does not contain a valid fields list.");
  }
  if (data.reports !== undefined &&
      (!data.reports || typeof data.reports !== "object" ||
       Array.isArray(data.reports))) {
    throw new Error("Invalid reports data.");
  }
  if (data.brokerData !== undefined &&
      (!data.brokerData || typeof data.brokerData !== "object" || Array.isArray(data.brokerData))) {
    throw new Error("Invalid broker transaction data.");
  }
  if (data.reportSettings !== undefined &&
      (!data.reportSettings || typeof data.reportSettings !== "object" ||
       Array.isArray(data.reportSettings))) {
    throw new Error("Invalid report settings.");
  }

  data.trades.forEach((trade,index) => {
    if (!trade || typeof trade !== "object" || trade.id == null) {
      throw new Error("Invalid trade record at row " + (index + 1));
    }
  });

  data.fields.forEach((field,index) => {
    if (!field || typeof field !== "object" || field.id == null) {
      throw new Error("Invalid custom field at row " + (index + 1));
    }
  });

  return true;
}

/* ==========================================
   RESUMABLE DRIVE UPLOAD
========================================== */

async function startDriveResumableUpload(fileId,folderId,jsonText) {
  const metadata = fileId
    ? {name:DRIVE_BACKUP_NAME}
    : {name:DRIVE_BACKUP_NAME,parents:[folderId]};

  const startUrl = fileId
    ? "https://www.googleapis.com/upload/drive/v3/files/" +
      fileId + "?uploadType=resumable"
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";

  const startResponse = await fetch(startUrl,{
    method:fileId ? "PATCH" : "POST",
    headers:{
      ...getDriveHeaders(),
      "Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Type":"application/json"
    },
    body:JSON.stringify(metadata)
  });

  if (startResponse.status === 401) {
    driveAccessToken = null;
    throw new Error("Drive session expired. Reconnect Google Drive.");
  }

  if (!startResponse.ok) {
    throw new Error(
      "Could not start Google Drive upload: " +
      await startResponse.text()
    );
  }

  const uploadUrl = startResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Google Drive upload session URL is missing.");
  }

  const uploadResponse = await fetch(uploadUrl,{
    method:"PUT",
    headers:{
      Authorization:"Bearer " + driveAccessToken,
      "Content-Type":"application/json"
    },
    body:new Blob([jsonText],{type:"application/json"})
  });

  if (uploadResponse.status === 401) {
    driveAccessToken = null;
    throw new Error("Drive session expired. Reconnect Google Drive.");
  }

  if (!uploadResponse.ok) {
    throw new Error(
      "Backup upload failed: HTTP " +
      uploadResponse.status + " " +
      await uploadResponse.text()
    );
  }

  return uploadResponse.json();
}

/* ==========================================
   BACKUP TO GOOGLE DRIVE
========================================== */

async function backupToGoogleDrive() {
  try {
    showDriveMessage("Preparing backup...");
    await refreshDriveToken();

    const folderId = await ensureDriveFolder();
    const existingFile = await findDriveBackupFile(folderId);
    const backup = await createDriveBackupData();
    const jsonText = JSON.stringify(backup,null,2);

    const result = await startDriveResumableUpload(
      existingFile?.id || null,
      folderId,
      jsonText
    );

    driveBackupFileId = result.id;
    const oldConnection = getDriveConnection();

    saveDriveConnection({
      connected:true,
      folderId,
      backupFileId:driveBackupFileId,
      connectedAt:oldConnection?.connectedAt || new Date().toISOString()
    });

    if ($("driveBackupInfo")) {
      $("driveBackupInfo").textContent =
        "Last backup: " + new Date().toLocaleString();
    }

    updateDriveStatus();
    showDriveMessage("Backup completed successfully.");
    showToast("Google Drive backup completed.");

  } catch(error) {
    console.error(error);
    showDriveMessage(error.message,true);
  }
}

/* ==========================================
   DOWNLOAD DRIVE BACKUP
========================================== */

async function downloadDriveBackup() {
  await refreshDriveToken();

  const file = await ensureDriveBackupFile();
  if (!file) {
    throw new Error("TradeLedger-Backup.json was not found in Google Drive.");
  }

  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files/" +
    file.id + "?alt=media",
    {headers:getDriveHeaders()}
  );

  if (response.status === 401) {
    driveAccessToken = null;
    throw new Error("Google Drive session expired. Reconnect Google Drive.");
  }

  if (!response.ok) {
    throw new Error("Could not download backup from Google Drive.");
  }

  return {file,data:await response.json()};
}

/* ==========================================
   RESTORE VALIDATION
========================================== */

function validateStoreRecords(store,records,storeName) {
  const keyPath = store.keyPath;

  records.forEach((record,index) => {
    if (!record || typeof record !== "object") {
      throw new Error(
        "Invalid " + storeName + " record at row " + (index + 1)
      );
    }

    if (typeof keyPath === "string") {
      if (record[keyPath] === undefined || record[keyPath] === null) {
        throw new Error(storeName + " record is missing key: " + keyPath);
      }
    } else if (Array.isArray(keyPath)) {
      if (keyPath.some(key =>
        record[key] === undefined || record[key] === null
      )) {
        throw new Error(storeName + " record does not match database key structure.");
      }
    } else if (record.id === undefined || record.id === null) {
      throw new Error(storeName + " record is missing its ID.");
    }
  });
}

function putRestoreRecord(store,record) {
  if (store.keyPath === null) store.put(record,record.id);
  else store.put(record);
}

/* ==========================================
   FULL RESTORE
========================================== */

async function applyFullBackupToDatabase(data) {
  validateBackup(data);
  await waitForDatabase();

  const requiredStores = ["trades","fields","reports"];

  for (const name of requiredStores) {
    if (!db.objectStoreNames.contains(name)) {
      throw new Error("Required database store is missing: " + name);
    }
  }

  const backupTrades = data.trades;
  const backupFields = data.fields;

  const restoredReports = data.reports || {
    daily:[],weekly:[],monthly:[],yearly:[]
  };

  const restoredSettings = data.reportSettings || {};
  const restoredColumnSettings = data.columnSettings || {};
  const restoredBroker = data.brokerData || {headings:["Date","Amount Received","Amount Paid"],rows:[],widths:[120,170,150],rowHeights:{},cells:{},columnStyles:{},defaultStyle:{}};

  const checkTransaction = db.transaction(requiredStores,"readonly");
  const checkDone = transactionComplete(checkTransaction);

  try {
    validateStoreRecords(
      checkTransaction.objectStore("trades"),backupTrades,"trades"
    );
    validateStoreRecords(
      checkTransaction.objectStore("fields"),backupFields,"fields"
    );
    validateStoreRecords(
      checkTransaction.objectStore("reports"),
      [{id:"main-reports",data:restoredReports,settings:restoredSettings}],
      "reports"
    );
    await checkDone;
  } catch(error) {
    try { checkTransaction.abort(); } catch(ignore) {}
    await checkDone.catch(() => {});
    throw error;
  }

  const transaction = db.transaction(requiredStores,"readwrite");
  const done = transactionComplete(transaction);

  const tradeStore = transaction.objectStore("trades");
  const fieldStore = transaction.objectStore("fields");
  const reportStore = transaction.objectStore("reports");

  tradeStore.clear();
  fieldStore.clear();
  reportStore.clear();

  backupTrades.forEach(record => putRestoreRecord(tradeStore,record));
  backupFields.forEach(record => putRestoreRecord(fieldStore,record));

  putRestoreRecord(reportStore,{
    id:"main-reports",
    data:restoredReports,
    settings:restoredSettings,
    updatedAt:new Date().toISOString()
  });

  await done;

  trades = backupTrades;
  fields = backupFields;
  reportData = restoredReports;
  reportSettings = restoredSettings;
  brokerData = restoredBroker;
  brokerData.defaultStyle = cloneSpreadsheetStyle(brokerData.defaultStyle);
  if (brokerData.headings?.[0] === "Date" && brokerData.headings?.[1] === "Amount Paid" && brokerData.headings?.[2] === "Amount Received") {
    brokerData.rows = (brokerData.rows || []).map(row => [row?.[0] ?? "", row?.[2] ?? "", row?.[1] ?? ""]);
    const ow = Array.isArray(brokerData.widths) ? brokerData.widths : [];
    brokerData.widths = [ow[0] || 120, ow[2] || 170, ow[1] || 150];
    const oc = brokerData.cells || {}, nc = {};
    Object.entries(oc).forEach(([key, value]) => { const [r,c] = key.split(":").map(Number); if(c===0) nc[r+":0"]=value; else if(c===1) nc[r+":2"]=value; else if(c===2) nc[r+":1"]=value; });
    brokerData.cells = nc;
    const os = brokerData.columnStyles || {};
    brokerData.columnStyles = {0:os[0]||{},1:os[2]||{},2:os[1]||{}};
  }
  writeJSON(BROKER_DATA_KEY, brokerData);

  saveFieldSettings(restoredColumnSettings);
  saveReportsLocally();

  await renderEverything();
}

async function restoreFromGoogleDrive() {
  if (!confirm(
    "Full Restore will replace current Trades, Fields and Reports " +
    "with the Google Drive backup. Continue?"
  )) return;

  try {
    showDriveMessage("Downloading backup...");
    const {data} = await downloadDriveBackup();

    validateBackup(data);
    showDriveMessage("Validating backup...");

    await applyFullBackupToDatabase(data);

    showDriveMessage("Full Restore completed successfully.");
    showToast("TradeLedger restored from Google Drive.");
  } catch(error) {
    console.error(error);
    showDriveMessage(error.message,true);
  }
}

/* ==========================================
   ATTACHMENTS
========================================== */

function readFileAsDataURL(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name:file.name,
      type:file.type,
      data:reader.result
    });

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleAttachmentChange() {
  try {
    const chartFiles = Array.from($("chartImages")?.files || []);
    const contractFiles = Array.from($("contractNote")?.files || []);

    const files = [
      ...chartFiles.map(file => ({file,category:"chart"})),
      ...contractFiles.map(file => ({file,category:"contract"}))
    ];

    const loaded = await Promise.all(files.map(async item => ({
      ...(await readFileAsDataURL(item.file)),
      category:item.category
    })));

    currentAttachments = [
      ...currentAttachments.filter(item =>
        !files.some(file => file.category === item.category)
      ),
      ...loaded
    ];

    if ($("attachmentInfo")) {
      $("attachmentInfo").textContent =
        currentAttachments.length + " attachment(s) ready.";
    }
  } catch(error) {
    showToast("Could not read attachment: " + error.message);
  }
}

/* ==========================================
   REPORT TOOLBAR
========================================== */

function setupReportToolbar() {
  $("reportTextColor")?.addEventListener("change",event => {
    applyReportFormatting("color",event.target.value);
  });

  $("reportCellColor")?.addEventListener("change",event => {
    applyReportFormatting("background",event.target.value);
  });

  $("reportFontSize")?.addEventListener("change",event => {
    applyReportFormatting("fontSize",event.target.value);
  });

  $("reportFontFamily")?.addEventListener("change",event => {
    applyReportFormatting("fontFamily",event.target.value);
  });

  document.querySelectorAll("[data-report-halign]").forEach(button => {
    button.addEventListener("click", () => {
      applyReportFormatting("align", button.dataset.reportHalign);
      document.querySelectorAll("[data-report-halign]").forEach(x => x.classList.toggle("active", x === button));
    });
  });

  document.querySelectorAll("[data-report-valign]").forEach(button => {
    button.addEventListener("click", () => {
      applyReportFormatting("vertical", button.dataset.reportValign);
      document.querySelectorAll("[data-report-valign]").forEach(x => x.classList.toggle("active", x === button));
    });
  });

  $("reportBoldBtn")?.addEventListener("click",() => {
    toggleReportFormatting("bold");
  });

  $("reportItalicBtn")?.addEventListener("click",() => {
    toggleReportFormatting("italic");
  });

  $("reportWrapBtn")?.addEventListener("click",() => {
    const config = getReportConfig();
    const selected = getSelectedReportCells();

    if (selected.length) {
      const {row,column} = selected[0];
      const key = row + ":" + column;
      config.cells[key] = config.cells[key] || {};
      config.cells[key].wrap = config.cells[key].wrap === false;
    } else if (selectedReportColumn !== null) {
      const column = selectedReportColumn;
      config.columnStyles[column] = config.columnStyles[column] || {};
      config.columnStyles[column].wrap =
        config.columnStyles[column].wrap === false;
    } else {
      showToast("Select a cell or column first.");
      return;
    }

    saveReportToDatabase()
      .then(renderReportTable)
      .catch(error => showToast(error.message));
  });
}

/* ==========================================
   PERIOD OVERVIEW EVENTS
========================================== */

function setupPeriodOverview() {
  $("periodApplyBtn")?.addEventListener("click",renderPeriodOverview);

  $("periodResetBtn")?.addEventListener("click",() => {
    if ($("periodStartDate")) $("periodStartDate").value = "";
    if ($("periodEndDate")) $("periodEndDate").value = "";
    renderPeriodOverview();
  });
}

/* ==========================================
   EVENT BINDINGS
========================================== */

function setupEventListeners() {
  if (eventsInitialized) return;

  setupPWAInstall();

  document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click",() => {
      setTradingMode(button.dataset.mode);
    });
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click",() => {
      // Dashboard buttons use data-mode-dashboard while the other
      // navigation buttons use data-section. Both must route through
      // showSection() so returning to Dashboard hides Add Trade, Journal,
      // Period Overview, Reports and Field Manager.
      const sectionId = button.dataset.section || button.dataset.modeDashboard;
      if (sectionId) showSection(sectionId);
    });
  });

  document.querySelectorAll(".report-tab").forEach(button => {
    button.addEventListener("click",() => {
      setReportPeriod(button.dataset.reportPeriod);
    });
  });

  $("newTradeBtn")?.addEventListener("click",() => {
    resetForm();
    showSection("tradeFormSection");
  });

  document.querySelectorAll("[data-open-trade]").forEach(button => {
    button.addEventListener("click",() => {
      resetForm();
      showSection("tradeFormSection");
    });
  });

  $("tradeForm")?.addEventListener("submit",saveTrade);
  $("tradeForm")?.addEventListener("input",event => {
    if (["buyQty","buyPrice","buyCharge","extraBuyCharge","sellQty","sellPrice","sellCharge","extraSellCharge"].includes(event.target.id)) calculateTrade();
  });
  $("resetTradeBtn")?.addEventListener("click",resetForm);

  [
    "buyQty","buyPrice","buyCharge","extraBuyCharge",
    "sellQty","sellPrice","sellCharge","extraSellCharge"
  ].forEach(id => {
    $(id)?.addEventListener("input",calculateTrade);
  });

  $("journalSearch")?.addEventListener("input",renderJournal);
  setupExportMenu("exportJournalBtn", "exportJournalMenu", {
    "journal-csv": exportJournalCSV,
    "journal-pdf": exportJournalPDF
  });

  document.querySelectorAll(".mode-add-field-btn, #addFieldBtn").forEach(button => {
    button.addEventListener("click",() => {
      closeFieldModal();
      if ($("fieldModalTitle")) {
        $("fieldModalTitle").textContent = "Add Custom Field";
      }
      openFieldModal();
    });
  });

  $("fieldForm")?.addEventListener("submit",saveField);
  $("closeFieldManagerModal")?.addEventListener("click",closeFieldModal);
  $("cancelFieldEdit")?.addEventListener("click",closeFieldModal);

  $("closeViewBtn")?.addEventListener("click",() => {
    $("viewModal")?.classList.add("hidden");
  });

  $("chartImages")?.addEventListener("change",handleAttachmentChange);
  $("contractNote")?.addEventListener("change",handleAttachmentChange);

  $("connectDriveBtn")?.addEventListener("click",connectGoogleDrive);
  $("disconnectDriveBtn")?.addEventListener("click",disconnectGoogleDrive);
  $("driveBackupBtn")?.addEventListener("click",backupToGoogleDrive);
  $("restoreDriveBackupBtn")?.addEventListener("click",restoreFromGoogleDrive);

  $("reportAddRowBtn")?.addEventListener("click",addReportRow);

  $("reportSaveAllBtn")?.addEventListener("click",() => {
    saveAllReportData().catch(error => {
      showToast("Report save failed: " + error.message);
    });
  });

  $("reportDeleteRowBtn")?.addEventListener("click",() => {
    if (!selectedReportCell) {
      showToast("Select a cell in the row first.");
      return;
    }
    const rowIndex = Number(selectedReportCell.split(":")[0]);
    deleteReportRow(rowIndex).catch(error => {
      showToast("Row delete failed: " + error.message);
    });
  });

  setupReportToolbar();
  setupBrokerToolbar();
  setupPeriodOverview();

  // Delegated actions: remain active after dynamic HTML rendering.
  document.addEventListener("click",event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const viewButton = target.closest("[data-view-trade]");
    if (viewButton) {
      viewTrade(viewButton.dataset.viewTrade);
      return;
    }

    const editButton = target.closest("[data-edit-trade]");
    if (editButton) {
      editTrade(editButton.dataset.editTrade);
      return;
    }

    const deleteButton = target.closest("[data-delete-trade]");
    if (deleteButton) {
      removeTrade(deleteButton.dataset.deleteTrade);
      return;
    }

    const modeDashboardButton = target.closest("[data-mode-dashboard]");
    if (modeDashboardButton) {
      // Use the same section router as every other navigation action.
      // This is important because simply toggling the dashboard section
      // leaves the shared Add Trade/Journal/Reports/Field Manager nodes
      // visible underneath it.
      showSection(modeDashboardButton.dataset.modeDashboard);
      renderModeDashboard(currentMode);
      return;
    }

    const standardEdit = target.closest("[data-edit-standard]");
    if (standardEdit) {
      editStandardField(standardEdit.dataset.editStandard);
      return;
    }

    const standardToggle = target.closest("[data-toggle-standard]");
    if (standardToggle) {
      toggleStandardField(standardToggle.dataset.toggleStandard);
      return;
    }

    const unifiedMove = target.closest("[data-move-unified]");
    if (unifiedMove) {
      moveUnifiedField(unifiedMove.dataset.moveUnified,unifiedMove.dataset.kind,unifiedMove.dataset.direction);
      return;
    }

    const standardDelete = target.closest("[data-delete-standard]");
    if (standardDelete) {
      deleteStandardField(standardDelete.dataset.deleteStandard);
      return;
    }

    const customEdit = target.closest("[data-edit-custom]");
    if (customEdit) {
      editCustomField(customEdit.dataset.editCustom);
      return;
    }

    const moveField = target.closest("[data-move-field]");
    if (moveField) {
      moveCustomField(moveField.dataset.moveField,moveField.dataset.direction);
      return;
    }

    const toggleField = target.closest("[data-toggle-field]");
    if (toggleField) {
      toggleCustomField(toggleField.dataset.toggleField);
      return;
    }

    const deleteField = target.closest("[data-delete-field]");
    if (deleteField) {
      deleteCustomField(deleteField.dataset.deleteField);
    }
  });

  eventsInitialized = true;
}

/* ==========================================
   PWA INSTALL
========================================== */

let deferredInstallPrompt = null;

function setupPWAInstall() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showToast("TradeLedger installed successfully.");
  });

  $("installAppBtn")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      if (result?.outcome === "accepted") deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }

    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true) {
      showToast("TradeLedger is already installed.");
      return;
    }

    showToast("Your browser has not made the install prompt available yet. Open Chrome menu → Install app / Add to Home screen.");
  });

  updateInstallButton();
}

function updateInstallButton() {
  const button = $("installAppBtn");
  if (!button) return;
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true) {
    button.textContent = "App Installed";
    button.disabled = true;
  } else {
    button.textContent = "Install App";
    button.disabled = false;
  }
}

/* ==========================================
   RENDER EVERYTHING
========================================== */

async function renderEverything() {
  renderDashboard();
  renderJournal();
  renderPeriodOverview();
  renderFieldList();
  renderStandardFormFields();
  renderCustomFormFields();
  renderReportTable();
  updateDriveStatus();
}

/* ==========================================
   APPLICATION STARTUP
========================================== */

async function initializeDatabaseAndData() {
  await openDatabase();
  await loadDatabaseData();
  await loadReportsFromDatabase();
  databaseReady = true;
}

async function startApp() {
  try {
    ensureModeFieldManagerSections();
    setupEventListeners();

    setTradingMode("intraday");
    showSection("dashboardSection");
    updateDriveStatus();

    // Create the shared promise immediately so button actions can await it.
    databaseReadyPromise = initializeDatabaseAndData();

    await databaseReadyPromise;

    if ($("tradeDate") && !$("tradeDate").value) {
      $("tradeDate").value = new Date().toISOString().slice(0,10);
    }

    updateDriveStatus();
    setTradingMode(currentMode);
    showSection(currentSection);
    calculateTrade();

    await renderEverything();

    console.log("TradeLedger started successfully.");
    showToast("TradeLedger is ready.");

  } catch(error) {
    databaseReady = false;
    console.error("TradeLedger startup error:",error);

    showToast("Database loading failed: " + error.message);

    alert(
      "TradeLedger database could not be loaded.\n\n" +
      error.message +
      "\n\nYour existing data has not been intentionally deleted. " +
      "Do not clear browser data or IndexedDB."
    );
  }
}

/* ==========================================
   APPLICATION BOOT
========================================== */

function bootTradeLedger() {
  if (tradeLedgerBooted) return;
  tradeLedgerBooted = true;
  startApp();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded",bootTradeLedger,{once:true});
} else {
  bootTradeLedger();
        }
