"""
SORA Salon - 売上ダッシュボードページを生成
施術履歴を集計してNotionのダッシュボードページを更新する。
定期実行（Cloudflare Worker Cron）で自動更新できる構成。

【実行方法】
  $env:NOTION_TOKEN = "ntn_..."
  python build_dashboard.py
"""

import os
import sys
import requests
from collections import defaultdict
from datetime import datetime, timedelta, timezone

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

# JST
JST = timezone(timedelta(hours=9))


def search_pages(query=''):
    r = requests.post(f'{NOTION_API_BASE}/search', headers=headers, json={'query': query, 'page_size': 100})
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


def query_database(db_id, filter_obj=None, page_size=100):
    """Fetch all records from a database, paginated"""
    all_results = []
    next_cursor = None
    while True:
        body = {'page_size': page_size}
        if filter_obj:
            body['filter'] = filter_obj
        if next_cursor:
            body['start_cursor'] = next_cursor
        r = requests.post(f'{NOTION_API_BASE}/databases/{db_id}/query', headers=headers, json=body)
        if r.status_code != 200:
            print(f"Query error: {r.status_code} {r.text[:200]}")
            break
        data = r.json()
        all_results.extend(data.get('results', []))
        if not data.get('has_more'):
            break
        next_cursor = data.get('next_cursor')
    return all_results


def fetch_menu_master_lookup(menu_db_id):
    """Build menu_id -> menu_name map for relation resolution"""
    pages = query_database(menu_db_id)
    lookup = {}
    for p in pages:
        title_prop = next((v for v in p.get('properties', {}).values() if v.get('type') == 'title'), {})
        name = ''.join([t.get('plain_text', '') for t in title_prop.get('title', [])])
        if name:
            lookup[p['id']] = name
    return lookup


def compute_stats(records, menu_lookup):
    """集計ロジック"""
    now = datetime.now(JST)
    this_month_str = now.strftime('%Y-%m')
    last_month = (now.replace(day=1) - timedelta(days=1))
    last_month_str = last_month.strftime('%Y-%m')
    this_year_str = now.strftime('%Y')

    sales_total = 0
    sales_this_month = 0
    sales_last_month = 0
    sales_ytd = 0
    visits_count = 0
    visits_this_month = 0

    by_staff = defaultdict(lambda: {'sales': 0, 'count': 0})
    by_menu = defaultdict(lambda: {'sales': 0, 'count': 0})
    by_month = defaultdict(int)

    for rec in records:
        props = rec.get('properties', {})
        status = (props.get('ステータス', {}).get('select') or {}).get('name', '')
        # 来店済 / 来店済み 両対応
        if '来店済' not in status:
            continue

        fee = props.get('料金', {}).get('number') or 0
        date = props.get('来店日時', {}).get('date', {})
        date_str = (date or {}).get('start', '')
        if not date_str:
            continue

        # YYYY-MM-DD or YYYY-MM-DDTHH:MM
        ym = date_str[:7]
        y = date_str[:4]

        sales_total += fee
        visits_count += 1
        by_month[ym] += fee

        if ym == this_month_str:
            sales_this_month += fee
            visits_this_month += 1
        if ym == last_month_str:
            sales_last_month += fee
        if y == this_year_str:
            sales_ytd += fee

        # スタッフ集計
        staff = (props.get('担当スタッフ', {}).get('select') or {}).get('name', '未設定')
        by_staff[staff]['sales'] += fee
        by_staff[staff]['count'] += 1

        # メニュー集計（リレーション）
        menu_relations = props.get('メニュー', {}).get('relation', [])
        for mr in menu_relations:
            menu_id = mr.get('id')
            menu_name = menu_lookup.get(menu_id, '不明メニュー')
            by_menu[menu_name]['sales'] += fee
            by_menu[menu_name]['count'] += 1

    return {
        'sales_total': sales_total,
        'sales_this_month': sales_this_month,
        'sales_last_month': sales_last_month,
        'sales_ytd': sales_ytd,
        'visits_count': visits_count,
        'visits_this_month': visits_this_month,
        'by_staff': dict(by_staff),
        'by_menu': dict(by_menu),
        'by_month': dict(by_month),
        'this_month_str': this_month_str,
        'last_month_str': last_month_str,
        'this_year_str': this_year_str,
        'avg_per_visit': sales_total // visits_count if visits_count else 0,
    }


