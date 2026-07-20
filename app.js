const STORAGE_KEY = "focus-orb-state-v1";
const GACHA_COST = 5;
const STOPWATCH_REWARD_SECONDS = 5 * 60;
const MEDIA_DB_NAME = "questia-media-v1";
const MEDIA_STORE_NAME = "character-images";
const BACKUP_FORMAT = "questia-backup";
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_MAX_BYTES = 512 * 1024 * 1024;
const MEDIA_STORES = [MEDIA_STORE_NAME, "packs", "pack-characters", "pack-assets"];
const COLOR_THEMES = Object.freeze({
  sky: { label: "水色", accent: "#74c9ff", accent2: "#b9e8ff", ambient: "rgba(82,182,255,.18)" },
  pink: { label: "ピンク", accent: "#ff8fc5", accent2: "#ffc4df", ambient: "rgba(255,105,178,.17)" },
  orange: { label: "オレンジ", accent: "#ff9d62", accent2: "#ffc6a3", ambient: "rgba(255,128,68,.17)" },
  yellow: { label: "イエロー", accent: "#ffcc70", accent2: "#ffe0a6", ambient: "rgba(255,190,72,.16)" },
  mint: { label: "ミント", accent: "#72d8ba", accent2: "#b0eddc", ambient: "rgba(75,201,165,.16)" },
  purple: { label: "パープル", accent: "#aa9cff", accent2: "#d1caff", ambient: "rgba(133,112,255,.17)" },
  brown: { label: "ブラウン", accent: "#c99568", accent2: "#e3bd9b", ambient: "rgba(174,112,66,.17)" },
  silver: { label: "シルバー", accent: "#b9c4d1", accent2: "#dce3ea", ambient: "rgba(157,174,194,.17)" }
});
const COMPANION_PRESETS = Object.freeze([
  { id: "01", name: "星夜の配信者", caption: "ORIGINAL", src: "assets/companion-streamer-01.webp" },
  { id: "02", name: "ブルールーム", caption: "GIRL", src: "assets/companion-02.webp" },
  { id: "03", name: "夜更かしパートナー", caption: "BOY", src: "assets/companion-03.webp" },
  { id: "04", name: "ねこみみルーム", caption: "CAT GIRL", src: "assets/companion-04.webp" },
  { id: "05", name: "いぬみみルーム", caption: "DOG GIRL", src: "assets/companion-05.webp" },
  { id: "07", name: "子猫の相棒", caption: "KITTEN", src: "assets/companion-07.webp" },
  { id: "08", name: "子犬の相棒", caption: "PUPPY", src: "assets/companion-08.webp" }
]);

const initialState = {
  orbs: 100,
  testOrbGrantApplied: true,
  testOrbGrant50Applied: true,
  testOrbGrant100Applied: true,
  testOrbReset100Applied: true,
  companionDefault20260720Applied: true,
  companionStreamer01Applied: true,
  totalFocusMinutes: 0,
  completedSessions: [],
  tasks: [],
  owned: [],
  pullCounts: {},
  collectionSnapshots: {},
  customCharacters: [],
  settings: {
    focusMinutes: 25,
    breakMinutes: 5,
    theme: "dark",
    colorTheme: "yellow",
    gachaSource: "standard",
    includePacksInStandard: true
  },
  companionPreset: "01",
  companionImage: null
};

