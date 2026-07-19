import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GachaCharacter, OwnedCharacterSnapshot } from '../features/gacha/types';

interface GachaState {
  manualCharacters: GachaCharacter[];
  owned: Record<string, OwnedCharacterSnapshot>;
  addManualCharacter: (character: GachaCharacter) => void;
  removeManualCharacter: (id: string) => void;
  recordPull: (character: GachaCharacter) => void;
  preserveSnapshot: (character: GachaCharacter) => void;
}

function toSnapshot(character: GachaCharacter, previous?: OwnedCharacterSnapshot): OwnedCharacterSnapshot {
  return {
    id: character.id,
    characterId: character.characterId || character.id,
    packId: character.packId || '',
    packName: character.packName || '',
    author: character.author || '',
    name: character.name,
    rarity: character.rarity,
    attribute: character.attribute || '',
    series: character.series || '',
    description: character.description || '',
    quote: character.quote || '',
    acquiredAt: previous?.acquiredAt || new Date().toISOString(),
    count: previous?.count || 0,
  };
}

export const useGachaStore = create<GachaState>()(
  persist(
    (set) => ({
      manualCharacters: [],
      owned: {},
      addManualCharacter: character =>
        set(state => ({ manualCharacters: [...state.manualCharacters, character] })),
      removeManualCharacter: id =>
        set(state => {
          const owned = { ...state.owned };
          delete owned[id];
          return {
            manualCharacters: state.manualCharacters.filter(character => character.id !== id),
            owned,
          };
        }),
      recordPull: character =>
        set(state => {
          const previous = state.owned[character.id];
          const snapshot = toSnapshot(character, previous);
          snapshot.count = (previous?.count || 0) + 1;
          return { owned: { ...state.owned, [character.id]: snapshot } };
        }),
      preserveSnapshot: character =>
        set(state => {
          if (!state.owned[character.id]) return state;
          return {
            owned: {
              ...state.owned,
              [character.id]: {
                ...toSnapshot(character, state.owned[character.id]),
                count: state.owned[character.id].count,
              },
            },
          };
        }),
    }),
    { name: 'my-study-gacha' }
  )
);