def fmt_yen(n):
    return f"¥{n:,}"


def build_blocks(stats):
    """ダッシュボードページのブロック構成を生成"""
    now = datetime.now(JST)
    blocks = []

    # ヘッダーコールアウト
    diff = stats['sales_this_month'] - stats['sales_last_month']
    diff_str = f"前月比 {'+' if diff >= 0 else ''}{fmt_yen(diff)}" if stats['sales_last_month'] else "前月実績なし"
    blocks.append({
        'object': 'block',
        'type': 'callout',
        'callout': {
            'rich_text': [{
                'type': 'text',
                'text': {'content': f"今月の売上: {fmt_yen(stats['sales_this_month'])}    {diff_str}\n今月の来店件数: {stats['visits_this_month']}件   平均単価: {fmt_yen(stats['avg_per_visit'])}"}
            }],
            'icon': {'type': 'emoji', 'emoji': '💰'},
            'color': 'green_background',
        }
    })

    # 区切り
    blocks.append({'object': 'block', 'type': 'divider', 'divider': {}})

    # サマリーセクション
    blocks.append({
        'object': 'block',
        'type': 'heading_2',
        'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': '📊 サマリー'}}]}
    })

    summary_lines = [
        f"今月（{stats['this_month_str']}）売上: {fmt_yen(stats['sales_this_month'])}",
        f"前月（{stats['last_month_str']}）売上: {fmt_yen(stats['sales_last_month'])}",
        f"年初来累計（{stats['this_year_str']}）: {fmt_yen(stats['sales_ytd'])}",
        f"全期間累計: {fmt_yen(stats['sales_total'])}（{stats['visits_count']}件）",
    ]
    for line in summary_lines:
        blocks.append({
            'object': 'block',
            'type': 'bulleted_list_item',
            'bulleted_list_item': {
                'rich_text': [{'type': 'text', 'text': {'content': line}}]
            }
        })

    # 月別売上
    blocks.append({'object': 'block', 'type': 'divider', 'divider': {}})
    blocks.append({
        'object': 'block',
        'type': 'heading_2',
        'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': '📅 月別売上'}}]}
    })
    sorted_months = sorted(stats['by_month'].items(), reverse=True)[:12]
    for ym, amt in sorted_months:
        blocks.append({
            'object': 'block',
            'type': 'bulleted_list_item',
            'bulleted_list_item': {
                'rich_text': [{'type': 'text', 'text': {'content': f"{ym}: {fmt_yen(amt)}"}}]
            }
        })

    # スタッフ別
    blocks.append({'object': 'block', 'type': 'divider', 'divider': {}})
    blocks.append({
        'object': 'block',
        'type': 'heading_2',
        'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': '👥 スタッフ別売上'}}]}
    })
    sorted_staff = sorted(stats['by_staff'].items(), key=lambda x: x[1]['sales'], reverse=True)
    for staff, data in sorted_staff:
        blocks.append({
            'object': 'block',
            'type': 'bulleted_list_item',
            'bulleted_list_item': {
                'rich_text': [{'type': 'text', 'text': {'content': f"{staff}: {fmt_yen(data['sales'])}（{data['count']}件）"}}]
            }
        })

    # メニュー別ランキング
    blocks.append({'object': 'block', 'type': 'divider', 'divider': {}})
    blocks.append({
        'object': 'block',
        'type': 'heading_2',
        'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': '🌿 人気メニューランキング（売上順）'}}]}
    })
    sorted_menu = sorted(stats['by_menu'].items(), key=lambda x: x[1]['sales'], reverse=True)[:10]
    for i, (menu, data) in enumerate(sorted_menu, 1):
        blocks.append({
            'object': 'block',
            'type': 'numbered_list_item',
            'numbered_list_item': {
                'rich_text': [{'type': 'text', 'text': {'content': f"{menu}: {fmt_yen(data['sales'])}（{data['count']}件）"}}]
            }
        })

    # 最終更新
    blocks.append({'object': 'block', 'type': 'divider', 'divider': {}})
    blocks.append({
        'object': 'block',
        'type': 'paragraph',
        'paragraph': {
            'rich_text': [{
                'type': 'text',
                'text': {'content': f"最終更新: {now.strftime('%Y-%m-%d %H:%M')} JST    自動生成（再実行で最新化）"},
                'annotations': {'italic': True, 'color': 'gray'}
            }]
        }
    })

    return blocks


