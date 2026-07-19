import { FormEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Gem, PackagePlus, Plus, Power, Trash2, Upload, X,
} from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useGachaStore } from '../store/gachaStore';
import {
  compressCharacterImage, createStableId, deleteManualImage,
  loadManualImage, saveManualImage,
} from '../features/gacha/mediaStore';
import type {
  GachaCharacter, GachaRarity, InstalledCharacterPack,
} from '../features/gacha/types';
import '../gacha.css';

const GACHA_COST = 5;
const RARITY_COLORS: Record<GachaRarity, string> = {
  R: '#72bcff', SR: '#c691ff', SSR: '#ffd167',
};

type Tab = 'summon' | 'collection' | 'packs';
type AnimationState = 'closed' | 'ready' | 'charging' | 'orb' | 'reveal' | 'result';

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function rarityRoll(): GachaRarity {
  const value = Math.random() * 100;
  return value < 3 ? 'SSR' : value < 20 ? 'SR' : 'R';
}

function weightedDraw(pool: GachaCharacter[], counts: Record<string, number>) {
  const weighted = pool.map(character => ({
    character,
    weight: Math.min(100, Math.max(0.01, Number(character.weight || 1)))
      * Math.max(0.55, 0.94 ** Number(counts[character.id] || 0)),
  }));
  let point = Math.random() * weighted.reduce((sum, item) => sum + item.weight, 0);
  for (const item of weighted) {
    point -= item.weight;
    if (point <= 0) return item.character;
  }
  return weighted[weighted.length - 1].character;
}

