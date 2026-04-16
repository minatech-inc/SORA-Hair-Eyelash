# Reservation System — 予約システム構築資料

SORA - HAIR & EYELASH - の予約システム（Square + LINE）構築のための資料一式。

## ファイル一覧

| ファイル | 内容 |
|---|---|
| [square_services.csv](./square_services.csv) | 全メニュー一覧。料金・所要時間・カテゴリ・説明文。Square登録用のチートシート |
| [square_setup_guide.md](./square_setup_guide.md) | Square Appointments 開設〜予約ページ公開までの手順書 |
| [line_setup_guide.md](./line_setup_guide.md) | LINE公式アカウント 開設〜運用開始までの手順書 |
| [line_auto_reply.md](./line_auto_reply.md) | あいさつメッセージ・自動応答・タグ設定のテンプレート集 |
| [richmenu_plan.md](./richmenu_plan.md) | リッチメニュー構成案・作成方法 |

---

## 全体の進め方（推奨順序）

### Phase 1: Square構築（1〜2日）

1. [square_setup_guide.md](./square_setup_guide.md) に従い Square Appointments を開設
2. [square_services.csv](./square_services.csv) を参照してメニューを登録
3. 所要時間をスタッフで確認・調整
4. テスト予約を実施して動作確認
5. **Square予約ページURL** を取得

### Phase 2: LINE構築（半日）

1. [line_setup_guide.md](./line_setup_guide.md) に従い LINE公式アカウントを開設
2. プロフィール・カバー画像を設定
3. [line_auto_reply.md](./line_auto_reply.md) のテンプレをコピペしてメッセージ設定
4. [richmenu_plan.md](./richmenu_plan.md) に従いリッチメニュー画像を作成・設定
5. **LINE友だち追加URL** を取得

### Phase 3: サイトへの反映（5分）

取得した2つのURLをサイトに反映：

- Square予約URL → `main.js` の `SITE.reserve.square` と各HTMLのSquareボタン
- LINE友だち追加URL → `main.js` の `SITE.reserve.line` と各HTMLのLINEボタン

Claude に以下のように伝えれば一括で書き換えます：

```
Square URL: https://book.squareup.com/appointments/xxxxxxxx
LINE URL: https://lin.ee/xxxxxxxx
これをサイトに反映して
```

### Phase 4: 運用開始前のチェック（30分）

- [ ] サイトの全ボタン（Square/LINE）がそれぞれ正しく動くか
- [ ] LINEの友だち追加→あいさつメッセージ→リッチメニュータップ→Square予約の動線確認
- [ ] Square予約→確認メール受信→キャンセル可能まで確認
- [ ] モバイルブラウザでの表示確認（iPhone Safari / Android Chrome）
- [ ] Google マイビジネスにも同じ情報を登録（ローカルSEO対策）

---

## 運用上のルール

1. **予約確定は必ずSquare経由**
   LINE会話だけで確定しない。ダブルブッキング防止のため。

2. **LINEは相談・質問対応のみ**
   予約の確定が必要なメッセージが来たら「Square予約リンク」に誘導する。

3. **営業時間外の返信は翌営業日に**
   24時間対応だと疲弊する。ユーザーへの期待値も正しく設定する。

4. **月1でデータ確認**
   - Square: どのメニューが人気か、時間帯別の予約数
   - LINE: 友だち数、メッセージ受信数、リッチメニュータップ率

5. **新メニュー・キャンペーン時は一斉配信**
   LINEフリープランは月200通まで無料。計画的に使う。

---

## 暫定値・要確認項目

以下は資料内で暫定値として設定しています。スタッフ・オーナーで確定させてください：

- **営業時間**: 10:00 - 19:00 (仮)
- **最終受付時間**: 各メニューの所要時間次第
- **所要時間**: [square_services.csv](./square_services.csv) 記載の値は大手相場からの推定値
- **初回限定**: 適用条件をスタッフで合意（例: 過去来店なし / 初めてのカウンセリング後等）
- **キャンセルポリシー**: 例「前日まで無料 / 当日50% / 無断キャンセル100%」等を決めてSquareとLINE双方に記載

---

## 参考

- Square Appointments 公式: https://squareup.com/jp/ja/appointments
- LINE公式アカウントマネージャー: https://manager.line.biz/
- Square 料金プラン: https://squareup.com/jp/ja/software/appointments/pricing
- LINE公式 料金プラン: https://www.linebiz.com/jp/service/line-official-account/plan/