let state = loadState();
let timer = {
  kind: "pomodoro",
  mode: "focus",
  running: false,
  endAt: null,
  remaining: state.settings.focusMinutes * 60,
  duration: state.settings.focusMinutes * 60,
  stopwatchElapsed: 0,
  stopwatchStartedAt: null,
  stopwatchAwardedOrbs: 0,
  interval: null
};
let calendarCursor = new Date();
let pendingGachaResult = null;
let gachaAnimationTimers = [];
let mediaReady = Promise.resolve();
let installedPacks = [];
let packCharacters = [];
let pendingPack = null;
let packPreviewUrls = [];
let timerAudioContext = null;
let preparedBackupFile = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function createUniqueId(prefix = "item") {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return `${prefix}-${[...values].map(value => value.toString(16).padStart(8, "0")).join("")}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    // 初期版をすでに試している端末にも、テスト用オーブを一度だけ付与する。
    if (parsed && parsed.testOrbGrantApplied !== true) {
      parsed.orbs = Number(parsed.orbs || 0) + 20;
      parsed.testOrbGrantApplied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    // ガチャ演出・コレクション確認用の追加テストチャージ。
    if (parsed && parsed.testOrbGrant50Applied !== true) {
      parsed.orbs = Number(parsed.orbs || 0) + 50;
      parsed.testOrbGrant50Applied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    // 登録キャラクター限定ガチャの確認用に、一度だけ100オーブを追加する。
    if (parsed && parsed.testOrbGrant100Applied !== true) {
      parsed.orbs = Number(parsed.orbs || 0) + 100;
      parsed.testOrbGrant100Applied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    // テスト用残高を100オーブへ戻す（既存の利用環境にも一度だけ適用）。
    if (parsed && parsed.testOrbReset100Applied !== true) {
      parsed.orbs = 100;
      parsed.testOrbReset100Applied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    // 新しい配信イラストを、既存の利用環境にも一度だけ反映する。
    if (parsed && parsed.companionDefault20260720Applied !== true) {
      parsed.companionImage = null;
      parsed.companionDefault20260720Applied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    // 固有URLへ変更した配信イラストを、既存の利用環境にも一度だけ適用する。
    if (parsed && parsed.companionStreamer01Applied !== true) {
      parsed.companionImage = null;
      parsed.companionStreamer01Applied = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    const owned = Array.isArray(parsed?.owned) ? parsed.owned : [];
    const pullCounts = parsed?.pullCounts && typeof parsed.pullCounts === "object"
      ? { ...parsed.pullCounts }
      : Object.fromEntries(owned.map(id => [id, 1]));
    return {
      ...initialState,
      ...parsed,
      settings: { ...initialState.settings, ...(parsed?.settings || {}) },
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [],
      owned,
      pullCounts,
      collectionSnapshots: parsed?.collectionSnapshots && typeof parsed.collectionSnapshots === "object" ? parsed.collectionSnapshots : {},
      completedSessions: Array.isArray(parsed?.completedSessions) ? parsed.completedSessions : [],
      customCharacters: Array.isArray(parsed?.customCharacters) ? parsed.customCharacters : []
    };
  } catch {
    return structuredClone(initialState);
  }
}

function getPersistableState() {
  return {
    ...state,
    customCharacters: state.customCharacters.map(character => {
      const { image, ...metadata } = character;
      // 旧形式のdata URLだけは、IndexedDBへの移行が終わるまで保持する。
      return image?.startsWith("data:") ? { ...metadata, image } : metadata;
    })
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistableState()));
}

function openMediaDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("このブラウザは画像保存に対応していません"));
      return;
    }
    const request = indexedDB.open(MEDIA_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        database.createObjectStore(MEDIA_STORE_NAME);
      }
      if (!database.objectStoreNames.contains("packs")) {
        database.createObjectStore("packs", { keyPath: "packId" });
      }
      if (!database.objectStoreNames.contains("pack-characters")) {
        const store = database.createObjectStore("pack-characters", { keyPath: "fullCharacterId" });
        store.createIndex("packId", "packId", { unique: false });
      }
      if (!database.objectStoreNames.contains("pack-assets")) {
        const store = database.createObjectStore("pack-assets", { keyPath: "assetId" });
        store.createIndex("packId", "packId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("画像データベースを開けませんでした"));
  });
}

async function putCharacterImage(key, blob) {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).put(blob, key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("画像を保存できませんでした")); };
  });
}

async function getCharacterImage(key) {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readonly");
    const request = transaction.objectStore(MEDIA_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("画像を読み込めませんでした"));
    transaction.oncomplete = () => database.close();
  });
}

async function clearCharacterImages() {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).clear();
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function deleteCharacterImage(key) {
  if (!key) return;
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).delete(key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function hydrateCharacterImages() {
  let migrated = false;
  for (const character of state.customCharacters) {
    try {
      if (character.imageKey) {
        const blob = await getCharacterImage(character.imageKey);
        if (blob) character.image = URL.createObjectURL(blob);
      } else if (character.image?.startsWith("data:")) {
        const blob = await fetch(character.image).then(response => response.blob());
        character.imageKey = character.id;
        await putCharacterImage(character.imageKey, blob);
        character.image = URL.createObjectURL(blob);
        migrated = true;
      }
    } catch {
      // 画像1件が壊れていても、ほかのキャラクターとアプリは表示する。
    }
  }
  if (migrated) saveState();
  renderCollection();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function setPackStatus(message = "", type = "") {
  const status = $("#pack-status");
  status.textContent = message;
  status.className = `pack-status${message ? " show" : ""}${type ? ` ${type}` : ""}`;
}

function clearPackPreview() {
  packPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  packPreviewUrls = [];
  pendingPack = null;
  $("#pack-file-input").value = "";
}

async function handlePackFile(file) {
  if (!file || !window.QuestiaPacks) return;
  setPackStatus("パックを検査しています…", "loading");
  try {
    const parsed = await QuestiaPacks.parsePack(file);
    const existing = installedPacks.find(pack => pack.packId === parsed.manifest.packId);
    let storageWarning = "";
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const available = Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0));
      if (available && parsed.expandedSize > available * .85) storageWarning = "端末の空き容量が不足する可能性があります。";
    }
    pendingPack = { parsed, existing };
    $("#pack-preview-name").textContent = parsed.manifest.name;
    $("#pack-preview-id").textContent = parsed.manifest.packId;
    $("#pack-preview-author").textContent = parsed.manifest.author || "未記載";
    $("#pack-preview-version").textContent = existing ? `${existing.version} → ${parsed.manifest.version}` : parsed.manifest.version;
    const counts = { SSR: 0, SR: 0, R: 0 };
    parsed.characters.forEach(character => counts[character.rarity]++);
    $("#pack-preview-count").textContent = `${parsed.characters.length}体（SSR ${counts.SSR} / SR ${counts.SR} / R ${counts.R}）`;
    $("#pack-preview-size").textContent = `${formatBytes(parsed.expandedSize)}（ZIP ${formatBytes(parsed.compressedSize)}）`;
    $("#pack-preview-minimum").textContent = parsed.manifest.minimumQuestiaVersion || "1.0.0";
    $("#pack-preview-description").textContent = parsed.manifest.description || "説明はありません。";
    const stateLabel = $("#pack-preview-state");
    const comparison = existing ? QuestiaPacks.compareVersions(parsed.manifest.version, existing.version) : null;
    if (existing) {
      const oldIds = new Set(packCharacters.filter(character => character.packId === existing.packId).map(character => character.characterId));
      const newIds = new Set(parsed.characters.map(character => character.id));
      const added = [...newIds].filter(id => !oldIds.has(id)).length;
      const removed = [...oldIds].filter(id => !newIds.has(id)).length;
      const updated = [...newIds].filter(id => oldIds.has(id)).length;
      stateLabel.textContent = `更新：追加 ${added} / 更新 ${updated} / 削除 ${removed}`;
    } else {
      stateLabel.textContent = "新規インストール";
    }
    const warningMessages = [];
    if (existing && comparison === -1) warningMessages.push("現在より古いバージョンです。ダウングレードになります。");
    if (storageWarning) warningMessages.push(storageWarning);
    const warning = $("#pack-preview-warning");
    warning.textContent = warningMessages.join(" ");
    warning.classList.toggle("show", warningMessages.length > 0);

    const preview = $("#pack-preview-characters");
    preview.innerHTML = "";
    parsed.characters.slice(0, 3).forEach(character => {
      const asset = parsed.assets.get(character.thumbnailPath || character.imagePath);
      const url = URL.createObjectURL(asset.blob);
      packPreviewUrls.push(url);
      const item = document.createElement("div");
      item.className = "pack-preview-character";
      const image = new Image();
      image.src = url;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = `${character.rarity} ${character.name}`;
      item.append(image, label);
      preview.append(item);
    });
    $("#confirm-pack-install").textContent = existing ? "更新する" : "インストール";
    setPackStatus();
    $("#pack-preview-dialog").showModal();
  } catch (error) {
    console.error("Pack validation failed", error);
    setPackStatus(error.message || "キャラクターパックを読み込めませんでした", "error");
    $("#pack-file-input").value = "";
  }
}

async function confirmPackInstall() {
  if (!pendingPack) return;
  const button = $("#confirm-pack-install");
  button.disabled = true;
  button.textContent = "保存しています…";
  try {
    const { parsed } = pendingPack;
    const newIds = new Set(parsed.characters.map(character => character.fullCharacterId));
    packCharacters
      .filter(character => character.packId === parsed.manifest.packId && state.owned.includes(character.id) && !newIds.has(character.id))
      .forEach(character => { state.collectionSnapshots[character.id] = snapshotCharacter(character); });
    saveState();
    const result = await QuestiaPacks.installPack(parsed);
    await navigator.storage?.persist?.().catch(() => false);
    $("#pack-preview-dialog").close();
    clearPackPreview();
    await loadPackLibrary();
    toast(result.isUpdate ? "キャラクターパックを更新しました" : "キャラクターパックをインストールしました");
  } catch (error) {
    console.error("Pack installation failed", error);
    $("#pack-preview-warning").textContent = error.message || "インストールに失敗しました";
    $("#pack-preview-warning").classList.add("show");
  } finally {
    button.disabled = false;
    button.textContent = pendingPack?.existing ? "更新する" : "インストール";
  }
}

function renderInstalledPacks() {
  const list = $("#installed-pack-list");
  if (!list) return;
  list.innerHTML = "";
  const totalSize = installedPacks.reduce((sum, pack) => sum + Number(pack.totalAssetSize || 0), 0);
  $("#pack-storage-total").textContent = formatBytes(totalSize);
  if (!installedPacks.length) {
    list.innerHTML = '<div class="pack-empty">まだパックはありません。<br>.questiapackを追加して仲間を増やそう。</div>';
    return;
  }
  installedPacks.forEach(pack => {
    const card = document.createElement("article");
    card.className = "installed-pack";
    const info = document.createElement("div");
    info.innerHTML = `
      <h4>${escapeHtml(pack.name)}</h4>
      <p>${escapeHtml(pack.author || "作者未記載")} · v${escapeHtml(pack.version)}<br>${pack.characterCount}体 / ${formatBytes(pack.totalAssetSize)}</p>
      <div class="pack-badges"><span class="pack-badge ${pack.enabled === false ? "disabled" : "enabled"}">${pack.enabled === false ? "無効" : "有効"}</span><span class="pack-badge">${escapeHtml(pack.packId)}</span></div>`;
    const actions = document.createElement("div");
    actions.className = "pack-card-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = pack.enabled === false ? "有効にする" : "無効にする";
    toggle.addEventListener("click", () => togglePack(pack));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-pack";
    remove.textContent = "削除";
    remove.addEventListener("click", () => uninstallPack(pack));
    actions.append(toggle, remove);
    card.append(info, actions);
    list.append(card);
  });
}

async function togglePack(pack) {
  try {
    await QuestiaPacks.setPackEnabled(pack.packId, pack.enabled === false);
    await loadPackLibrary();
    toast(pack.enabled === false ? "パックを有効にしました" : "パックを無効にしました");
  } catch (error) {
    setPackStatus(error.message || "状態を変更できませんでした", "error");
  }
}

async function uninstallPack(pack) {
  const packChars = packCharacters.filter(character => character.packId === pack.packId);
  const acquired = packChars.filter(character => state.owned.includes(character.id));
  const message = `「${pack.name}」を削除しますか？\n\nキャラクター: ${pack.characterCount}体\n使用容量: ${formatBytes(pack.totalAssetSize)}\n獲得済み: ${acquired.length}体\n\n獲得履歴は残りますが、再インストールするまで画像や詳細は表示できません。`;
  if (!confirm(message)) return;
  acquired.forEach(character => { state.collectionSnapshots[character.id] = snapshotCharacter(character); });
  saveState();
  try {
    await QuestiaPacks.removePack(pack.packId);
    await loadPackLibrary();
    toast("キャラクターパックを削除しました");
  } catch (error) {
    setPackStatus(error.message || "パックを削除できませんでした", "error");
  }
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => el.classList.remove("show"), 2400);
}

function closeMenu() {
  document.body.classList.remove("menu-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  $("#app-menu").setAttribute("aria-hidden", "true");
}

function openMenu() {
  document.body.classList.add("menu-open");
  $("#menu-toggle").setAttribute("aria-expanded", "true");
  $("#app-menu").setAttribute("aria-hidden", "false");
}

function switchPage(page) {
  if (!["focus", "tasks", "calendar", "gacha", "settings"].includes(page)) page = "focus";
  $$(".page").forEach(el => el.classList.toggle("active", el.id === `${page}-page`));
  $$(".menu-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  closeMenu();
  history.replaceState(null, "", `#${page}`);
  if (page === "calendar") renderCalendar();
  if (page === "gacha") renderCollection();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyTheme() {
  const colorName = COLOR_THEMES[state.settings.colorTheme] ? state.settings.colorTheme : "yellow";
  const color = COLOR_THEMES[colorName];
  state.settings.colorTheme = colorName;
  document.body.classList.toggle("light", state.settings.theme === "light");
  document.body.dataset.colorTheme = colorName;
  document.documentElement.style.setProperty("--accent", color.accent);
  document.documentElement.style.setProperty("--accent-2", color.accent2);
  document.documentElement.style.setProperty("--blue", color.accent);
  document.documentElement.style.setProperty("--ambient", color.ambient);
  $("#theme-toggle").textContent = state.settings.theme === "light" ? "☀" : "☾";
  $("#settings-theme-value").textContent = `${state.settings.theme === "light" ? "ライト" : "ダーク"}・${color.label}`;
  $$(".appearance-theme-option").forEach(option => {
    const selected = option.dataset.appearanceTheme === state.settings.theme;
    option.classList.toggle("selected", selected);
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(selected));
  });
  $$(".color-theme-option").forEach(option => {
    const selected = option.dataset.colorTheme === colorName;
    option.classList.toggle("selected", selected);
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(selected));
  });
  document.querySelector('meta[name="theme-color"]').content = state.settings.theme === "light" ? "#f5f2ed" : "#14203a";
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
}