def get_or_create_dashboard_page(parent_page_id):
    """ダッシュボードページが既存ならそれを取得、なければ新規作成"""
    existing = find_page_by_title('売上ダッシュボード')
    if existing:
        print(f"  Existing dashboard page: {existing}")
        return existing

    # 新規作成
    payload = {
        'parent': {'type': 'page_id', 'page_id': parent_page_id},
        'icon': {'type': 'emoji', 'emoji': '📊'},
        'properties': {
            'title': {'title': [{'text': {'content': '売上ダッシュボード'}}]}
        }
    }
    r = requests.post(f'{NOTION_API_BASE}/pages', headers=headers, json=payload)
    if r.status_code != 200:
        print(f"Create error: {r.status_code} {r.text[:300]}")
        sys.exit(1)
    page_id = r.json()['id']
    print(f"  Created new dashboard page: {page_id}")
    return page_id


def replace_page_content(page_id, blocks):
    """既存のページコンテンツを削除して、新しいブロックで置き換え"""
    # 既存ブロック取得
    r = requests.get(f'{NOTION_API_BASE}/blocks/{page_id}/children?page_size=100', headers=headers)
    existing_blocks = r.json().get('results', [])

    # 既存削除
    for b in existing_blocks:
        bid = b.get('id')
        requests.delete(f'{NOTION_API_BASE}/blocks/{bid}', headers=headers)

    # 新規ブロックは100件ずつ追加
    for i in range(0, len(blocks), 100):
        chunk = blocks[i:i+100]
        r = requests.patch(
            f'{NOTION_API_BASE}/blocks/{page_id}/children',
            headers=headers,
            json={'children': chunk}
        )
        if r.status_code != 200:
            print(f"Append error: {r.status_code} {r.text[:300]}")
            sys.exit(1)


def main():
    print("=" * 50)
    print("  Sales Dashboard Builder")
    print("=" * 50)
    print()

    # 親ページとDBを取得
    parent_id = find_page_by_title('SORA HAIR&EYELASH')
    if not parent_id:
        print("ERROR: SORA HAIR&EYELASH page not found")
        sys.exit(1)
    print(f"Parent page: {parent_id}")

    treatment_db = find_db_by_title('施術履歴')
    menu_db = find_db_by_title('メニューマスタ')
    if not treatment_db or not menu_db:
        print("ERROR: Required databases not found")
        sys.exit(1)
    print(f"Treatment DB: {treatment_db}")
    print(f"Menu DB: {menu_db}")
    print()

    # データ取得・集計
    print("Fetching data...")
    menu_lookup = fetch_menu_master_lookup(menu_db)
    print(f"  Menu master: {len(menu_lookup)} items")

    records = query_database(treatment_db)
    print(f"  Treatment records: {len(records)}")
    print()

    print("Computing stats...")
    stats = compute_stats(records, menu_lookup)
    print(f"  This month: JPY {stats['sales_this_month']:,}")
    print(f"  Last month: JPY {stats['sales_last_month']:,}")
    print(f"  YTD: JPY {stats['sales_ytd']:,}")
    print(f"  Total visits: {stats['visits_count']}")
    print()

    # ページ作成・更新
    print("Updating dashboard page...")
    page_id = get_or_create_dashboard_page(parent_id)
    blocks = build_blocks(stats)
    replace_page_content(page_id, blocks)
    print(f"  OK: Updated {len(blocks)} blocks")
    print()
    print(f"Dashboard URL: https://notion.so/{page_id.replace('-', '')}")


if __name__ == '__main__':
    main()
