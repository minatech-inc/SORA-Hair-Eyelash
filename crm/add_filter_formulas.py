"""
SORA Salon - 顧客カルテにフィルタ用フォーミュラを追加
これにより、Notion UIで「テキストが空でない」等で簡単にフィルタ可能になる

【追加されるフォーミュラ列】
- 常連: 来店回数>=5なら "⭐ 常連" 表示
- 新規: 初来店日が30日以内なら "🌱 新規" 表示
- 要フォロー: 最終来店から60日経過 AND ステータス=アクティブなら "⚠️ 要フォロー" 表示
- 今月誕生日: 誕生月が今月なら "🎂 今月誕生日" 表示

【実行方法】
  $env:NOTION_TOKEN = "ntn_..."
  python add_filter_formulas.py
"""

import os
import sys
import requests

NOTION_API_BASE = 'https://api.notion.com/v1'
NOTION_VERSION = '2022-06-28'

token = os.environ.get('NOTION_TOKEN')
if not token:
    print("エラー: NOTION_TOKEN を設定してください")
    sys.exit(1)

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
}


def find_db(title):
    r = requests.post(f'{NOTION_API_BASE}/search', headers=headers,
                      json={'query': title, 'filter': {'property': 'object', 'value': 'database'}})
    for item in r.json().get('results', []):
        text = ''.join([t.get('plain_text', '') for t in item.get('title', [])])
        if title in text:
            return item['id']
    return None


def main():
    print("顧客カルテにフィルタフォーミュラを追加します...")
    db_id = find_db('顧客カルテ')
    if not db_id:
        print("エラー: 顧客カルテDBが見つかりません")
        sys.exit(1)
    print(f"  顧客カルテ ID: {db_id}")

    formula_props = {
        '常連フラグ': {
            'formula': {
                'expression': 'if(prop("来店回数") >= 5, "⭐ 常連", "")'
            }
        },
        '新規フラグ': {
            'formula': {
                'expression': 'if(empty(prop("初来店日")), "", if(dateBetween(now(), prop("初来店日"), "days") <= 30, "🌱 新規", ""))'
            }
        },
        '要フォローフラグ': {
            'formula': {
                'expression': 'if(empty(prop("最終来店日")), "", if(and(dateBetween(now(), prop("最終来店日"), "days") > 60, prop("ステータス") == "アクティブ"), "⚠️ 要フォロー", ""))'
            }
        },
        '今月誕生日フラグ': {
            'formula': {
                'expression': 'if(empty(prop("生年月日")), "", if(formatDate(prop("生年月日"), "MM") == formatDate(now(), "MM"), "🎂 今月誕生日", ""))'
            }
        },
    }

    r = requests.patch(
        f'{NOTION_API_BASE}/databases/{db_id}',
        headers=headers,
        json={'properties': formula_props}
    )

    if r.status_code == 200:
        print("  OK: フォーミュラ4種を追加しました")
        print()
        print("Notion UIでビューを追加するには:")
        print("  1. 顧客カルテDBを開く")
        print("  2. 既存の「テーブル」タブの右の「+」をクリック")
        print("  3. 「テーブル」を選択 → 名前を「⭐ 常連様」等に")
        print("  4. フィルタ → 「常連フラグ」が「is not empty」")
        print("  5. 同様に「🌱 新規」「⚠️ 要フォロー」「🎂 今月誕生日」を作成")
    else:
        print(f"  エラー: {r.status_code}")
        print(f"  詳細: {r.text[:500]}")


if __name__ == '__main__':
    main()