function setAppearanceTheme(theme) {
  if (!["light", "dark"].includes(theme)) return;
  state.settings.theme = theme;
  saveState();
  applyTheme();
  toast(`表示テーマを${theme === "light" ? "ライト" : "ダーク"}に変更しました`);
}

function setColorTheme(colorName) {
  if (!COLOR_THEMES[colorName]) return;
  state.settings.colorTheme = colorName;
  saveState();
  applyTheme();
  toast(`カラーモードを${COLOR_THEMES[colorName].label}に変更しました`);
}

function formatTime(seconds) {
  const m = Math.floor(Math.max(seconds, 0) / 60);
  const s = Math.max(seconds, 0) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatStopwatchTime(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (!hours) return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function renderCurrentClock() {
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  $("#current-date").textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}）`;
  $("#current-time").textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function updateTimerUI() {
  const stopwatch = timer.kind === "stopwatch";
  const pomodoroElapsed = timer.duration - timer.remaining;
  $("#timer-display").textContent = stopwatch ? formatStopwatchTime(timer.stopwatchElapsed) : formatTime(timer.remaining);
  const progress = stopwatch
    ? timer.stopwatchElapsed % STOPWATCH_REWARD_SECONDS / STOPWATCH_REWARD_SECONDS * 100
    : pomodoroElapsed / timer.duration * 100;
  const safeProgress = Math.min(100, Math.max(0, progress));
  $("#timer-progress").style.width = `${safeProgress}%`;
  const hasProgress = stopwatch ? timer.stopwatchElapsed > 0 : timer.remaining < timer.duration;
  const workspace = $("#timer-workspace");
  workspace.style.setProperty("--timer-progress", `${safeProgress}%`);
  const hasActiveSession = timer.running || hasProgress;
  workspace.classList.toggle("has-session", hasActiveSession);
  workspace.classList.remove("compact");
  const timerPanel = workspace.querySelector(".timer-panel");
  timerPanel.tabIndex = -1;
  timerPanel.setAttribute("aria-label", "タイマー操作");
  const focusTimerBadge = $("#focus-timer-badge");
  focusTimerBadge.classList.add("show");
  focusTimerBadge.style.setProperty("--timer-progress", `${safeProgress}%`);
  $("#focus-timer-display").textContent = stopwatch ? formatStopwatchTime(timer.stopwatchElapsed) : formatTime(timer.remaining);
  $("#focus-timer-label").textContent = stopwatch ? "STOPWATCH" : timer.mode === "break" ? "BREAK" : "FOCUS";
  $("#focus-timer-status").textContent = timer.running ? "進行中・タップで操作" : hasProgress ? "一時停止中" : "タイマーを開く";
  $("#start-timer").textContent = timer.running
    ? "一時停止"
    : hasProgress ? "再開"
      : stopwatch || timer.mode === "focus" ? "スタート" : "休憩開始";
  $("#reset-timer").textContent = hasProgress && (stopwatch || timer.mode === "focus") ? "作業終了" : "リセット";
  $("#session-label").textContent = stopwatch ? "STOPWATCH" : timer.mode === "focus" ? "FOCUS SESSION" : "BREAK TIME";
  $("#timer-note").innerHTML = stopwatch
    ? "<strong>5分ごとに1オーブ</strong> 獲得"
    : timer.mode === "focus" ? "完了すると <strong>5オーブ</strong> 獲得" : "少し離れて、目と身体を休めよう";
  $("#pomodoro-mode-tabs").classList.toggle("hidden", stopwatch);
  $("#open-timer-settings").classList.toggle("hidden", stopwatch);
  $("#companion-message").textContent = timer.running
    ? stopwatch || timer.mode === "focus" ? "集中してるね。私も静かに進めてるよ" : "おつかれさま。ゆっくり休もう"
    : "今日も一緒に、少しずつ進めよう";
}

function setTimerKind(kind) {
  if (kind === timer.kind) return;
  if (timer.running) pauseTimer();
  timer.kind = kind;
  $$(".timer-kind-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.timerKind === kind));
  updateTimerUI();
}

function setMode(mode) {
  if (timer.running && !confirm("進行中のタイマーを切り替えますか？")) return;
  stopTimer();
  timer.mode = mode;
  timer.duration = state.settings[mode === "focus" ? "focusMinutes" : "breakMinutes"] * 60;
  timer.remaining = timer.duration;
  $$(".mode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === mode));
  updateTimerUI();
}

function startPauseTimer() {
  unlockTimerSignals();
  if (timer.running) {
    pauseTimer();
    return;
  }
  timer.running = true;
  if (timer.kind === "stopwatch") {
    timer.stopwatchStartedAt = Date.now() - timer.stopwatchElapsed * 1000;
  } else {
    if (timer.remaining <= 0) resetTimer();
    timer.running = true;
    timer.endAt = Date.now() + timer.remaining * 1000;
  }
  timer.interval = setInterval(tickTimer, 250);
  updateTimerUI();
}

function tickTimer() {
  if (timer.kind === "stopwatch") {
    timer.stopwatchElapsed = Math.max(0, Math.floor((Date.now() - timer.stopwatchStartedAt) / 1000));
    awardStopwatchMilestones();
    updateTimerUI();
    return;
  }
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  updateTimerUI();
  if (timer.remaining === 0) completeTimer();
}

function pauseTimer() {
  if (!timer.running) return;
  if (timer.kind === "stopwatch") {
    timer.stopwatchElapsed = Math.max(0, Math.floor((Date.now() - timer.stopwatchStartedAt) / 1000));
    awardStopwatchMilestones();
  } else {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  }
  stopTimer();
  updateTimerUI();
}

function stopTimer() {
  timer.running = false;
  clearInterval(timer.interval);
  timer.interval = null;
}

function resetTimer() {
  stopTimer();
  if (timer.kind === "stopwatch") {
    timer.stopwatchElapsed = 0;
    timer.stopwatchStartedAt = null;
    timer.stopwatchAwardedOrbs = 0;
    updateTimerUI();
    return;
  }
  timer.duration = state.settings[timer.mode === "focus" ? "focusMinutes" : "breakMinutes"] * 60;
  timer.remaining = timer.duration;
  updateTimerUI();
}

function finishOrResetTimer() {
  if (timer.kind === "stopwatch") {
    if (timer.running) pauseTimer();
    const minutes = Math.floor(timer.stopwatchElapsed / 60);
    if (minutes >= 1) {
      state.totalFocusMinutes += minutes;
      state.completedSessions.push({
        at: new Date().toISOString(),
        minutes,
        completed: true,
        type: "stopwatch",
        orbsEarned: timer.stopwatchAwardedOrbs
      });
      saveState();
      renderStats();
      toast(`${minutes}分の作業時間を記録しました`);
    }
    resetTimer();
    return;
  }
  const elapsedSeconds = timer.duration - timer.remaining;
  if (timer.mode === "focus" && elapsedSeconds >= 60) {
    const minutes = Math.floor(elapsedSeconds / 60);
    state.totalFocusMinutes += minutes;
    state.completedSessions.push({ at: new Date().toISOString(), minutes, completed: false });
    saveState();
    renderStats();
    toast(`${minutes}分の作業時間を記録しました（オーブは完了時に獲得）`);
  }
  resetTimer();
}

function awardStopwatchMilestones() {
  const earned = Math.floor(timer.stopwatchElapsed / STOPWATCH_REWARD_SECONDS);
  if (earned <= timer.stopwatchAwardedOrbs) return;
  const newlyEarned = earned - timer.stopwatchAwardedOrbs;
  timer.stopwatchAwardedOrbs = earned;
  state.orbs += newlyEarned;
  saveState();
  renderStats();
  toast(`${Math.floor(timer.stopwatchElapsed / 60)}分集中！ ${newlyEarned}オーブ獲得しました ✦`);
}

function unlockTimerSignals() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !timerAudioContext) timerAudioContext = new AudioContextClass();
    timerAudioContext?.resume?.();
  } catch {
    // 音声非対応環境では、表示・通知・バイブだけを使用する。
  }
  if ("Notification" in window && Notification.permission === "default") {
    Promise.resolve(Notification.requestPermission()).catch(() => {});
  }
}

async function playTimerAlarm(kind) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!timerAudioContext || timerAudioContext.state === "closed") timerAudioContext = new AudioContextClass();
    await timerAudioContext.resume();
    const notes = kind === "focus-complete"
      ? [523.25, 659.25, 783.99, 1046.5]
      : [783.99, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      const oscillator = timerAudioContext.createOscillator();
      const gain = timerAudioContext.createGain();
      const start = timerAudioContext.currentTime + index * .24;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.18, start + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .55);
      oscillator.connect(gain).connect(timerAudioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + .58);
    });
  } catch {
    // アラーム音を使えなくてもタイマー処理は継続する。
  }
}

function showTimerSignal(kind) {
  const focusComplete = kind === "focus-complete";
  const dialog = $("#timer-signal-dialog");
  dialog.classList.toggle("break-finished", !focusComplete);
  $("#timer-signal-icon").textContent = focusComplete ? "✦" : "✓";
  $("#timer-signal-eyebrow").textContent = focusComplete ? "SESSION COMPLETE" : "BREAK COMPLETE";
  $("#timer-signal-title").textContent = focusComplete ? "集中完了！" : "休憩終了！";
  $("#timer-signal-message").textContent = focusComplete
    ? `5オーブ獲得。${state.settings.breakMinutes}分休憩を始めます。`
    : "おつかれさま。次の集中を始められます。";
  if (!dialog.open) dialog.showModal();
}

function completeTimer() {
  stopTimer();
  if (timer.mode === "focus") {
    const minutes = state.settings.focusMinutes;
    state.orbs += 5;
    state.totalFocusMinutes += minutes;
    state.completedSessions.push({ at: new Date().toISOString(), minutes, completed: true });
    saveState();
    renderStats();
    timer.mode = "break";
    timer.duration = state.settings.breakMinutes * 60;
    timer.remaining = timer.duration;
    $$(".mode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === "break"));
    timer.running = true;
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.interval = setInterval(tickTimer, 250);
    playTimerAlarm("focus-complete");
    navigator.vibrate?.([180, 90, 180, 90, 300]);
    showTimerSignal("focus-complete");
    toast(`集中完了！ 5オーブ獲得。${state.settings.breakMinutes}分休憩を始めます ✦`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Questia", { body: `集中完了！5オーブ獲得。${state.settings.breakMinutes}分休憩を始めます。` });
    }
  } else {
    timer.mode = "focus";
    timer.duration = state.settings.focusMinutes * 60;
    timer.remaining = timer.duration;
    $$(".mode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === "focus"));
    playTimerAlarm("break-complete");
    navigator.vibrate?.([120, 70, 120]);
    showTimerSignal("break-complete");
    toast("休憩終了。次の集中を始めよう");
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Questia", { body: "休憩終了。次の集中を始められます。" });
    }
  }
  updateTimerUI();
}

function renderStats() {
  $("#orb-count").textContent = state.orbs;
  $("#menu-orb-count").textContent = state.orbs;
  const today = new Date().toDateString();
  const todayMinutes = state.completedSessions
    .filter(item => new Date(item.at).toDateString() === today)
    .reduce((sum, item) => sum + item.minutes, 0);
  $("#today-focus").textContent = `${todayMinutes}分`;
  $("#session-count").textContent = `${state.completedSessions.filter(item => item.completed !== false).length}回`;
  $("#next-gacha").textContent = state.orbs >= GACHA_COST ? "引けます" : `${GACHA_COST - state.orbs}個`;
  $("#settings-time-value").textContent = `${state.settings.focusMinutes}分 / ${state.settings.breakMinutes}分`;
}

function renderTasks() {
  const list = $("#task-list");
  list.innerHTML = "";
  const done = state.tasks.filter(t => t.done).length;
  $("#task-progress-label").textContent = `${done} / ${state.tasks.length} 完了`;
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty-state">まだタスクはありません。<br />今日の小さな一歩を追加してみよう。</div>';
    return;
  }
  state.tasks.forEach(task => {
    const item = document.createElement("article");
    item.className = `task-item${task.done ? " done" : ""}`;
    item.innerHTML = `
      <input type="checkbox" ${task.done ? "checked" : ""} aria-label="完了にする">
      <span class="task-title"></span>
      <small>${task.date ? new Date(`${task.date}T00:00:00`).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : ""}</small>
      <button class="delete-task" aria-label="削除">×</button>`;
    item.querySelector(".task-title").textContent = task.title;
    item.querySelector("input").addEventListener("change", event => {
      task.done = event.target.checked;
      saveState();
      renderTasks();
    });
    item.querySelector(".delete-task").addEventListener("click", () => {
      state.tasks = state.tasks.filter(t => t.id !== task.id);
      saveState();
      renderTasks();
    });
    list.append(item);
  });
}

function addTask(event) {
  event.preventDefault();
  const title = $("#task-input").value.trim();
  if (!title) return;
  state.tasks.unshift({ id: createUniqueId("task"), title, date: $("#task-date").value, done: false });
  saveState();
  event.target.reset();
  renderTasks();
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("#calendar-title").textContent = `${year}年 ${month + 1}月`;
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const sessionMap = {};
  state.completedSessions.forEach(session => {
    const key = localDateKey(new Date(session.at));
    sessionMap[key] = (sessionMap[key] || 0) + session.minutes;
  });
  const grid = $("#calendar-grid");
  grid.innerHTML = "";
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = localDateKey(date);
    const day = document.createElement("div");
    day.className = `day${date.getMonth() !== month ? " muted" : ""}${key === localDateKey(new Date()) ? " today" : ""}`;
    day.innerHTML = `<b>${date.getDate()}</b>${sessionMap[key] ? `<span class="focus-mark">✦ ${sessionMap[key]}分</span>` : ""}`;
    grid.append(day);
  }
}

function allCharacters() {
  const available = [...state.customCharacters, ...packCharacters];
  const availableIds = new Set(available.map(character => character.id));
  const missing = Object.values(state.collectionSnapshots)
    .filter(snapshot => state.owned.includes(snapshot.id) && !availableIds.has(snapshot.id))
    .map(snapshot => ({ ...snapshot, missingPack: true }));
  return [...available, ...missing];
}

function enabledPackById(packId) {
  return installedPacks.find(pack => pack.packId === packId && pack.enabled !== false) || null;
}

function gachaCharactersForSource(source = state.settings.gachaSource) {
  if (source?.startsWith("pack:")) {
    const packId = source.slice(5);
    if (!enabledPackById(packId)) return [];
    return packCharacters.filter(character => character.packId === packId && character.packEnabled !== false);
  }
  return [
    ...state.customCharacters,
    ...(state.settings.includePacksInStandard
      ? packCharacters.filter(character => character.packEnabled !== false)
      : [])
  ];
}

function gachaCharacters() {
  return gachaCharactersForSource(state.settings.gachaSource);
}

function ensureValidGachaSource() {
  const source = state.settings.gachaSource || "standard";
  if (source === "standard") return false;
  const packId = source.startsWith("pack:") ? source.slice(5) : "";
  if (packId && enabledPackById(packId)) return false;
  state.settings.gachaSource = "standard";
  saveState();
  return true;
}

function gachaSourceInfo(source = state.settings.gachaSource) {
  if (source?.startsWith("pack:")) {
    const packId = source.slice(5);
    const pack = enabledPackById(packId);
    if (pack) {
      const count = gachaCharactersForSource(source).length;
      return {
        source,
        name: pack.name,
        detail: `${count}体・${pack.author || "キャラクターパック"}`,
        icon: "⬡"
      };
    }
  }
  const count = gachaCharactersForSource("standard").length;
  return {
    source: "standard",
    name: "標準ガチャ",
    detail: state.settings.includePacksInStandard
      ? `${count}体・登録キャラ＋有効パック`
      : `${count}体・登録キャラクターのみ`,
    icon: "✦"
  };
}

function renderGachaSourceList() {
  const list = $("#gacha-source-list");
  if (!list) return;
  list.innerHTML = "";
  const sources = [
    gachaSourceInfo("standard"),
    ...installedPacks
      .filter(pack => pack.enabled !== false)
      .map(pack => gachaSourceInfo(`pack:${pack.packId}`))
  ];
  sources.forEach(info => {
    const selected = info.source === state.settings.gachaSource;
    const option = document.createElement("button");
    option.type = "button";
    option.className = `gacha-source-option${selected ? " selected" : ""}`;
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(selected));
    option.innerHTML = `<i>${info.icon}</i><span><b>${escapeHtml(info.name)}</b><small>${escapeHtml(info.detail)}</small></span><strong>✓</strong>`;
    option.addEventListener("click", () => selectGachaSource(info.source));
    list.append(option);
  });
}

function renderGachaSource() {
  ensureValidGachaSource();
  const info = gachaSourceInfo();
  $("#gacha-source-name").textContent = info.name;
  $("#gacha-source-detail").textContent = info.detail;
  $(".gacha-source-icon").textContent = info.icon;
  $("#include-packs-standard").checked = state.settings.includePacksInStandard !== false;
  renderGachaSourceList();
  renderGachaRates();
}

function selectGachaSource(source) {
  if (source !== "standard" && !gachaCharactersForSource(source).length) return;
  state.settings.gachaSource = source;
  saveState();
  renderGachaSource();
  $("#gacha-source-dialog").close();
  toast(`${gachaSourceInfo().name}を選択しました`);
}

function snapshotCharacter(character) {
  const existing = state.collectionSnapshots?.[character.id];
  return {
    id: character.id,
    characterId: character.characterId || character.id,
    packId: character.packId || "",
    packName: character.packName || "",
    name: character.name,
    rarity: character.rarity,
    attribute: character.attribute || "",
    series: character.series || "",
    description: character.description || "",
    quote: character.quote || "",
    author: character.author || "",
    acquiredAt: existing?.acquiredAt || new Date().toISOString()
  };
}

async function ensureCharacterImage(character) {
  if (character.image || !character.imageAssetId || !window.QuestiaPacks) return character.image || null;
  const blob = await QuestiaPacks.getAssetBlob(character.imageAssetId);
  if (!blob) return null;
  character.image = URL.createObjectURL(blob);
  return character.image;
}

async function ensureCharacterThumbnail(character) {
  if (character.thumbnail || character.image) return character.thumbnail || character.image;
  const assetId = character.thumbnailAssetId || character.imageAssetId;
  if (!assetId || !window.QuestiaPacks) return null;
  const blob = await QuestiaPacks.getAssetBlob(assetId);
  if (!blob) return null;
  character.thumbnail = URL.createObjectURL(blob);
  if (assetId === character.imageAssetId) character.image = character.thumbnail;
  return character.thumbnail;
}

async function loadPackLibrary() {
  if (!window.QuestiaPacks) return;
  try {
    const [packs, characters] = await Promise.all([
      QuestiaPacks.listPacks(),
      QuestiaPacks.listCharacters()
    ]);
    installedPacks = packs;
    const packMap = new Map(packs.map(pack => [pack.packId, pack]));
    for (const character of packCharacters) {
      if (character.image?.startsWith("blob:")) URL.revokeObjectURL(character.image);
      if (character.thumbnail?.startsWith("blob:") && character.thumbnail !== character.image) URL.revokeObjectURL(character.thumbnail);
    }
    packCharacters = characters.map(character => ({
      ...character,
      id: character.fullCharacterId,
      packEnabled: packMap.get(character.packId)?.enabled !== false
    }));
    $("#settings-pack-count").textContent = `${installedPacks.length}パック ›`;
    renderInstalledPacks();
    renderCollection();
    renderGachaSource();
  } catch (error) {
    console.error("Character pack loading failed", error);
    $("#settings-pack-count").textContent = "読込エラー ›";
  }
}

function renderCollection() {
  const grid = $("#collection-grid");
  grid.innerHTML = "";
  const chars = allCharacters();
  const validOwnedCount = chars.filter(char => state.owned.includes(char.id)).length;
  $("#collection-count").textContent = `${validOwnedCount} / ${chars.length}`;
  chars.forEach(char => {
    const owned = state.owned.includes(char.id);
    const wrapper = document.createElement("div");
    wrapper.className = "character-card-wrap";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `character-card rarity-${String(char.rarity || "R").toLowerCase()}${owned ? "" : " locked"}`;
    card.disabled = !owned;
    card.setAttribute("aria-label", owned ? `${char.name}の詳細を見る` : `未獲得の${char.rarity}キャラクター`);
    const listImage = char.thumbnail || char.image;
    const art = listImage
      ? `<img src="${listImage}" alt="" loading="lazy" decoding="async">`
      : `<span style="color:${char.color || "#8fc8ff"}">${owned ? (char.symbol || "✦") : "?"}</span>`;
    const count = Number(state.pullCounts[char.id] || 0);
    const missingLabel = char.missingPack ? "パック未インストール" : "";
    card.innerHTML = `
      <div class="art">
        ${art}
        <span class="rarity-badge">${char.rarity}</span>
        ${owned && count > 1 ? `<span class="character-count">×${count}</span>` : ""}
      </div>
      <b>${owned ? escapeHtml(char.name) : "？？？"}</b>
      ${missingLabel ? `<small>${missingLabel}</small>` : ""}`;
    if (owned) card.addEventListener("click", () => showCharacterDetail(char));
    wrapper.append(card);
    if (!char.packId && !char.missingPack) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-character";
      deleteButton.setAttribute("aria-label", `${char.name}を削除`);
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deleteCustomCharacter(char));
      wrapper.append(deleteButton);
    }
    grid.append(wrapper);
    if ((char.thumbnailAssetId || char.imageAssetId) && !listImage) {
      ensureCharacterThumbnail(char).then(image => {
        if (!image || !card.isConnected) return;
        const artElement = card.querySelector(".art");
        const placeholder = artElement.querySelector(":scope > span:not(.rarity-badge):not(.character-count)");
        const imageElement = new Image();
        imageElement.src = image;
        imageElement.alt = "";
        imageElement.loading = "lazy";
        imageElement.decoding = "async";
        if (placeholder) placeholder.replaceWith(imageElement);
        else artElement.prepend(imageElement);
      }).catch(() => {});
    }
  });
}

