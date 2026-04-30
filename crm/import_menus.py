"""
SORA Salon - メニューマスタ CSVインポートスクリプト
menu_master_for_notion.csvの38件をNotionのメニューマスタDBに一括投入する

【実行方法】(PowerShell)
  # トークンが既に設定済みならそのまま
  python import_menus.py
"""

import os
import sys
import csv
import time
import requests

NOTION_API_BASE = 'https://api.notion.com/v1'
NOTION_VERSION = '2022-06-28'

token = os.environ.get('NOTION_TOKEN')
if not token:
    print("エラー: NOTION_TOKEN 環境変数が設定されていません")
    sys.exit(1)

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
}


def search(query='', filter_type=None):
    payload = {'query': query, 'page_size': 100}
    if filter_type:
        payload['filter'] = {'property': 'object', 'value': filter_type}
    r = requests.post(f'{NOTION_API_BASE}/search', headers=headers, json=payload)
    r.raise_for_status()
    return r.json().get('results', [])


def find_database(title):
    for r in search(title, 'database'):
        text = ''.join([t.get('plain_text', '') for t in r.get('title', [])])
        if title in text:
            return r['id']
    return None


def get_database(db_id):
    r = requests.get(f'{NOTION_API_BASE}/databases/{db_id}', headers=headers)
    r.raise_for_status()
    return r.json()


def map_csv_to_notion(csv_columns, notion_props):
    """CSVのカラム名をNotionのプロパティ名にマッチング"""
    mapping = {}

    # 想定マッピング: CSV列 -> Notion列の候補（順番にチェック）
    candidates = {
        'メニュー名': ['メニュー名', 'Name', 'タイトル'],
        'カテゴリ': ['カテゴリ'],
        '所要時間（分）': ['所要時間（分）', '希望時間（分）', '所要時間', '時間'],
        '料金（税込）': ['料金（税込）', '料金'],
        '説明': ['説明'],
        '公開': ['公開'],
    }

    for csv_col, notion_candidates in candidates.items():
        if csv_col not in csv_columns:
            continue
        for cand in notion_candidates:
            if cand in notion_props:
                mapping[csv_col] = cand
                break
        # フォールバック: 部分一致
        if csv_col not in mapping:
            for notion_col in notion_props:
                if any(c in notion_col for c in csv_col if c not in '（）'):
                    mapping[csv_col] = notion_col
                    break

    return mapping


def build_page_properties(row, notion_props, mapping):
    """CSVの1行をNotionのページプロパティに変換"""
    props = {}
    for csv_col, notion_col in mapping.items():
        value = row.get(csv_col, '').strip()
        if not value:
            continue
        prop_type = notion_props[notion_col].get('type')

        if prop_type == 'title':
            props[notion_col] = {'title': [{'text': {'content': value}}]}
        elif prop_type == 'rich_text':
            props[notion_col] = {'rich_text': [{'text': {'content': value}}]}
        elif prop_type == 'number':
            try:
                props[notion_col] = {'number': float(value)}
            except ValueError:
                pass
        elif prop_type == 'select':
            props[notion_col] = {'select': {'name': value}}
        elif prop_type == 'multi_select':
            values = [v.strip() for v in value.split(',') if v.strip()]
            props[notion_col] = {'multi_select': [{'name': v} for v in values]}
        elif prop_type == 'checkbox':
            props[notion_col] = {'checkbox': value.lower() in ['yes', 'true', '1', 'はい', 'on']}
    return props


def create_page(db_id, properties):
    payload = {
        'parent': {'database_id': db_id},
        'properties': properties,
    }
    r = requests.post(f'{NOTION_API_BASE}/pages', headers=headers, json=payload)
    if r.status_code != 200:
        return False, r.text[:300]
    return True, None


def main():
    print("=" * 55)
    print("  メニューマスタ CSVインポート")
    print("=" * 55)
    print()

    # CSV読み込み
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu_master_for_notion.csv')
    if not os.path.exists(csv_path):
        print(f"エラー: CSVファイルが見つかりません: {csv_path}")
        sys.exit(1)

    print(f"CSV: {csv_path}")
    rows = []
    with open(csv_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"  読み込み: {len(rows)} 行")
    print()

    # メニューマスタDB取得
    print("メニューマスタDBを検索中...")
    db_id = find_database('メニューマスタ')
    if not db_id:
        print("エラー: メニューマスタDBが見つかりません")
        sys.exit(1)
    print(f"  OK: {db_id}")

    # スキーマ取得
    db = get_database(db_id)
    notion_props = db.get('properties', {})
    print(f"  既存プロパティ: {list(notion_props.keys())}")
    print()

    # CSVカラム → Notionプロパティのマッピング
    csv_columns = list(rows[0].keys()) if rows else []
    mapping = map_csv_to_notion(csv_columns, notion_props)
    print("カラムマッピング:")
    for csv_c, notion_c in mapping.items():
        prop_type = notion_props[notion_c].get('type', '?')
        print(f"  CSV '{csv_c}' -> Notion '{notion_c}' ({prop_type})")
    print()

    # インポート
    print("インポート開始...")
    success_count = 0
    fail_count = 0
    for i, row in enumerate(rows, 1):
        properties = build_page_properties(row, notion_props, mapping)
        success, err = create_page(db_id, properties)
        if success:
            success_count += 1
            print(f"  [{i}/{len(rows)}] OK: {row.get('メニュー名', '?')}")
        else:
            fail_count += 1
            print(f"  [{i}/{len(rows)}] FAIL: {row.get('メニュー名', '?')}")
            print(f"    {err}")
        time.sleep(0.3)  # API rate limit対策

    print()
    print("=" * 55)
    print(f"  完了: 成功 {success_count}件 / 失敗 {fail_count}件")
    print("=" * 55)


if __name__ == '__main__':
    main()
