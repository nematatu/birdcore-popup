# bird-popup

BIRDSCOREのライブスコアをポップアップで表示するChrome拡張です。

## 使い方

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選択

## 設定

`popup.js` 内の `CONFIG` を変更すると大会を切り替えられます。

- `tournamentId`: 大会ID
- `baseUrl`: BIRDSCOREのベースURL

## 表示内容

- ライブ: `courts.json` で現在試合中のコートを取得
- 終了試合: `schedule.json` の終了フラグを参照して直近分を表示