async function deleteCustomCharacter(char) {
  if (!confirm(`「${char.name}」をガチャとコレクションから削除しますか？`)) return;
  state.customCharacters = state.customCharacters.filter(item => item.id !== char.id);
  state.owned = state.owned.filter(id => id !== char.id);
  delete state.pullCounts[char.id];
  delete state.collectionSnapshots[char.id];
  saveState();
  if (char.image?.startsWith("blob:")) URL.revokeObjectURL(char.image);
  await deleteCharacterImage(char.imageKey).catch(() => {});
  renderCollection();
  renderGachaSource();
  toast(`「${char.name}」を削除しました`);
}

async function showCharacterDetail(char) {
  const rarityColors = { R: "#72bcff", SR: "#c691ff", SSR: "#ffd167" };
  const dialog = $("#character-detail-dialog");
  dialog.style.setProperty("--detail-color", rarityColors[char.rarity] || rarityColors.R);
  $("#detail-rarity").textContent = char.rarity;
  $("#detail-name").textContent = char.name;
  const packInfo = char.missingPack
    ? "キャラクターパックがインストールされていません"
    : char.packName ? `${char.packName}${char.author ? ` / ${char.author}` : ""}` : "手動登録";
  const acquiredAt = state.collectionSnapshots[char.id]?.acquiredAt;
  const acquiredLabel = acquiredAt ? ` · 初回 ${new Date(acquiredAt).toLocaleDateString("ja-JP")}` : "";
  $("#detail-caption").textContent = `${packInfo} · 排出 ${Number(state.pullCounts[char.id] || 0)}回${acquiredLabel}`;
  const art = $("#detail-art");
  art.innerHTML = "";
  await ensureCharacterImage(char).catch(() => null);
  if (char.image) {
    const image = new Image();
    image.src = char.image;
    image.alt = char.name;
    art.append(image);
  } else {
    const symbol = document.createElement("span");
    symbol.textContent = char.symbol || "✦";
    symbol.style.color = char.color || "#8fc8ff";
    art.append(symbol);
  }
  dialog.showModal();
}

