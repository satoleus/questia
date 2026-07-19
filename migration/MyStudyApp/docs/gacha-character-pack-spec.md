# Questia Character Pack 仕様 v1

Questiaへキャラクターを追加するオフラインパックの仕様です。拡張子は
`.questiapack`（実体はZIP）を推奨し、`.zip`も読み込めます。

## 最小構成

```text
my-pack/
├── manifest.json
└── characters/
    └── hero.webp
```

ZIP直下に直接`manifest.json`を置く構成も利用できます。パック内に実行コードは
含められません。

## manifest.json

```json
{
  "schemaVersion": 1,
  "packId": "com.example.my-pack",
  "name": "マイキャラクターパック",
  "version": "1.0.0",
  "author": "作者名",
  "description": "パックの説明",
  "minimumQuestiaVersion": "1.0.0",
  "characters": [
    {
      "id": "hero",
      "name": "星の勇者",
      "rarity": "SSR",
      "weight": 1,
      "image": "characters/hero.webp",
      "thumbnail": "thumbnails/hero.webp",
      "attribute": "light",
      "series": "星空の冒険譚",
      "description": "キャラクターの説明",
      "quote": "一緒に進もう。",
      "tags": ["星", "光属性"]
    }
  ]
}
```

必須項目は、パックの`schemaVersion`、`packId`、`name`、`version`、
`characters`と、各キャラクターの`id`、`name`、`rarity`、`image`です。

## 命名規則

- `packId`とキャラクター`id`：半角英数字で始め、半角英数字・`.`・`-`・`_`のみ
- 内部ID：Questiaが`packId:characterId`として生成
- バージョン：`1.0.0`形式
- レアリティ：`R`、`SR`、`SSR`
- パス：ZIP内の安全な相対パス。`../`、絶対パス、URLは禁止

## 画像

- 対応形式：WebP、PNG、JPEG
- 推奨：縦長WebP、長辺900〜1600px、1枚2MB以下
- 上限：キャラクター画像15MB、サムネイル3MB
- SVG、GIF、HTML、JavaScript、実行ファイルは禁止
- `thumbnail`省略時は`image`を一覧表示にも利用

## weight

同じレアリティ内での基本抽選重みです。省略時は`1`、指定範囲は`0より大きく
100以下`です。Questiaはこの値へ重複排出による緩やかな減衰を掛けます。
レアリティ全体のSSR 3%・SR 17%・R 80%は変化しません。

## 制限

- パックZIP：100MB
- 解凍後合計：200MB
- キャラクター：500体
- ファイル：2000件
- 異常な圧縮率、暗号化ZIP、分割ZIP、ZIP64は拒否

## 作成手順

1. フォルダと画像を用意する。
2. UTF-8の`manifest.json`を作成する。
3. `manifest.json`がZIP直下または単一の親フォルダ直下になるよう圧縮する。
4. 拡張子を`.questiapack`にする。
5. Questiaの「設定 → 召喚ライブラリ → キャラクターパックを追加」で検証する。

同じ`packId`を再読込すると更新扱いになります。更新時もIDを維持すると、
獲得履歴と新しい画像が再接続されます。削除したキャラクターIDを別キャラクターへ
再利用しないでください。
