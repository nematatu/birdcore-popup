# bird-popup

BIRDSCOREのライブスコアをポップアップで表示するChrome拡張です。

## 使い方

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選択

## 設定

大会は自動検出します。取得に失敗した場合のみ `CONFIG.tournamentId` を既定値として使用します。

- `baseUrl`: BIRDSCOREのベースURL
- `tournamentId`: 自動検出できない場合の既定大会ID
- `tournamentDiscoveryPaths`: 大会一覧取得の試行パス
- `tournamentCacheTtlMs`: 大会一覧のキャッシュ時間

チーム名短縮は `team-aliases.json` の `aliases` に `正式名称: 略称` を追加します。

## 表示内容

- ライブ: `courts.json` で現在試合中のコートを取得
- 終了試合: `schedule.json` の終了フラグを参照して直近分を表示
- 参加者: `teams.json` を優先し、取得不可の場合は `orgs.json` を使用
