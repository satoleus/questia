export type GachaRarity = 'R' | 'SR' | 'SSR';

export interface GachaCharacter {
  id: string;
  characterId?: string;
  packId?: string;
  packName?: string;
  author?: string;
  name: string;
  rarity: GachaRarity;
  weight?: number;
  attribute?: string;
  series?: string;
  description?: string;
  quote?: string;
  imageKey?: string;
  imageAssetId?: string;
  thumbnailAssetId?: string;
  imageUrl?: string;
  packEnabled?: boolean;
  missingPack?: boolean;
  source: 'manual' | 'pack' | 'missing';
}

export interface OwnedCharacterSnapshot {
  id: string;
  characterId: string;
  packId: string;
  packName: string;
  author: string;
  name: string;
  rarity: GachaRarity;
  attribute: string;
  series: string;
  description: string;
  quote: string;
  acquiredAt: string;
  count: number;
}

export interface InstalledCharacterPack {
  packId: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  enabled: boolean;
  characterCount: number;
  totalAssetSize: number;
  installedAt: string;
  updatedAt: string;
}