export default function Gacha() {
  const navigate = useNavigate();
  const { user, subtractOrbs } = useUserStore();
  const {
    manualCharacters, owned, addManualCharacter, removeManualCharacter,
    recordPull, preserveSnapshot,
  } = useGachaStore();
  const [tab, setTab] = useState<Tab>('summon');
  const [packs, setPacks] = useState<InstalledCharacterPack[]>([]);
  const [packCharacters, setPackCharacters] = useState<GachaCharacter[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const objectUrls = useRef<string[]>([]);
  const timers = useRef<number[]>([]);
  const [animation, setAnimation] = useState<AnimationState>('closed');
  const [drawn, setDrawn] = useState<GachaCharacter | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [detail, setDetail] = useState<GachaCharacter | null>(null);
  const [packStatus, setPackStatus] = useState('');
  const [packError, setPackError] = useState('');
  const [pendingPack, setPendingPack] = useState<any>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

  function closePackPreview() {
    previewUrls.forEach(URL.revokeObjectURL);
    setPreviewUrls([]);
    setPendingPack(null);
  }

  const refreshLibrary = useCallback(async () => {
    if (!window.QuestiaPacks) return;
    const [nextPacks, rawCharacters] = await Promise.all([
      window.QuestiaPacks.listPacks(),
      window.QuestiaPacks.listCharacters(),
    ]);
    const packMap = new Map(nextPacks.map((pack: InstalledCharacterPack) => [pack.packId, pack]));
    const characters: GachaCharacter[] = rawCharacters.map((character: any) => ({
      ...character,
      id: character.fullCharacterId,
      source: 'pack',
      packEnabled: packMap.get(character.packId)?.enabled !== false,
    }));
    const urls: Record<string, string> = {};
    for (const character of manualCharacters) {
      if (!character.imageKey) continue;
      const blob = await loadManualImage(character.imageKey).catch(() => null);
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        urls[character.id] = url;
      }
    }
    for (const character of characters) {
      const blob = await window.QuestiaPacks.getAssetBlob(character.thumbnailAssetId || character.imageAssetId || '');
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        urls[character.id] = url;
      }
    }
    setPacks(nextPacks);
    setPackCharacters(characters);
    setImageUrls(previous => ({ ...previous, ...urls }));
  }, [manualCharacters]);

  useEffect(() => {
    refreshLibrary().catch(error => setPackError(error.message));
  }, [refreshLibrary]);

  useEffect(() => () => {
    objectUrls.current.forEach(URL.revokeObjectURL);
    previewUrls.forEach(URL.revokeObjectURL);
    timers.current.forEach(clearTimeout);
  }, []);

  const liveCharacters = useMemo(() => [
    ...manualCharacters.map(character => ({ ...character, imageUrl: imageUrls[character.id] })),
    ...packCharacters.map(character => ({ ...character, imageUrl: imageUrls[character.id] })),
  ], [manualCharacters, packCharacters, imageUrls]);

  const collectionCharacters = useMemo(() => {
    const ids = new Set(liveCharacters.map(character => character.id));
    const missing = Object.values(owned)
      .filter(snapshot => snapshot.packId && !ids.has(snapshot.id))
      .map(snapshot => ({
        ...snapshot,
        source: 'missing' as const,
        missingPack: true,
      }));
    return [...liveCharacters, ...missing] as GachaCharacter[];
  }, [liveCharacters, owned]);

  const candidates = useMemo(
    () => liveCharacters.filter(character => character.source === 'manual' || character.packEnabled !== false),
    [liveCharacters],
  );
  const pullCounts = useMemo(
    () => Object.fromEntries(Object.entries(owned).map(([id, snapshot]) => [id, snapshot.count])),
    [owned],
  );

  function clearAnimationTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function openGacha() {
    if (!candidates.length) {
      setPackError('先にキャラクターを登録するか、キャラクターパックを有効にしてください');
      setTab('collection');
      return;
    }
    if (user.orbs < GACHA_COST) {
      setPackError(`オーブがあと${GACHA_COST - user.orbs}個必要です`);
      return;
    }
    setPackError('');
    setDrawn(null);
    setAnimation('ready');
  }

  function activateGacha() {
    if (animation !== 'ready' || user.orbs < GACHA_COST) return;
    const rarity = rarityRoll();
    const rarityPool = candidates.filter(character => character.rarity === rarity);
    const character = weightedDraw(rarityPool.length ? rarityPool : candidates, pullCounts);
    subtractOrbs(GACHA_COST);
    recordPull(character);
    setDrawn(character);
    setAnimation('charging');
    navigator.vibrate?.([35, 35, 50, 35, 80]);
    timers.current.push(window.setTimeout(() => setAnimation('orb'), 900));
    timers.current.push(window.setTimeout(() => setAnimation('reveal'), 1800));
    timers.current.push(window.setTimeout(() => setAnimation('result'), character.rarity === 'SSR' ? 3000 : 2650));
  }

  function closeAnimation() {
    clearAnimationTimers();
    setAnimation('closed');
  }

  function continueGacha() {
    if (user.orbs < GACHA_COST) {
      closeAnimation();
      return;
    }
    setDrawn(null);
    setAnimation('ready');
  }

  async function registerCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('image') as File;
    const name = String(form.get('name') || '').trim();
    const rarity = String(form.get('rarity')) as GachaRarity;
    if (!file?.size || !name) return;
    try {
      const blob = await compressCharacterImage(file);
      const id = createStableId('custom');
      await saveManualImage(id, blob);
      addManualCharacter({ id, name, rarity, imageKey: id, source: 'manual', weight: 1 });
      setRegisterOpen(false);
      event.currentTarget.reset();
      setPackError('');
    } catch (error) {
      setPackError(error instanceof Error ? error.message : '画像を登録できませんでした');
    }
  }

  async function removeManual(character: GachaCharacter) {
    if (!confirm(`「${character.name}」を削除しますか？`)) return;
    removeManualCharacter(character.id);
    if (character.imageKey) await deleteManualImage(character.imageKey).catch(() => {});
  }

  async function readPack(file?: File) {
    if (!file) return;
    setPackStatus('パックを検査しています…');
    setPackError('');
    try {
      const parsed = await window.QuestiaPacks.parsePack(file);
      previewUrls.forEach(URL.revokeObjectURL);
      const urls = parsed.characters.slice(0, 3).map((character: any) => {
        const asset = parsed.assets.get(character.thumbnailPath || character.imagePath);
        return URL.createObjectURL(asset.blob);
      });
      setPreviewUrls(urls);
      setPendingPack({
        parsed,
        existing: packs.find(pack => pack.packId === parsed.manifest.packId),
      });
      setPackStatus('');
    } catch (error) {
      setPackStatus('');
      setPackError(error instanceof Error ? error.message : 'パックを読み込めませんでした');
    }
  }

  async function installPendingPack() {
    if (!pendingPack) return;
    setInstalling(true);
    try {
      const newIds = new Set(pendingPack.parsed.characters.map((character: any) => character.fullCharacterId));
      packCharacters
        .filter(character => character.packId === pendingPack.parsed.manifest.packId && owned[character.id] && !newIds.has(character.id))
        .forEach(preserveSnapshot);
      await window.QuestiaPacks.installPack(pendingPack.parsed);
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      closePackPreview();
      await refreshLibrary();
      setPackStatus('キャラクターパックを保存しました');
    } catch (error) {
      setPackError(error instanceof Error ? error.message : 'インストールに失敗しました');
    } finally {
      setInstalling(false);
    }
  }

  async function togglePack(pack: InstalledCharacterPack) {
    await window.QuestiaPacks.setPackEnabled(pack.packId, pack.enabled === false);
    await refreshLibrary();
  }

  async function removePack(pack: InstalledCharacterPack) {
    const characters = packCharacters.filter(character => character.packId === pack.packId);
    const acquired = characters.filter(character => owned[character.id]);
    if (!confirm(`「${pack.name}」を削除しますか？\n\n${pack.characterCount}体 / ${formatBytes(pack.totalAssetSize)}\n獲得済み${acquired.length}体の履歴は残ります。`)) return;
    acquired.forEach(preserveSnapshot);
    await window.QuestiaPacks.removePack(pack.packId);
    await refreshLibrary();
  }

  const drawnCount = drawn ? (owned[drawn.id]?.count || 0) : 0;

  return (
    <div className="page gacha-page">
      <header className="gacha-page-header">
        <button className="btn btn-ghost" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <div>
          <p>STUDY REWARD</p>
          <h1>ガチャ</h1>
        </div>
        <div className="gacha-orbs"><Gem size={16} />{user.orbs}</div>
      </header>

      <div className="gacha-tabs">
        <button className={tab === 'summon' ? 'active' : ''} onClick={() => setTab('summon')}>召喚</button>
        <button className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>コレクション</button>
        <button className={tab === 'packs' ? 'active' : ''} onClick={() => setTab('packs')}>パック</button>
      </div>

      {packError && <div className="gacha-alert">{packError}</div>}

      {tab === 'summon' && (
        <>
          <section className="gacha-banner">
            <div>
              <small>FOCUS REWARD</small>
              <h2>星明かりの<br />仲間たち</h2>
              <p>勉強で集めたオーブから、<br />新しい仲間を召喚しよう。</p>
              <div className="gacha-rates"><span>SSR 3%</span><span>SR 17%</span><span>R 80%</span></div>
            </div>
            <div className="gacha-banner-gem">✦</div>
          </section>
          <button className="gacha-main-button" onClick={openGacha}>
            <b>1回引く</b><small><Gem size={12} /> 5</small>
          </button>
          <p className="gacha-help">同じキャラクターは排出回数に応じて少しずつ出にくくなります。</p>
        </>
      )}

      {tab === 'collection' && (
        <>
          <div className="gacha-section-heading">
            <div><h2>コレクション</h2><p>{Object.keys(owned).length} / {collectionCharacters.length}体獲得</p></div>
            <button className="btn btn-primary btn-sm" onClick={() => setRegisterOpen(true)}><Plus size={15} />キャラ追加</button>
          </div>
          {!collectionCharacters.length && <div className="gacha-empty">キャラクターがまだ登録されていません。</div>}
          <div className="gacha-collection-grid">
            {collectionCharacters.map(character => {
              const obtained = owned[character.id];
              return (
                <article className={`gacha-character-card ${obtained ? '' : 'locked'}`} key={character.id}>
                  <button className="gacha-character-main" disabled={!obtained} onClick={() => obtained && setDetail(character)}>
                    <div className="gacha-character-art">
                      {character.imageUrl ? <img src={character.imageUrl} alt="" /> : <span>{character.missingPack ? '◇' : obtained ? '✦' : '?'}</span>}
                    </div>
                    <b>{obtained ? character.name : '？？？'}</b>
                    <small>{character.missingPack ? 'パック未インストール' : `${character.rarity}${obtained ? ` · ${obtained.count}回` : ''}`}</small>
                  </button>
                  {character.source === 'manual' && (
                    <button className="gacha-delete-character" onClick={() => removeManual(character)} aria-label={`${character.name}を削除`}><X size={15} /></button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {tab === 'packs' && (
        <>
          <label className="gacha-pack-drop">
            <PackagePlus size={30} />
            <b>キャラクターパックを追加</b>
            <small>.questiapack または .zip</small>
            <input type="file" accept=".questiapack,.zip,application/zip" onChange={event => readPack(event.target.files?.[0])} />
          </label>
          {packStatus && <div className="gacha-pack-status">{packStatus}</div>}
          <div className="gacha-section-heading"><div><h2>インストール済み</h2><p>{packs.length}パック</p></div></div>
          {!packs.length && <div className="gacha-empty">パックはまだありません。<br />上のボタンから追加できます。</div>}
          <div className="gacha-pack-list">
            {packs.map(pack => (
              <article className="gacha-pack-card" key={pack.packId}>
                <div>
                  <h3>{pack.name}</h3>
                  <p>{pack.author || '作者未記載'} · v{pack.version}<br />{pack.characterCount}体 / {formatBytes(pack.totalAssetSize)}</p>
                  <span className={pack.enabled === false ? 'off' : 'on'}>{pack.enabled === false ? '無効' : '有効'}</span>
                </div>
                <div>
                  <button onClick={() => togglePack(pack)}><Power size={14} />{pack.enabled === false ? '有効' : '無効'}</button>
                  <button className="danger" onClick={() => removePack(pack)}><Trash2 size={14} />削除</button>
                </div>
              </article>
            ))}
          </div>
          <a className="gacha-sample-link" href="/examples/study-gacha-sample.questiapack" download>動作確認用サンプルパックをダウンロード</a>
        </>
      )}

      {animation !== 'closed' && (
        <div className="gacha-animation-overlay" role="dialog" aria-modal="true">
          {animation === 'result' && drawn ? (
            <div className="gacha-result-card" style={{ '--rarity-color': RARITY_COLORS[drawn.rarity] } as CSSProperties}>
              <button onClick={closeAnimation}><X /></button>
              <p>{drawn.rarity}</p>
              <div>{drawn.imageUrl ? <img src={drawn.imageUrl} alt={drawn.name} /> : <span>✦</span>}</div>
              <h2>{drawn.name}</h2>
              <small>{drawnCount === 1 ? 'NEW! 新しい仲間です' : `${drawnCount}回目の出会いです`}</small>
              <div className="gacha-result-actions">
                <button onClick={() => { closeAnimation(); setTab('collection'); }}>コレクションへ</button>
                <button onClick={continueGacha} disabled={user.orbs < GACHA_COST}>続けて回す <Gem size={12} />5</button>
              </div>
            </div>
          ) : (
            <div className={`gacha-machine-stage ${animation} rarity-${drawn?.rarity?.toLowerCase() || 'r'}`}>
              {animation === 'ready' && <button className="gacha-animation-close" onClick={closeAnimation}><X /></button>}
              <p>{animation === 'ready' ? 'ガチャをまわしてキャラを出せ♡' : animation === 'charging' ? '魔力を集束中…' : animation === 'orb' ? '召喚オーブが顕現した！' : '召喚の刻！'}</p>
              <img src="/assets/gacha-machine.webp" alt="黄金と群青のガチャ機" />
              <div className="gacha-magic-ring" />
              <div className="gacha-summon-orb">✦</div>
              {animation === 'ready' && <button className="gacha-activate" onClick={activateGacha}><span>✦</span><b>ガチャをまわす</b><small>ORB 5</small></button>}
              <div className="gacha-reveal-flash" />
            </div>
          )}
        </div>
      )}

      {registerOpen && (
        <div className="modal-overlay">
          <form className="modal-content gacha-form" onSubmit={registerCharacter}>
            <div className="modal-header"><h2 className="modal-title">キャラクター登録</h2><button type="button" className="btn btn-ghost" onClick={() => setRegisterOpen(false)}><X /></button></div>
            <label>名前<input name="name" maxLength={50} required placeholder="キャラクター名" /></label>
            <label>レアリティ<select name="rarity" defaultValue="R"><option>R</option><option>SR</option><option>SSR</option></select></label>
            <label className="gacha-file-input"><Upload />イラストを選択<input name="image" type="file" accept="image/*" required /></label>
            <div className="gacha-form-actions"><button type="button" className="btn btn-secondary" onClick={() => setRegisterOpen(false)}>キャンセル</button><button className="btn btn-primary">ガチャに追加</button></div>
          </form>
        </div>
      )}

      {pendingPack && (
        <div className="modal-overlay">
          <div className="modal-content gacha-pack-preview">
            <div className="modal-header"><h2 className="modal-title">{pendingPack.parsed.manifest.name}</h2><button className="btn btn-ghost" onClick={closePackPreview}><X /></button></div>
            <span>{pendingPack.existing ? '更新候補' : '新規インストール'}</span>
            <dl>
              <div><dt>パックID</dt><dd>{pendingPack.parsed.manifest.packId}</dd></div>
              <div><dt>作者</dt><dd>{pendingPack.parsed.manifest.author || '未記載'}</dd></div>
              <div><dt>バージョン</dt><dd>{pendingPack.existing ? `${pendingPack.existing.version} → ` : ''}{pendingPack.parsed.manifest.version}</dd></div>
              <div><dt>キャラクター</dt><dd>{pendingPack.parsed.characters.length}体</dd></div>
              <div><dt>容量</dt><dd>{formatBytes(pendingPack.parsed.expandedSize)}</dd></div>
            </dl>
            <p>{pendingPack.parsed.manifest.description || '説明はありません。'}</p>
            <div className="gacha-pack-previews">
              {pendingPack.parsed.characters.slice(0, 3).map((character: any, index: number) => (
                <div key={character.id}><img src={previewUrls[index]} alt="" /><small>{character.rarity} {character.name}</small></div>
              ))}
            </div>
            <div className="gacha-form-actions"><button className="btn btn-secondary" onClick={closePackPreview}>キャンセル</button><button className="btn btn-primary" disabled={installing} onClick={installPendingPack}>{installing ? '保存中…' : pendingPack.existing ? '更新する' : 'インストール'}</button></div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-overlay">
          <div className="modal-content gacha-detail" style={{ '--rarity-color': RARITY_COLORS[detail.rarity] } as CSSProperties}>
            <button className="gacha-detail-close" onClick={() => setDetail(null)}><X /></button>
            <p>{detail.rarity}</p>
            <div className="gacha-detail-art">{detail.imageUrl ? <img src={detail.imageUrl} alt={detail.name} /> : <span>✦</span>}</div>
            <h2>{detail.name}</h2>
            <small>{detail.missingPack ? '対応パックを再インストールすると画像が復元されます' : detail.packName || '手動登録'} · 排出{owned[detail.id]?.count || 0}回</small>
            {detail.series && <p>{detail.series}</p>}
            {detail.description && <p>{detail.description}</p>}
            {detail.quote && <blockquote>「{detail.quote}」</blockquote>}
          </div>
        </div>
      )}
    </div>
  );
}
