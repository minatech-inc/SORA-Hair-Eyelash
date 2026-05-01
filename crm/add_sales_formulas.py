"""
SORA Salon - 施術履歴に売上集計用フォーミュラを追加
日別・月別・年別の集計が容易になるように、日付フォーミュラを追加する
"""

import os
import sys
import requests

NOTION_API_BASE = 'https://api.notion.com/v1'
NOTION_VERSION = '2022-06-28'

token = os.environ.get('NOTION_TOKEN')
if not token:
    print("ERROR: NOTION_TOKEN env var not set")
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
    db_id = find_db('施術履歴')
    if not db_id:
        print("ERROR: 施術履歴 not found")
        sys.exit(1)
    print(f"Treatment History DB: {db_id}")

    formulas = {
        '売上日': {
            'formula': {
                'expression': 'if(empty(prop("来店日時")), "", formatDate(prop("来店日時"), "YYYY-MM-DD"))'
            }
        },
        '売上月': {
            'formula': {
                'expression': 'if(empty(prop("来店日時")), "", formatDate(prop("来店日時"), "YYYY-MM"))'
            }
        },
        '売上年': {
            'formula': {
                'expression': 'if(empty(prop("来店日時")), "", formatDate(prop("来店日時"), "YYYY"))'
            }
        },
        '曜日': {
            'formula': {
                'expression': 'if(empty(prop("来店日時")), "", if(day(prop("来店日時")) == 0, "日", if(day(prop("来店日時")) == 1, "月", if(day(prop("来店日時")) == 2, "火", if(day(prop("来店日時")) == 3, "水", if(day(prop("来店日時")) == 4, "木", if(day(prop("来店日時")) == 5, "金", "土")))))))'
            }
        },
        '時間帯': {
            'formula': {
                'expression': 'if(empty(prop("来店日時")), "", if(hour(prop("来店日時")) < 12, "午前", if(hour(prop("来店日時")) < 17, "午後", "夕方")))'
            }
        },
        '実売上': {
            'formula': {
                'expression': 'if(prop("ステータス") == "来店済", prop("料金"), 0)',
                # Returns 料金 if status is 来店済, otherwise 0 (excludes cancelled/no-show from sales)
            }
        },
    }

    print("Adding formulas...")
    r = requests.patch(
        f'{NOTION_API_BASE}/databases/{db_id}',
        headers=headers,
        json={'properties': formulas}
    )

    if r.status_code == 200:
        print("OK: Added 6 formula columns")
        print("  - 売上日 (YYYY-MM-DD)")
        print("  - 売上月 (YYYY-MM)")
        print("  - 売上年 (YYYY)")
        print("  - 曜日 (Sun-Sat)")
        print("  - 時間帯 (morning/afternoon/evening)")
        print("  - 実売上 (only counts 来店済 records)")
    else:
        print(f"ERROR: {r.status_code}")
        print(r.text[:500])


if __name__ == '__main__':
    main()