function closeCharacterDetail() {
  $("#character-detail-dialog").close();
}

function effectiveRarityRates(characters = gachaCharacters()) {
  const baseRates = { SSR: .05, SR: .28, R: .67 };
  const available = new Set(characters.map(character => character.rarity));
  const availableTotal = Object.entries(baseRates)
    .filter(([rarity]) => available.has(rarity))
    .reduce((sum, [, rate]) => sum + rate, 0);
  return Object.fromEntries(
    Object.entries(baseRates).map(([rarity, rate]) => [
      rarity,
      available.has(rarity) && availableTotal ? rate / availableTotal : 0
    ])
  );
}

function rarityRoll(characters) {
  const rates = effectiveRarityRates(characters);
  let point = Math.random();
  for (const rarity of ["SSR", "SR", "R"]) {
    point -= rates[rarity];
    if (point <= 0) return rarity;
  }
  return ["R", "SR", "SSR"].find(rarity => rates[rarity] > 0) || null;
}

function formatRate(rate) {
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function renderGachaRates() {
  const characters = gachaCharacters();
  const rates = effectiveRarityRates(characters);
  const info = gachaSourceInfo();
  $("#gacha-rates-source").textContent = `${info.name}・${characters.length}体`;
  $("#gacha-rate-ssr").textContent = formatRate(rates.SSR);
  $("#gacha-rate-sr").textContent = formatRate(rates.SR);
  $("#gacha-rate-r").textContent = formatRate(rates.R);
  const missing = ["SSR", "SR", "R"].filter(rarity => !characters.some(character => character.rarity === rarity));
  $("#gacha-rate-note").textContent = characters.length
    ? `${missing.length ? `存在しないレアリティ（${missing.join("・")}）の確率は、存在するレアリティへ再配分されます。` : ""}同じレアリティの中では、まだ出会っていないキャラクターが少し出やすくなります。`
    : "選択中のガチャには排出できるキャラクターがいません。";
}

function weightedCharacterDraw(pool) {
  if (!pool.length) return null;
  const weighted = pool.map(character => {
    const count = Number(state.pullCounts[character.id] || 0);
    // 排出されるたびに6%ずつ減衰。ただし元の55%よりは下げない。
    const manifestWeight = Math.min(100, Math.max(.01, Number(character.weight || 1)));
    const weight = manifestWeight * Math.max(.55, Math.pow(.94, count));
    return { character, weight };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let point = Math.random() * totalWeight;
  for (const item of weighted) {
    point -= item.weight;
    if (point <= 0) return item.character;
  }
  return weighted[weighted.length - 1].character;
}

async function pullGacha() {
  await mediaReady;
  if (!gachaCharacters().length) {
    toast("選択中のガチャに排出できるキャラクターがいません");
    return;
  }
  if (state.orbs < GACHA_COST) {
    toast(`オーブがあと${GACHA_COST - state.orbs}個必要です`);
    return;
  }
  resetGachaAnimation();
  $("#gacha-animation-dialog").showModal();
}

function resetGachaAnimation() {
  gachaAnimationTimers.forEach(clearTimeout);
  gachaAnimationTimers = [];
  pendingGachaResult = null;
  const stage = $("#gacha-stage");
  stage.className = "gacha-stage";
  $("#gacha-instruction").textContent = "ガチャをまわしてキャラを出せ♡";
  $("#turn-gacha").disabled = false;
  $("#close-gacha-animation").disabled = false;
}

function turnGacha() {
  const stage = $("#gacha-stage");
  const candidates = gachaCharacters();
  if (stage.classList.contains("spinning") || state.orbs < GACHA_COST || !candidates.length) return;

  state.orbs -= GACHA_COST;
  const rarity = rarityRoll(candidates);
  const pool = candidates.filter(character => character.rarity === rarity);
  const char = weightedCharacterDraw(pool);
  if (!state.owned.includes(char.id)) state.owned.push(char.id);
  state.pullCounts[char.id] = Number(state.pullCounts[char.id] || 0) + 1;
  state.collectionSnapshots[char.id] = snapshotCharacter(char);
  ensureCharacterImage(char).catch(() => {});
  pendingGachaResult = char;
  saveState();
  renderStats();

  $("#turn-gacha").disabled = true;
  $("#close-gacha-animation").disabled = true;
  $("#gacha-instruction").textContent = "魔力を集束中…";
  stage.classList.add("spinning");
  playGachaTone("turn");
  navigator.vibrate?.([35, 35, 45, 35, 60]);

  gachaAnimationTimers.push(setTimeout(() => {
    stage.classList.add(`rarity-${char.rarity.toLowerCase()}`, "dropping");
    $("#gacha-instruction").textContent = "召喚オーブが顕現した！";
    playGachaTone("drop");
    navigator.vibrate?.(80);
  }, 950));

  gachaAnimationTimers.push(setTimeout(() => {
    stage.classList.add("revealing");
    $("#gacha-instruction").textContent = char.rarity === "SSR" ? "伝説級の魔力反応…！？" : "召喚の刻！";
    playGachaTone(char.rarity.toLowerCase());
    navigator.vibrate?.(char.rarity === "SSR" ? [70, 40, 70, 40, 150] : 100);
  }, 1850));

  gachaAnimationTimers.push(setTimeout(() => {
    $("#gacha-animation-dialog").close();
    showGachaResult(char);
  }, char.rarity === "SSR" ? 3100 : 2750));
}

function playGachaTone(kind) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const notes = {
      turn: [180, 220, 260],
      drop: [330, 250],
      r: [440, 660],
      sr: [440, 660, 880],
      ssr: [523, 659, 784, 1047]
    }[kind] || [440];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .11;
      oscillator.type = kind === "turn" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.09, start + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + .25);
    });
    setTimeout(() => context.close(), 1000);
  } catch {
    // 音声を使えない環境でも演出は継続する。
  }
}

