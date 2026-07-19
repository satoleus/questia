(function () {
  "use strict";

  const DB_NAME = "my-study-gacha-media-v1";
  const DB_VERSION = 2;
  const STORES = {
    manualImages: "character-images",
    packs: "packs",
    characters: "pack-characters",
    assets: "pack-assets"
  };
  const APP_VERSION = "1.0.0";
  const LIMITS = Object.freeze({
    maxPackBytes: 100 * 1024 * 1024,
    maxExpandedBytes: 200 * 1024 * 1024,
    maxImageBytes: 15 * 1024 * 1024,
    maxThumbnailBytes: 3 * 1024 * 1024,
    maxCharacters: 500,
    maxFiles: 2000,
    maxCompressionRatio: 120
  });
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  const ALLOWED_RARITIES = new Set(["R", "SR", "SSR"]);
  const IMAGE_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg"]);
  const FORBIDDEN_EXTENSIONS = new Set([
    "html", "htm", "js", "mjs", "cjs", "wasm", "svg", "exe", "dll", "bat",
    "cmd", "com", "sh", "ps1", "jar", "apk", "app", "dmg", "msi"
  ]);

  function packError(message) {
    const error = new Error(message);
    error.name = "QuestiaPackError";
    return error;
  }

  function safePath(path) {
    if (typeof path !== "string" || !path || path.length > 512) return false;
    if (/[\0-\x1f\\]/.test(path) || path.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
    const segments = path.split("/");
    return !segments.some(segment => !segment || segment === "." || segment === "..");
  }

  function extensionOf(path) {
    const file = path.split("/").pop() || "";
    return file.includes(".") ? file.split(".").pop().toLowerCase() : "";
  }

  function findEndOfCentralDirectory(view) {
    const minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw packError("ZIPの終端情報が見つかりません。正常な.questiapackまたは.zipを選択してください");
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDirectory(view);
    const disk = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entryCount = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (disk !== 0 || centralDisk !== 0) throw packError("分割ZIPには対応していません");
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw packError("ZIP64形式には対応していません");
    }
    if (entryCount > LIMITS.maxFiles) throw packError(`パック内のファイル数が上限${LIMITS.maxFiles}件を超えています`);
    if (centralOffset + centralSize > view.byteLength) throw packError("ZIPの中央ディレクトリが壊れています");

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const entries = new Map();
    let offset = centralOffset;
    let expandedTotal = 0;
    for (let index = 0; index < entryCount; index++) {
      if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
        throw packError("ZIPのファイル一覧が壊れています");
      }
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const crc32 = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const expandedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if ([compressedSize, expandedSize, localOffset].includes(0xffffffff)) throw packError("ZIP64形式には対応していません");
      const nameEnd = offset + 46 + nameLength;
      if (nameEnd > view.byteLength) throw packError("ZIP内のファイル名が壊れています");
      const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
      offset = nameEnd + extraLength + commentLength;
      if (name.endsWith("/")) continue;
      if (!safePath(name)) throw packError(`安全でないファイルパスが含まれています: ${name}`);
      if (entries.has(name)) throw packError(`同じファイル名が重複しています: ${name}`);
      if (flags & 0x1) throw packError(`暗号化されたファイルには対応していません: ${name}`);
      if (method !== 0 && method !== 8) throw packError(`未対応のZIP圧縮方式です: ${name}`);
      if (FORBIDDEN_EXTENSIONS.has(extensionOf(name))) throw packError(`許可されていないファイルが含まれています: ${name}`);
      expandedTotal += expandedSize;
      if (expandedTotal > LIMITS.maxExpandedBytes) throw packError("解凍後の合計容量が上限200MBを超えています");
      if (compressedSize > 0 && expandedSize / compressedSize > LIMITS.maxCompressionRatio) {
        throw packError(`圧縮率が異常に高いファイルがあります: ${name}`);
      }
      entries.set(name, { name, flags, method, crc32, compressedSize, expandedSize, localOffset });
    }
    return { entries, expandedTotal };
  }

  let crcTable;
  function calculateCrc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        crcTable[n] = value >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function extractEntry(buffer, entry) {
    const view = new DataView(buffer);
    const offset = entry.localOffset;
    if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
      throw packError(`ZIP内のファイル情報が壊れています: ${entry.name}`);
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > view.byteLength) throw packError(`ZIP内のファイルが途中で切れています: ${entry.name}`);
    const compressed = new Uint8Array(buffer.slice(dataOffset, dataEnd));
    let bytes;
    if (entry.method === 0) {
      bytes = compressed;
    } else {
      if (!("DecompressionStream" in window)) {
        throw packError("このブラウザはZIP展開に対応していません。最新版のブラウザを使用してください");
      }
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw packError(`ZIPの展開に失敗しました: ${entry.name}`);
      }
    }
    if (bytes.byteLength !== entry.expandedSize) throw packError(`解凍後のサイズが一致しません: ${entry.name}`);
    if (calculateCrc32(bytes) !== entry.crc32) throw packError(`ファイルの検査値が一致しません: ${entry.name}`);
    return bytes;
  }

  function detectImageType(bytes) {
    if (bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    return null;
  }

  function compareVersions(a, b) {
    if (!SAFE_VERSION.test(a || "") || !SAFE_VERSION.test(b || "")) return null;
    const left = a.split("-")[0].split(".").map(Number);
    const right = b.split("-")[0].split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
  }

  function validateManifest(manifest, entries, prefix) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw packError("manifest.jsonの内容が正しくありません");
    if (manifest.schemaVersion !== 1) throw packError(`schemaVersion ${manifest.schemaVersion}には対応していません`);
    if (!SAFE_ID.test(manifest.packId || "")) throw packError("packIdは半角英数字・ピリオド・ハイフン・アンダースコアで指定してください");
    if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 100) throw packError("パック名が指定されていないか、長すぎます");
    if (!SAFE_VERSION.test(manifest.version || "")) throw packError("versionは1.0.0のような形式で指定してください");
    if (!Array.isArray(manifest.characters) || !manifest.characters.length) throw packError("charactersに1体以上のキャラクターを指定してください");
    if (manifest.characters.length > LIMITS.maxCharacters) throw packError(`キャラクター数が上限${LIMITS.maxCharacters}体を超えています`);
    if (manifest.minimumQuestiaVersion && compareVersions(manifest.minimumQuestiaVersion, APP_VERSION) === 1) {
      throw packError(`このパックにはQuestia ${manifest.minimumQuestiaVersion}以上が必要です`);
    }

    const ids = new Set();
    const characters = manifest.characters.map((raw, index) => {
      if (!raw || typeof raw !== "object") throw packError(`${index + 1}番目のキャラクター情報が正しくありません`);
      if (!SAFE_ID.test(raw.id || "")) throw packError(`${index + 1}番目のキャラクターIDが不正です`);
      if (ids.has(raw.id)) throw packError(`キャラクターID「${raw.id}」が重複しています`);
      ids.add(raw.id);
      if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 100) throw packError(`キャラクター「${raw.id}」の名前が不正です`);
      if (!ALLOWED_RARITIES.has(raw.rarity)) throw packError(`キャラクター「${raw.id}」のレアリティ「${raw.rarity}」には対応していません`);
      if (!safePath(raw.image) || !IMAGE_EXTENSIONS.has(extensionOf(raw.image))) throw packError(`キャラクター「${raw.id}」の画像パスが不正です`);
      const imagePath = `${prefix}${raw.image}`;
      if (!entries.has(imagePath)) throw packError(`キャラクター「${raw.id}」の画像が見つかりません: ${raw.image}`);
      let thumbnailPath = null;
      if (raw.thumbnail != null) {
        if (!safePath(raw.thumbnail) || !IMAGE_EXTENSIONS.has(extensionOf(raw.thumbnail))) throw packError(`キャラクター「${raw.id}」のサムネイルパスが不正です`);
        thumbnailPath = `${prefix}${raw.thumbnail}`;
        if (!entries.has(thumbnailPath)) throw packError(`キャラクター「${raw.id}」のサムネイルが見つかりません`);
      }
      const weight = raw.weight == null ? 1 : Number(raw.weight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw packError(`キャラクター「${raw.id}」のweightは0より大きく100以下にしてください`);
      return {
        id: raw.id,
        fullCharacterId: `${manifest.packId}:${raw.id}`,
        name: raw.name.trim(),
        rarity: raw.rarity,
        weight,
        attribute: typeof raw.attribute === "string" ? raw.attribute.slice(0, 50) : "",
        series: typeof raw.series === "string" ? raw.series.slice(0, 100) : "",
        description: typeof raw.description === "string" ? raw.description.slice(0, 1000) : "",
        quote: typeof raw.quote === "string" ? raw.quote.slice(0, 300) : "",
        tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === "string").slice(0, 20).map(tag => tag.slice(0, 50)) : [],
        imagePath,
        thumbnailPath
      };
    });
    return characters;
  }

  async function parsePack(file) {
    if (!(file instanceof Blob)) throw packError("キャラクターパックを選択してください");
    if (file.size > LIMITS.maxPackBytes) throw packError("パックファイルが上限100MBを超えています");
    const lowerName = String(file.name || "").toLowerCase();
    if (lowerName && !lowerName.endsWith(".questiapack") && !lowerName.endsWith(".zip")) {
      throw packError(".questiapackまたは.zipファイルを選択してください");
    }
    const buffer = await file.arrayBuffer();
    const { entries, expandedTotal } = readZipEntries(buffer);
    const manifests = [...entries.keys()].filter(path => path === "manifest.json" || /^[^/]+\/manifest\.json$/.test(path));
    if (!manifests.length) throw packError("manifest.jsonが見つかりません");
    if (manifests.length > 1) throw packError("manifest.jsonが複数見つかりました");
    const manifestPath = manifests[0];
    const prefix = manifestPath.slice(0, -"manifest.json".length);
    const manifestBytes = await extractEntry(buffer, entries.get(manifestPath));
    if (manifestBytes.byteLength > 1024 * 1024) throw packError("manifest.jsonが大きすぎます");
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
      throw packError("manifest.jsonをJSONとして解析できません");
    }
    const characters = validateManifest(manifest, entries, prefix);
    const assets = new Map();
    for (const character of characters) {
      for (const [path, limit] of [[character.imagePath, LIMITS.maxImageBytes], [character.thumbnailPath, LIMITS.maxThumbnailBytes]]) {
        if (!path || assets.has(path)) continue;
        const entry = entries.get(path);
        if (entry.expandedSize > limit) throw packError(`${path}の容量が上限を超えています`);
        const bytes = await extractEntry(buffer, entry);
        const mimeType = detectImageType(bytes);
        if (!mimeType) throw packError(`${path}は対応画像形式ではないか、内容が拡張子と一致しません`);
        const extension = extensionOf(path);
        if ((mimeType === "image/webp" && extension !== "webp") ||
            (mimeType === "image/png" && extension !== "png") ||
            (mimeType === "image/jpeg" && !["jpg", "jpeg"].includes(extension))) {
          throw packError(`${path}の拡張子と画像形式が一致しません`);
        }
        assets.set(path, { path, mimeType, blob: new Blob([bytes], { type: mimeType }), size: bytes.byteLength, checksum: entry.crc32.toString(16).padStart(8, "0") });
      }
    }
    return {
      manifest: {
        schemaVersion: 1,
        packId: manifest.packId,
        name: manifest.name.trim(),
        version: manifest.version,
        description: typeof manifest.description === "string" ? manifest.description.slice(0, 2000) : "",
        author: typeof manifest.author === "string" ? manifest.author.slice(0, 100) : "",
        license: typeof manifest.license === "string" ? manifest.license.slice(0, 200) : "",
        createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt.slice(0, 30) : "",
        minimumQuestiaVersion: manifest.minimumQuestiaVersion || ""
      },
      characters,
      assets,
      compressedSize: file.size,
      expandedSize: expandedTotal
    };
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORES.manualImages)) database.createObjectStore(STORES.manualImages);
        if (!database.objectStoreNames.contains(STORES.packs)) database.createObjectStore(STORES.packs, { keyPath: "packId" });
        if (!database.objectStoreNames.contains(STORES.characters)) {
          const store = database.createObjectStore(STORES.characters, { keyPath: "fullCharacterId" });
          store.createIndex("packId", "packId", { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.assets)) {
          const store = database.createObjectStore(STORES.assets, { keyPath: "assetId" });
          store.createIndex("packId", "packId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || packError("パック保存領域を開けませんでした"));
      request.onblocked = () => reject(packError("別のQuestia画面がデータベースを使用中です。ほかのタブを閉じて再試行してください"));
    });
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function deleteIndexRecords(store, indexName, value) {
    return new Promise((resolve, reject) => {
      const request = store.index(indexName).openCursor(IDBKeyRange.only(value));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function installPack(parsedPack) {
    const database = await openDatabase();
    const transaction = database.transaction([STORES.packs, STORES.characters, STORES.assets], "readwrite");
    const packsStore = transaction.objectStore(STORES.packs);
    const charactersStore = transaction.objectStore(STORES.characters);
    const assetsStore = transaction.objectStore(STORES.assets);
    const existing = await requestPromise(packsStore.get(parsedPack.manifest.packId));
    await Promise.all([
      deleteIndexRecords(charactersStore, "packId", parsedPack.manifest.packId),
      deleteIndexRecords(assetsStore, "packId", parsedPack.manifest.packId)
    ]);
    const now = new Date().toISOString();
    const packRecord = {
      ...parsedPack.manifest,
      enabled: existing ? existing.enabled !== false : true,
      installedAt: existing?.installedAt || now,
      updatedAt: now,
      characterCount: parsedPack.characters.length,
      totalAssetSize: [...parsedPack.assets.values()].reduce((sum, asset) => sum + asset.size, 0)
    };
    packsStore.put(packRecord);
    for (const asset of parsedPack.assets.values()) {
      assetsStore.put({
        assetId: `${parsedPack.manifest.packId}:${asset.path}`,
        packId: parsedPack.manifest.packId,
        path: asset.path,
        mimeType: asset.mimeType,
        blob: asset.blob,
        size: asset.size,
        checksum: asset.checksum
      });
    }
    for (const character of parsedPack.characters) {
      charactersStore.put({
        ...character,
        id: character.fullCharacterId,
        characterId: character.id,
        packId: parsedPack.manifest.packId,
        packName: parsedPack.manifest.name,
        author: parsedPack.manifest.author,
        imageAssetId: `${parsedPack.manifest.packId}:${character.imagePath}`,
        thumbnailAssetId: character.thumbnailPath ? `${parsedPack.manifest.packId}:${character.thumbnailPath}` : `${parsedPack.manifest.packId}:${character.imagePath}`
      });
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => { database.close(); resolve({ pack: packRecord, isUpdate: !!existing }); };
      transaction.onerror = () => { database.close(); reject(transaction.error || packError("パックを保存できませんでした")); };
      transaction.onabort = () => { database.close(); reject(transaction.error || packError("パックの保存を中止しました")); };
    });
  }

  async function getAll(storeName) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readonly");
      return await requestPromise(transaction.objectStore(storeName).getAll());
    } finally {
      database.close();
    }
  }

  async function listPacks() {
    return (await getAll(STORES.packs)).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  async function listCharacters() {
    return getAll(STORES.characters);
  }

  async function getAssetBlob(assetId) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORES.assets, "readonly");
      const record = await requestPromise(transaction.objectStore(STORES.assets).get(assetId));
      return record?.blob || null;
    } finally {
      database.close();
    }
  }

  async function setPackEnabled(packId, enabled) {
    const database = await openDatabase();
    const transaction = database.transaction(STORES.packs, "readwrite");
    const store = transaction.objectStore(STORES.packs);
    const pack = await requestPromise(store.get(packId));
    if (!pack) { database.close(); throw packError("パックが見つかりません"); }
    pack.enabled = !!enabled;
    pack.updatedAt = new Date().toISOString();
    store.put(pack);
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => { database.close(); resolve(pack); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  }

  async function removePack(packId) {
    const database = await openDatabase();
    const transaction = database.transaction([STORES.packs, STORES.characters, STORES.assets], "readwrite");
    transaction.objectStore(STORES.packs).delete(packId);
    await Promise.all([
      deleteIndexRecords(transaction.objectStore(STORES.characters), "packId", packId),
      deleteIndexRecords(transaction.objectStore(STORES.assets), "packId", packId)
    ]);
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  }

  window.QuestiaPacks = Object.freeze({
    APP_VERSION,
    LIMITS,
    parsePack,
    installPack,
    listPacks,
    listCharacters,
    getAssetBlob,
    setPackEnabled,
    removePack,
    compareVersions
  });
})();
