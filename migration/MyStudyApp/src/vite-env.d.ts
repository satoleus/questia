/// <reference types="vite/client" />

interface QuestiaPackApi {
  APP_VERSION: string;
  LIMITS: Record<string, number>;
  parsePack: (file: File) => Promise<any>;
  installPack: (pack: any) => Promise<{ pack: any; isUpdate: boolean }>;
  listPacks: () => Promise<any[]>;
  listCharacters: () => Promise<any[]>;
  getAssetBlob: (assetId: string) => Promise<Blob | null>;
  setPackEnabled: (packId: string, enabled: boolean) => Promise<any>;
  removePack: (packId: string) => Promise<void>;
  compareVersions: (a: string, b: string) => number | null;
}

interface Window {
  QuestiaPacks: QuestiaPackApi;
}