async function showGachaResult(char) {
  await ensureCharacterImage(char).catch(() => null);
  $("#result-rarity").textContent = char.rarity;
  $("#result-name").textContent = char.name;
  const count = Number(state.pullCounts[char.id] || 0);
  $("#result-message").textContent = count === 1
    ? "新しい作業仲間と出会いました"
    : `${count}回目の出会いです`;
  $("#result-art").innerHTML = char.image
    ? `<img src="${char.image}" alt="${escapeHtml(char.name)}">`
    : `<span style="color:${char.color || "#8fc8ff"}">${char.symbol || "✦"}</span>`;
  const pullAgain = $("#pull-again");
  pullAgain.disabled = state.orbs < GACHA_COST || !gachaCharacters().length;
  pullAgain.title = pullAgain.disabled ? "オーブが足りません" : "";
  $("#result-dialog").showModal();
}

function closeResultToCollection() {
  $("#result-dialog").close();
  renderCollection();
  setTimeout(() => $(".collection-heading").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function pullAgain() {
  $("#result-dialog").close();
  renderCollection();
  pullGacha();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function loadImageSource(file) {
  const dataUrl = await blobToDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("この画像形式を読み込めませんでした"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, type = "image/webp", quality = .76) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像を圧縮できませんでした")), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("画像を読み込めませんでした"));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file, maxSide = 900, quality = .76) {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選択してください");
  const source = await loadImageSource(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像処理を開始できませんでした");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return canvasToBlob(canvas, "image/webp", quality);
}

async function saveCustomCharacter(event) {
  event.preventDefault();
  const file = $("#character-image-input").files[0];
  const name = $("#character-name").value.trim();
  if (!file || !name) return;
  try {
    $("#save-character").textContent = "画像を最適化中…";
    $("#save-character").disabled = true;
    const imageBlob = await compressImage(file);
    $("#save-character").textContent = "画像を保存中…";
    const id = createUniqueId("custom");
    await putCharacterImage(id, imageBlob);
    const character = {
      id,
      name,
      rarity: $("#character-rarity").value,
      imageKey: id,
      image: URL.createObjectURL(imageBlob)
    };
    state.customCharacters.push(character);
    try {
      saveState();
    } catch (error) {
      state.customCharacters = state.customCharacters.filter(item => item.id !== id);
      throw error;
    }
    $("#character-dialog").close();
    event.target.reset();
    renderCollection();
    renderGachaSource();
    toast("キャラクターをガチャに追加しました");
  } catch (error) {
    toast(error.message || "画像を登録できませんでした");
  } finally {
    $("#save-character").textContent = "ガチャに追加";
    $("#save-character").disabled = false;
  }
}

function closeCharacterDialog() {
  $("#character-form").reset();
  $("#character-dialog").close();
}

function selectedCompanionPreset() {
  if (state.companionImage) return null;
  return COMPANION_PRESETS.find(preset => preset.id === state.companionPreset) || COMPANION_PRESETS[0];
}

function companionSource() {
  return state.companionImage || selectedCompanionPreset()?.src || COMPANION_PRESETS[0].src;
}

function applyCompanion() {
  const source = companionSource();
  $("#companion-image").src = source;
  $("#timer-companion-image").src = source;
  const preset = selectedCompanionPreset();
  $("#settings-image-value").textContent = preset?.name || "端末の画像";
}

function renderCompanionPicker() {
  const grid = $("#companion-preset-grid");
  grid.innerHTML = "";
  const selectedPreset = selectedCompanionPreset();
  COMPANION_PRESETS.forEach(preset => {
    const selected = selectedPreset?.id === preset.id;
    const option = document.createElement("button");
    option.type = "button";
    option.className = `companion-preset-option${selected ? " selected" : ""}`;
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(selected));
    option.setAttribute("aria-label", `${preset.name}を選択`);
    option.innerHTML = `<img src="${preset.src}" alt="" loading="lazy" decoding="async"><span><b>${escapeHtml(preset.name)}</b><small>${preset.caption}</small></span><strong>✓</strong>`;
    option.addEventListener("click", () => selectCompanionPreset(preset.id));
    grid.append(option);
  });
  const customButton = $("#choose-custom-companion");
  const customSelected = !!state.companionImage;
  customButton.classList.toggle("selected", customSelected);
  customButton.setAttribute("aria-checked", String(customSelected));
}

function openCompanionPicker() {
  renderCompanionPicker();
  $("#companion-picker-dialog").showModal();
}

function selectCompanionPreset(presetId) {
  const preset = COMPANION_PRESETS.find(item => item.id === presetId);
  if (!preset) return;
  state.companionPreset = preset.id;
  state.companionImage = null;
  saveState();
  applyCompanion();
  $("#companion-picker-dialog").close();
  toast(`作業相棒を「${preset.name}」に変更しました`);
}

async function changeCompanion(file) {
  if (!file) return;
  try {
    toast("画像を最適化しています…");
    const imageBlob = await compressImage(file, 1200, .8);
    state.companionImage = await blobToDataUrl(imageBlob);
    state.companionPreset = "custom";
    saveState();
    applyCompanion();
    toast("作業相棒の画像を変更しました");
  } catch (error) {
    toast(error.message || "画像を変更できませんでした");
  }
}

function openTimerSettings() {
  $("#focus-minutes").value = state.settings.focusMinutes;
  $("#break-minutes").value = state.settings.breakMinutes;
  $("#timer-dialog").showModal();
}

function saveTimerSettings(event) {
  event.preventDefault();
  const focus = Math.min(180, Math.max(1, Number($("#focus-minutes").value)));
  const rest = Math.min(60, Math.max(1, Number($("#break-minutes").value)));
  state.settings.focusMinutes = focus;
  state.settings.breakMinutes = rest;
  saveState();
  resetTimer();
  renderStats();
  $("#timer-dialog").close();
  toast("タイマー設定を保存しました");
}

function setBackupStatus(title, detail, type = "") {
  const status = $("#backup-status");
  status.className = `backup-status${type ? ` ${type}` : ""}`;
  status.querySelector("b").textContent = title;
  status.querySelector("small").textContent = detail;
  status.querySelector(".backup-status-icon").textContent = type === "error" ? "!" : "◈";
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("保存データを読み込めませんでした"));
  });
}

