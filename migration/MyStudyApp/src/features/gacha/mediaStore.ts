const DB_NAME = 'my-study-gacha-media-v1';
const DB_VERSION = 2;
const MANUAL_STORE = 'character-images';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANUAL_STORE)) db.createObjectStore(MANUAL_STORE);
      if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'packId' });
      if (!db.objectStoreNames.contains('pack-characters')) {
        const store = db.createObjectStore('pack-characters', { keyPath: 'fullCharacterId' });
        store.createIndex('packId', 'packId', { unique: false });
      }
      if (!db.objectStoreNames.contains('pack-assets')) {
        const store = db.createObjectStore('pack-assets', { keyPath: 'assetId' });
        store.createIndex('packId', 'packId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('画像保存領域を開けませんでした'));
  });
}

export async function saveManualImage(key: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MANUAL_STORE, 'readwrite');
    transaction.objectStore(MANUAL_STORE).put(blob, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function loadManualImage(key: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MANUAL_STORE, 'readonly');
    const request = transaction.objectStore(MANUAL_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function deleteManualImage(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MANUAL_STORE, 'readwrite');
    transaction.objectStore(MANUAL_STORE).delete(key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export function createStableId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return `${prefix}-${[...values].map(value => value.toString(16).padStart(8, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function compressCharacterImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください');
  const url = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('画像を読み込めませんでした'));
    element.src = url;
  });
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像処理を開始できませんでした');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を圧縮できませんでした')), 'image/webp', 0.76);
  });
}
