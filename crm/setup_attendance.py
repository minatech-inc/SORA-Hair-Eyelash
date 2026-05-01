"""
SORA Salon - 勤怠管理用Notionデータベース構築スクリプト
- スタッフマスタDB
- 勤怠記録DB
- 初期スタッフデータ（からきだ, 磯谷）
"""

import os
import sys
import time
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


def search_pages(query=''):
    r = requests.post(f'{NOTION_API_BASE}/search', headers=headers,
                      json={'query': query, 'page_size': 100})
    return r.json().get('results', [])


def find_page_by_title(title):
    for r in search_pages(title):
        if r.get('object') != 'page':
            continue
        props = r.get('properties', {})
        for k, v in props.items():
            if v.get('type') == 'title':
                text = ''.join([t.get('plain_text', '') for t in v.get('title', [])])
                if title in text:
                    return r['id']
    return None


def find_db_by_title(title):
    for r in search_pages(title):
        if r.get('object') != 'database':
            continue
        text = ''.join([t.get('plain_text', '') for t in r.get('title', [])])
        if title in text:
            return r['id']
    return None


def create_database(parent_page_id, title, icon, properties):
    payload = {
        'parent': {'type': 'page_id', 'page_id': parent_page_id},
        'icon': {'type': 'emoji', 'emoji': icon},
        'title': [{'type': 'text', 'text': {'content': title}}],
        'properties': properties,
    }
    r = requests.post(f'{NOTION_API_BASE}/databases', headers=headers, json=payload)
    if r.status_code != 200:
        print(f"  ERROR creating {title}: {r.status_code}")
        print(r.text[:500])
        return None
    return r.json()['id']


def create_page(db_id, properties):
    payload = {
        'parent': {'database_id': db_id},
        'properties': properties,
    }
    r = requests.post(f'{NOTION_API_BASE}/pages', headers=headers, json=payload)
    if r.status_code != 200:
        print(f"  Page create error: {r.status_code} {r.text[:300]}")
        return False
    return True


def build_staff_master_props():
    """スタッフマスタDBのプロパティ"""
    return {
        '名前': {'title': {}},
        'PIN': {'rich_text': {}},
        '役割': {
            'select': {
                'options': [
                    {'name': 'オーナー', 'color': 'pink'},
                    {'name': 'スタッフ', 'color': 'blue'},
                ]
            }
        },
        '時給': {'number': {'format': 'yen'}},
        '報酬体系': {
            'select': {
                'options': [
                    {'name': '時給', 'color': 'green'},
                    {'name': '完全歩合', 'color': 'orange'},
                    {'name': '固定給+歩合', 'color': 'purple'},
                ]
            }
        },
        '歩合率(%)': {'number': {'format': 'percent'}},
        '入社日': {'date': {}},
        '連絡先': {'phone_number': {}},
        'メールアドレス': {'email': {}},
        '振込先': {'rich_text': {}},
        '有効': {'checkbox': {}},
        '表示順': {'number': {'format': 'number'}},
    }


def build_attendance_props(staff_db_id):
    """勤怠記録DBのプロパティ"""
    return {
        '件名': {'title': {}},
        'スタッフ': {
            'relation': {
                'database_id': staff_db_id,
                'type': 'dual_property',
                'dual_property': {},
            }
        },
        '打刻種別': {
            'select': {
                'options': [
                    {'name': '出勤', 'color': 'green'},
                    {'name': '退勤', 'color': 'blue'},
                    {'name': '休憩開始', 'color': 'yellow'},
                    {'name': '休憩終了', 'color': 'orange'},
                ]
            }
        },
        '日時': {'date': {}},
        '日付': {
            'formula': {
                'expression': 'if(empty(prop("日時")), "", formatDate(prop("日時"), "YYYY-MM-DD"))'
            }
        },
        '月': {
            'formula': {
                'expression': 'if(empty(prop("日時")), "", formatDate(prop("日時"), "YYYY-MM"))'
            }
        },
        '備考': {'rich_text': {}},
        '作成元': {
            'select': {
                'options': [
                    {'name': 'PIN打刻', 'color': 'green'},
                    {'name': '手動入力', 'color': 'gray'},
                    {'name': '修正', 'color': 'red'},
                ]
            }
        },
    }


def main():
    print("=" * 50)
    print("  SORA Attendance DB Setup")
    print("=" * 50)
    print()

    parent_id = find_page_by_title('SORA HAIR&EYELASH')
    if not parent_id:
        print("ERROR: SORA HAIR&EYELASH page not found")
        sys.exit(1)
    print(f"Parent page: {parent_id}")
    print()

    # Step 1: スタッフマスタDB
    print("[1/3] Creating Staff Master DB...")
    staff_db_id = find_db_by_title('スタッフマスタ')
    if staff_db_id:
        print(f"  Already exists: {staff_db_id}")
    else:
        staff_db_id = create_database(
            parent_id, 'スタッフマスタ', '👤',
            build_staff_master_props()
        )
        if not staff_db_id:
            sys.exit(1)
        print(f"  OK: {staff_db_id}")
    print()

    # Step 2: 勤怠記録DB
    print("[2/3] Creating Attendance DB...")
    attendance_db_id = find_db_by_title('勤怠記録')
    if attendance_db_id:
        print(f"  Already exists: {attendance_db_id}")
    else:
        attendance_db_id = create_database(
            parent_id, '勤怠記録', '⏰',
            build_attendance_props(staff_db_id)
        )
        if not attendance_db_id:
            sys.exit(1)
        print(f"  OK: {attendance_db_id}")
    print()

    # Step 3: 初期スタッフ投入
    print("[3/3] Adding initial staff entries...")
    initial_staff = [
        {
            '名前': 'からきだ ほのか',
            'PIN': '0001',
            '役割': 'スタッフ',
            '報酬体系': '完全歩合',
            '歩合率(%)': 0.5,  # 50%
            '有効': True,
            '表示順': 1,
            'メールアドレス': 'karakida.honoka@gmail.com',
        },
        {
            '名前': '磯谷',
            'PIN': '0099',
            '役割': 'オーナー',
            '報酬体系': '固定給+歩合',
            '有効': True,
            '表示順': 99,
        },
    ]

    for s in initial_staff:
        props = {
            '名前': {'title': [{'text': {'content': s['名前']}}]},
            'PIN': {'rich_text': [{'text': {'content': s['PIN']}}]},
            '役割': {'select': {'name': s['役割']}},
            '報酬体系': {'select': {'name': s['報酬体系']}},
            '有効': {'checkbox': s['有効']},
            '表示順': {'number': s['表示順']},
        }
        if '歩合率(%)' in s:
            props['歩合率(%)'] = {'number': s['歩合率(%)']}
        if 'メールアドレス' in s:
            props['メールアドレス'] = {'email': s['メールアドレス']}
        if create_page(staff_db_id, props):
            print(f"  OK: {s['名前']}")

    print()
    print("=" * 50)
    print("  Setup Complete!")
    print("=" * 50)
    print()
    print("Database IDs:")
    print(f"  STAFF_DB_ID:      {staff_db_id}")
    print(f"  ATTENDANCE_DB_ID: {attendance_db_id}")
    print()
    print("PIN reminder:")
    print("  からきだ: 0001")
    print("  磯谷:     0099")
    print()
    print("Next: Add these IDs as Worker secrets and update Worker code")


if __name__ == '__main__':
    main()