async function readBackupStores() {
  const database = await openMediaDatabase();
  try {
    const transaction = database.transaction(MEDIA_STORES, "readonly");
    const imageStore = transaction.objectStore(MEDIA_STORE_NAME);
    const [imageKeys, imageBlobs, packs, packCharactersData, packAssets] = await Promise.all([
      requestResult(imageStore.getAllKeys()),
      requestResult(imageStore.getAll()),
      requestResult(transaction.objectStore("packs").getAll()),
      requestResult(transaction.objectStore("pack-characters").getAll()),
      requestResult(transaction.objectStore("pack-assets").getAll())
    ]);
    return {
      characterImages: imageKeys.map((key, index) => ({ key, blob: imageBlobs[index] })),
      packs,
      packCharacters: packCharactersData,
      packAssets
    };
  } finally {
    database.close();
  }
}

async function serializeBackupBlob(blob) {
  if (!(blob instanceof Blob)) throw new Error("保存画像の形式が正しくありません");
  const dataUrl = await blobToDataUrl(blob);
  return {
    type: blob.type || "application/octet-stream",
    size: blob.size,
    data: String(dataUrl).slice(String(dataUrl).indexOf(",") + 1)
  };
}

function backupFilename(date = new Date()) {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  const timePart = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  return `Questia-backup-${datePart}-${timePart}.questiabackup`;
}

async function createBackupFile() {
  await mediaReady;
  saveState();
  const stored = await readBackupStores();
  const characterImages = [];
  for (const item of stored.characterImages) {
    characterImages.push({ key: item.key, blob: await serializeBackupBlob(item.blob) });
  }
  const packAssets = [];
  for (const record of stored.packAssets) {
    packAssets.push({ ...record, blob: await serializeBackupBlob(record.blob) });
  }
  const backup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: window.QuestiaPacks?.APP_VERSION || "1.0.0",
    exportedAt: new Date().toISOString(),
    state: getPersistableState(),
    media: {
      characterImages,
      packs: stored.packs,
      packCharacters: stored.packCharacters,
      packAssets
    }
  };
  const file = new File(
    [JSON.stringify(backup)],
    backupFilename(),
    { type: "application/json" }
  );
  if (file.size > BACKUP_MAX_BYTES) {
    throw new Error(`バックアップが上限${formatBytes(BACKUP_MAX_BYTES)}を超えています`);
  }
  return file;
}

async function prepareBackup() {
  preparedBackupFile = null;
  $("#download-backup").disabled = true;
  $("#share-backup").disabled = true;
  setBackupStatus("バックアップを準備しています", "画像やキャラクターパックをまとめています");
  try {
    preparedBackupFile = await createBackupFile();
    const imageCount = state.customCharacters.length;
    const packCount = installedPacks.length;
    setBackupStatus(
      "バックアップの準備ができました",
      `${formatBytes(preparedBackupFile.size)}・登録キャラ${imageCount}体・パック${packCount}個`
    );
    $("#download-backup").disabled = false;
    $("#share-backup").disabled = false;
  } catch (error) {
    console.error("Backup creation failed", error);
    setBackupStatus("バックアップを作成できませんでした", error.message || "保存データの読込中にエラーが発生しました", "error");
  }
}

function downloadBackup() {
  if (!preparedBackupFile) return;
  const url = URL.createObjectURL(preparedBackupFile);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = preparedBackupFile.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast("バックアップを書き出しました");
}

async function shareBackup() {
  if (!preparedBackupFile) return;
  const shareData = {
    title: "Questia バックアップ",
    text: "Questiaのバックアップデータ",
    files: [preparedBackupFile]
  };
  if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: shareData.files }))) {
    downloadBackup();
    toast("共有機能がないため端末へ保存しました。Google Driveなどへアップロードしてください");
    return;
  }
  try {
    await navigator.share(shareData);
    toast("共有先へバックアップを渡しました");
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Backup sharing failed", error);
      toast("クラウド共有を開始できませんでした");
    }
  }
}

function validateBackupBlob(payload, label) {
  if (!payload || typeof payload !== "object" || typeof payload.data !== "string") {
    throw new Error(`${label}の画像データが壊れています`);
  }
  if (!Number.isFinite(payload.size) || payload.size < 0 || payload.size > BACKUP_MAX_BYTES) {
    throw new Error(`${label}の画像サイズが正しくありません`);
  }
  const estimatedSize = Math.floor(payload.data.length * .75);
  if (Math.abs(estimatedSize - payload.size) > 3) {
    throw new Error(`${label}の画像サイズが一致しません`);
  }
}

function validateBackupDocument(backup) {
  if (!backup || typeof backup !== "object" || backup.format !== BACKUP_FORMAT) {
    throw new Error("Questiaのバックアップファイルではありません");
  }
  if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`このバックアップ形式（v${backup.schemaVersion ?? "?"}）には対応していません`);
  }
  if (!backup.state || typeof backup.state !== "object" || Array.isArray(backup.state)) {
    throw new Error("アプリデータが見つかりません");
  }
  const stateJson = JSON.stringify(backup.state);
  if (stateJson.length > 5 * 1024 * 1024) throw new Error("アプリデータの容量が大きすぎます");
  if (backup.state.customCharacters != null && !Array.isArray(backup.state.customCharacters)) {
    throw new Error("登録キャラクターのデータが正しくありません");
  }
  if (backup.state.tasks != null && !Array.isArray(backup.state.tasks)) {
    throw new Error("ToDoデータが正しくありません");
  }
  if (backup.state.completedSessions != null && !Array.isArray(backup.state.completedSessions)) {
    throw new Error("作業記録のデータが正しくありません");
  }
  const media = backup.media;
  if (!media || !Array.isArray(media.characterImages) || !Array.isArray(media.packs) ||
      !Array.isArray(media.packCharacters) || !Array.isArray(media.packAssets)) {
    throw new Error("画像またはキャラクターパックのデータが見つかりません");
  }
  if (media.characterImages.length > 5000 || media.packs.length > 1000 ||
      media.packCharacters.length > 500000 || media.packAssets.length > 10000) {
    throw new Error("バックアップ内のデータ件数が多すぎます");
  }
  let totalSize = 0;
  const imageKeys = new Set();
  media.characterImages.forEach((item, index) => {
    if (!item || (typeof item.key !== "string" && typeof item.key !== "number")) {
      throw new Error(`${index + 1}件目の登録画像IDが正しくありません`);
    }
    if (imageKeys.has(String(item.key))) throw new Error("登録画像IDが重複しています");
    imageKeys.add(String(item.key));
    validateBackupBlob(item.blob, `${index + 1}件目の登録画像`);
    totalSize += item.blob.size;
  });
  const assetIds = new Set();
  const packIds = new Set();
  media.packs.forEach((item, index) => {
    if (!item || typeof item.packId !== "string" || !item.packId || packIds.has(item.packId)) {
      throw new Error(`${index + 1}件目のキャラクターパックIDが正しくありません`);
    }
    packIds.add(item.packId);
  });
  const characterIds = new Set();
  media.packCharacters.forEach((item, index) => {
    if (!item || typeof item.fullCharacterId !== "string" || !item.fullCharacterId ||
        characterIds.has(item.fullCharacterId)) {
      throw new Error(`${index + 1}件目のパックキャラクターIDが正しくありません`);
    }
    characterIds.add(item.fullCharacterId);
  });
  media.packAssets.forEach((item, index) => {
    if (!item || typeof item.assetId !== "string" || !item.assetId || assetIds.has(item.assetId)) {
      throw new Error(`${index + 1}件目のパック画像IDが正しくありません`);
    }
    assetIds.add(item.assetId);
    validateBackupBlob(item.blob, `${index + 1}件目のパック画像`);
    totalSize += item.blob.size;
  });
  if (totalSize > BACKUP_MAX_BYTES) throw new Error("バックアップ内の画像容量が上限を超えています");
  return backup;
}

function deserializeBackupBlob(payload) {
  const parts = [];
  const chunkLength = 4 * 16384;
  for (let offset = 0; offset < payload.data.length; offset += chunkLength) {
    const binary = atob(payload.data.slice(offset, offset + chunkLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    parts.push(bytes);
  }
  const blob = new Blob(parts, { type: payload.type || "application/octet-stream" });
  if (blob.size !== payload.size) throw new Error("復元した画像のサイズが一致しません");
  return blob;
}

async function replaceBackupStores(media) {
  const characterImages = media.characterImages.map(item => ({
    key: item.key,
    blob: deserializeBackupBlob(item.blob)
  }));
  const packAssets = media.packAssets.map(item => ({
    ...item,
    blob: deserializeBackupBlob(item.blob)
  }));
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORES, "readwrite");
    let operationError = null;
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("データを復元できませんでした")); };
    transaction.onabort = () => {
      database.close();
      reject(operationError || transaction.error || new Error("データの復元を中止しました"));
    };
    try {
      MEDIA_STORES.forEach(storeName => transaction.objectStore(storeName).clear());
      characterImages.forEach(item => transaction.objectStore(MEDIA_STORE_NAME).put(item.blob, item.key));
      media.packs.forEach(record => transaction.objectStore("packs").put(record));
      media.packCharacters.forEach(record => transaction.objectStore("pack-characters").put(record));
      packAssets.forEach(record => transaction.objectStore("pack-assets").put(record));
    } catch (error) {
      operationError = error;
      transaction.abort();
    }
  });
}

async function importBackup(file) {
  if (!file) return;
  $("#backup-file-input").value = "";
  if (file.size > BACKUP_MAX_BYTES) {
    toast(`バックアップは${formatBytes(BACKUP_MAX_BYTES)}以下にしてください`);
    return;
  }
  if (!confirm("現在のオーブ、記録、タスク、画像、キャラクターパックをすべてバックアップの内容に置き換えますか？")) return;
  $("#download-backup").disabled = true;
  $("#share-backup").disabled = true;
  setBackupStatus("バックアップを読み込んでいます", "内容を検査しています");
  try {
    const backup = validateBackupDocument(JSON.parse(await file.text()));
    setBackupStatus("データを復元しています", "この画面を閉じずにお待ちください");
    await replaceBackupStores(backup.media);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backup.state));
    setBackupStatus("復元が完了しました", "Questiaを再読み込みします");
    toast("バックアップを復元しました");
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    console.error("Backup import failed", error);
    setBackupStatus("バックアップを読み込めませんでした", error.message || "ファイルが壊れている可能性があります", "error");
    $("#download-backup").disabled = !preparedBackupFile;
    $("#share-backup").disabled = !preparedBackupFile;
  }
}

function openBackupDialog() {
  if (!$("#backup-dialog").open) $("#backup-dialog").showModal();
  prepareBackup();
}

function resetData() {
  if (!confirm("タスク、記録、オーブ、登録画像をすべて削除しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  clearCharacterImages().catch(() => {});
  Promise.all(installedPacks.map(pack => QuestiaPacks.removePack(pack.packId))).then(loadPackLibrary).catch(() => {});
  state = structuredClone(initialState);
  calendarCursor = new Date();
  resetTimer();
  initializeUI();
  toast("データを初期化しました");
}

function initializeUI() {
  applyTheme();
  renderStats();
  renderTasks();
  renderCalendar();
  renderCollection();
  renderCurrentClock();
  applyCompanion();
  $("#include-packs-standard").checked = state.settings.includePacksInStandard !== false;
  updateTimerUI();
}

function bindEvents() {
  $$("[data-page]").forEach(button => button.addEventListener("click", () => switchPage(button.dataset.page)));
  $("#menu-toggle").addEventListener("click", () => document.body.classList.contains("menu-open") ? closeMenu() : openMenu());
  $("#menu-close").addEventListener("click", closeMenu);
  $("#menu-backdrop").addEventListener("click", closeMenu);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });
  $("#focus-timer-badge").addEventListener("click", () => {
    updateTimerUI();
    if (!$("#timer-control-dialog").open) $("#timer-control-dialog").showModal();
  });
  $("#close-timer-control").addEventListener("click", () => $("#timer-control-dialog").close());
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#settings-theme-row").addEventListener("click", () => $("#appearance-dialog").showModal());
  $("#close-appearance").addEventListener("click", () => $("#appearance-dialog").close());
  $$(".appearance-theme-option").forEach(option => {
    option.addEventListener("click", () => setAppearanceTheme(option.dataset.appearanceTheme));
  });
  $$(".color-theme-option").forEach(option => {
    option.addEventListener("click", () => setColorTheme(option.dataset.colorTheme));
  });
  $("#close-timer-signal").addEventListener("click", () => $("#timer-signal-dialog").close());
  $$(".timer-kind-tab").forEach(tab => tab.addEventListener("click", () => setTimerKind(tab.dataset.timerKind)));
  $$(".mode-tab").forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $("#start-timer").addEventListener("click", () => {
    startPauseTimer();
    $("#timer-control-dialog").close();
  });
  $("#reset-timer").addEventListener("click", finishOrResetTimer);
  $("#open-timer-settings").addEventListener("click", openTimerSettings);
  $("#settings-timer-row").addEventListener("click", openTimerSettings);
  $("#timer-settings-form").addEventListener("submit", saveTimerSettings);
  $("#task-form").addEventListener("submit", addTask);
  $("#prev-month").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); });
  $("#next-month").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); });
  $("#gacha-source-selector").addEventListener("click", async () => {
    await mediaReady;
    renderGachaSource();
    $("#gacha-source-dialog").showModal();
  });
  $("#close-gacha-source").addEventListener("click", () => $("#gacha-source-dialog").close());
  $("#pull-gacha").addEventListener("click", pullGacha);
  $("#turn-gacha").addEventListener("click", turnGacha);
  $("#close-gacha-animation").addEventListener("click", () => {
    resetGachaAnimation();
    $("#gacha-animation-dialog").close();
  });
  $("#gacha-animation-dialog").addEventListener("cancel", event => {
    if ($("#gacha-stage").classList.contains("spinning")) event.preventDefault();
  });
  $("#open-register-character").addEventListener("click", () => $("#character-dialog").showModal());
  $("#close-character-dialog").addEventListener("click", closeCharacterDialog);
  $("#cancel-character").addEventListener("click", closeCharacterDialog);
  $("#character-form").addEventListener("submit", saveCustomCharacter);
  $("#close-result").addEventListener("click", closeResultToCollection);
  $("#pull-again").addEventListener("click", pullAgain);
  $("#close-character-detail-x").addEventListener("click", closeCharacterDetail);
  $("#close-character-detail").addEventListener("click", closeCharacterDetail);
  $("#settings-image-row").addEventListener("click", openCompanionPicker);
  $("#close-companion-picker").addEventListener("click", () => $("#companion-picker-dialog").close());
  $("#choose-custom-companion").addEventListener("click", () => {
    $("#companion-picker-dialog").close();
    $("#companion-input").value = "";
    $("#companion-input").click();
  });
  $("#settings-rates-row").addEventListener("click", async () => {
    await mediaReady;
    renderGachaRates();
    $("#gacha-rates-dialog").showModal();
  });
  $("#close-gacha-rates").addEventListener("click", () => $("#gacha-rates-dialog").close());
  $("#settings-backup-row").addEventListener("click", openBackupDialog);
  $("#close-backup-dialog").addEventListener("click", () => $("#backup-dialog").close());
  $("#download-backup").addEventListener("click", downloadBackup);
  $("#share-backup").addEventListener("click", shareBackup);
  $("#backup-file-input").addEventListener("change", event => importBackup(event.target.files[0]));
  $("#settings-pack-row").addEventListener("click", async () => {
    await mediaReady;
    $("#include-packs-standard").checked = state.settings.includePacksInStandard !== false;
    setPackStatus();
    renderInstalledPacks();
    $("#pack-manager-dialog").showModal();
  });
  $("#include-packs-standard").addEventListener("change", event => {
    state.settings.includePacksInStandard = event.target.checked;
    saveState();
    renderGachaSource();
    toast(event.target.checked ? "標準ガチャに有効なパックを追加します" : "標準ガチャを登録キャラのみにしました");
  });
  $("#close-pack-manager").addEventListener("click", () => $("#pack-manager-dialog").close());
  $("#pack-file-input").addEventListener("change", event => handlePackFile(event.target.files[0]));
  const packDropZone = $("#pack-drop-zone");
  ["dragenter", "dragover"].forEach(type => packDropZone.addEventListener(type, event => {
    event.preventDefault();
    packDropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(type => packDropZone.addEventListener(type, event => {
    event.preventDefault();
    packDropZone.classList.remove("dragging");
  }));
  packDropZone.addEventListener("drop", event => handlePackFile(event.dataTransfer.files[0]));
  const cancelPackPreview = () => {
    $("#pack-preview-dialog").close();
    clearPackPreview();
  };
  $("#cancel-pack-install-x").addEventListener("click", cancelPackPreview);
  $("#cancel-pack-install").addEventListener("click", cancelPackPreview);
  $("#confirm-pack-install").addEventListener("click", confirmPackInstall);
  $("#pack-preview-dialog").addEventListener("cancel", event => {
    event.preventDefault();
    cancelPackPreview();
  });
  $("#companion-input").addEventListener("change", event => changeCompanion(event.target.files[0]));
  $("#reset-data").addEventListener("click", resetData);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderCurrentClock();
    if (!document.hidden && timer.running) tickTimer();
  });
}

bindEvents();
initializeUI();
mediaReady = Promise.all([hydrateCharacterImages(), loadPackLibrary()]);
switchPage(location.hash.slice(1) || "focus");
setInterval(renderCurrentClock, 1000);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
