"""
SORA Salon - Notion 自動セットアップスクリプト
施術履歴の修復 + 顧客カルテDBの作成 + リレーション・ロールアップ設定を全自動で行う

【前提】
1. SORA Salon Connector が SORA HAIR&EYELASH ページに接続されている
2. メニューマスタDBが既に存在し、データが入っている
3. NOTION_TOKEN 環境変数にトークンが設定されている

【実行方法】(PowerShell)
  $env:NOTION_TOKEN = "ntn_xxxxxxxxxxxxxxxxxx"
  cd C:\\Users\\MinaTech株式会社\\MinaTech-Eyelash\\crm
  python setup_notion.py
"""

import os
import sys
import time
from typing import Optional

try:
    import requests
except ImportError:
    print("requests ライブラリをインストールします...")
    os.system(f'"{sys.executable}" -m pip install requests')
    import requests

NOTION_API_BASE = 'https://api.notion.com/v1'
NOTION_VERSION = '2022-06-28'


class NotionAPI:
    def __init__(self):
        token = os.environ.get('NOTION_TOKEN')
        if not token:
            print("エラー: NOTION_TOKEN 環境変数が設定されていません")
            print("\nPowerShellで以下を実行してから再度試してください:")
            print('  $env:NOTION_TOKEN = "ntn_your_token_here"')
            print('  python setup_notion.py')
            sys.exit(1)
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_VERSION,
        }

    def search(self, query='', filter_type=None):
        payload = {'query': query, 'page_size': 100}
        if filter_type:
            payload['filter'] = {'property': 'object', 'value': filter_type}
        r = requests.post(f'{NOTION_API_BASE}/search', headers=self.headers, json=payload)
        r.raise_for_status()
        return r.json().get('results', [])

    def find_page_by_title(self, title):
        for r in self.search(title, 'page'):
            props = r.get('properties', {})
            for k, v in props.items():
                if v.get('type') == 'title':
                    text = ''.join([t.get('plain_text', '') for t in v.get('title', [])])
                    if title in text:
                        return r['id']
        return None

    def find_database_by_title(self, title):
        for r in self.search(title, 'database'):
            text = ''.join([t.get('plain_text', '') for t in r.get('title', [])])
            if title in text:
                return r['id']
        return None

    def get_database(self, db_id):
        r = requests.get(f'{NOTION_API_BASE}/databases/{db_id}', headers=self.headers)
        r.raise_for_status()
        return r.json()

    def create_database(self, parent_page_id, title, icon, properties):
        payload = {
            'parent': {'type': 'page_id', 'page_id': parent_page_id},
            'icon': {'type': 'emoji', 'emoji': icon},
            'title': [{'type': 'text', 'text': {'content': title}}],
            'properties': properties,
        }
        r = requests.post(f'{NOTION_API_BASE}/databases', headers=self.headers, json=payload)
        if r.status_code != 200:
            print(f"  作成エラー ({title}): {r.status_code}")
            print(f"  詳細: {r.text[:500]}")
            return None
        return r.json()['id']

    def update_database(self, db_id, properties=None):
        payload = {}
        if properties is not None:
            payload['properties'] = properties
        r = requests.patch(f'{NOTION_API_BASE}/databases/{db_id}', headers=self.headers, json=payload)
        if r.status_code != 200:
            print(f"  更新エラー: {r.status_code}")
            print(f"  詳細: {r.text[:500]}")
            return False
        return True


# =========================================================
# Property Schemas
# =========================================================

def staff_select_options():
    return {
        'select': {
            'options': [
                {'name': 'からきだ', 'color': 'pink'},
                {'name': '磯谷', 'color': 'blue'},
                {'name': 'その他', 'color': 'default'},
            ]
        }
    }


def menu_relation(menu_master_id):
    return {
        'relation': {
            'database_id': menu_master_id,
            'type': 'dual_property',
            'dual_property': {},
        }
    }


def treatment_relation(treatment_history_id):
    return {
        'relation': {
            'database_id': treatment_history_id,
            'type': 'dual_property',
            'dual_property': {},
        }
    }


def build_treatment_properties(menu_master_id):
    """施術履歴DBの全プロパティ"""
    return {
        '件名': {'title': {}},
        '来店日時': {'date': {}},
        '担当スタッフ': staff_select_options(),
        'ステータス': {
            'select': {
                'options': [
                    {'name': '予約済', 'color': 'yellow'},
                    {'name': '来店済', 'color': 'green'},
                    {'name': 'キャンセル', 'color': 'gray'},
                    {'name': 'ノーショー', 'color': 'red'},
                ]
            }
        },
        '料金': {'number': {'format': 'yen'}},
        '支払方法': {
            'select': {
                'options': [
                    {'name': '現金', 'color': 'default'},
                    {'name': 'クレジット', 'color': 'blue'},
                    {'name': '電子マネー', 'color': 'purple'},
                    {'name': 'Squareリンク', 'color': 'orange'},
                ]
            }
        },
        'メニュー': menu_relation(menu_master_id),
        'Before写真': {'files': {}},
        'After写真': {'files': {}},
        '詳細メモ': {'rich_text': {}},
        '次回提案': {'rich_text': {}},
        'Square予約ID': {'rich_text': {}},
        '作成元': {
            'select': {
                'options': [
                    {'name': 'Square自動', 'color': 'blue'},
                    {'name': '手動入力', 'color': 'default'},
                ]
            }
        },
    }


def build_customer_basic_properties(treatment_history_id):
    """顧客カルテDB（基本プロパティのみ。ロールアップは後で追加）"""
    return {
        'お名前': {'title': {}},
        'フリガナ': {'rich_text': {}},
        '電話番号': {'phone_number': {}},
        'メールアドレス': {'email': {}},
        '生年月日': {'date': {}},
        '性別': {
            'select': {
                'options': [
                    {'name': '女性', 'color': 'pink'},
                    {'name': '男性', 'color': 'blue'},
                    {'name': 'その他', 'color': 'default'},
                ]
            }
        },
        '初来店日': {'date': {}},
        '担当スタッフ': staff_select_options(),
        'タグ': {
            'multi_select': {
                'options': [
                    {'name': '花粉症', 'color': 'red'},
                    {'name': 'コンタクト', 'color': 'yellow'},
                    {'name': '敏感肌', 'color': 'pink'},
                    {'name': 'アレルギー', 'color': 'red'},
                    {'name': '常連', 'color': 'green'},
                    {'name': 'VIP', 'color': 'purple'},
                    {'name': '紹介', 'color': 'blue'},
                ]
            }
        },
        '健康状態・アレルギー': {'rich_text': {}},
        'お好み・要望': {'rich_text': {}},
        'スタッフメモ': {'rich_text': {}},
        'LINE登録': {'checkbox': {}},
        '同意書受理': {'checkbox': {}},
        '撮影同意': {
            'multi_select': {
                'options': [
                    {'name': 'Instagram', 'color': 'purple'},
                    {'name': 'Web', 'color': 'blue'},
                    {'name': 'LINE', 'color': 'green'},
                    {'name': '印刷物', 'color': 'orange'},
                    {'name': '不可', 'color': 'gray'},
                ]
            }
        },
        '流入元': {
            'select': {
                'options': [
                    {'name': 'Web予約', 'color': 'blue'},
                    {'name': '紹介', 'color': 'pink'},
                    {'name': 'Instagram', 'color': 'purple'},
                    {'name': 'Google', 'color': 'green'},
                    {'name': 'ホットペッパー', 'color': 'red'},
                    {'name': '飛び込み', 'color': 'gray'},
                ]
            }
        },
        'ステータス': {
            'select': {
                'options': [
                    {'name': 'アクティブ', 'color': 'green'},
                    {'name': '休眠', 'color': 'yellow'},
                    {'name': '離反', 'color': 'gray'},
                ]
            }
        },
        '施術履歴': treatment_relation(treatment_history_id),
    }


def build_customer_rollup_properties():
    """顧客カルテのロールアップ（リレーション存在後に追加）"""
    return {
        '来店回数': {
            'rollup': {
                'relation_property_name': '施術履歴',
                'rollup_property_name': '件名',
                'function': 'count',
            }
        },
        '最終来店日': {
            'rollup': {
                'relation_property_name': '施術履歴',
                'rollup_property_name': '来店日時',
                'function': 'latest_date',
            }
        },
        '累計売上': {
            'rollup': {
                'relation_property_name': '施術履歴',
                'rollup_property_name': '料金',
                'function': 'sum',
            }
        },
    }


# =========================================================
# Main flow
# =========================================================

def fix_treatment_history(api, treatment_id, menu_master_id):
    """既存の施術履歴DBの壊れたリレーションを修復"""
    db = api.get_database(treatment_id)
    current_props = db.get('properties', {})

    # 壊れたリレーションプロパティを特定して削除
    props_to_remove = {}
    for prop_name, prop_data in current_props.items():
        if prop_data.get('type') == 'relation':
            relation_data = prop_data.get('relation', {})
            target_db = relation_data.get('database_id', '').replace('-', '')
            menu_id_clean = menu_master_id.replace('-', '')
            if target_db != menu_id_clean:
                # メニューマスタを指していないリレーションは削除
                props_to_remove[prop_name] = None
                print(f"    削除予定: {prop_name} (壊れたリレーション)")
        elif prop_data.get('type') == 'rollup':
            # 関連するロールアップも一旦削除（後で再作成）
            props_to_remove[prop_name] = None

    # 不要なプロパティを削除
    if props_to_remove:
        print(f"  壊れたプロパティを削除中...")
        api.update_database(treatment_id, properties=props_to_remove)
        time.sleep(1)

    # メニューリレーションを追加
    print(f"  メニューリレーションを追加中...")
    update_props = {
        'メニュー': menu_relation(menu_master_id)
    }
    success = api.update_database(treatment_id, properties=update_props)
    if not success:
        print("  リレーション追加に失敗しました")
        return False

    return True


def main():
    print("=" * 55)
    print("  SORA Salon - Notion 自動セットアップ")
    print("=" * 55)
    print()

    api = NotionAPI()

    # Step 1: API認証確認
    print("[1/4] API認証を確認中...")
    try:
        api.search('')
        print("  OK: 認証成功")
    except Exception as e:
        print(f"  エラー: {e}")
        sys.exit(1)
    print()

    # Step 2: 既存DBの検索
    print("[2/4] 既存ページ・DBを検索中...")
    parent_id = api.find_page_by_title('SORA HAIR&EYELASH')
    menu_id = api.find_database_by_title('メニューマスタ')
    treatment_id = api.find_database_by_title('施術履歴')
    customer_id = api.find_database_by_title('顧客カルテ')

    print(f"  SORA HAIR&EYELASH: {'OK' if parent_id else 'NOT FOUND'}")
    print(f"  メニューマスタ:    {'OK' if menu_id else 'NOT FOUND'}")
    print(f"  施術履歴:          {'OK (修復対象)' if treatment_id else 'NOT FOUND (新規作成)'}")
    print(f"  顧客カルテ:        {'OK (スキップ)' if customer_id else 'NOT FOUND (新規作成)'}")
    print()

    if not parent_id:
        print("エラー: SORA HAIR&EYELASH ページが見つかりません")
        print("\n対処法:")
        print("1. NotionでSORA HAIR&EYELASHページを開く")
        print("2. 右上の「⋯」メニュー → Connections → SORA Salon Connector を追加")
        print("3. このスクリプトを再実行")
        sys.exit(1)

    if not menu_id:
        print("エラー: メニューマスタDBが見つかりません")
        print("親ページにコネクトを追加すれば子DBにもアクセスできます")
        sys.exit(1)

    # Step 3: 施術履歴の修復 or 作成
    print("[3/4] 施術履歴DBをセットアップ中...")
    if treatment_id:
        if not fix_treatment_history(api, treatment_id, menu_id):
            print("  既存の施術履歴の修復に失敗しました")
            print("  Notionで施術履歴をアーカイブしてからこのスクリプトを再実行してください")
            sys.exit(1)
        print("  OK: 既存DBを修復しました")
    else:
        print("  新規DBを作成中...")
        treatment_id = api.create_database(
            parent_id, '施術履歴', '📸',
            build_treatment_properties(menu_id)
        )
        if not treatment_id:
            sys.exit(1)
        print("  OK: 施術履歴DBを作成しました")
    print(f"  施術履歴 ID: {treatment_id}")
    print()

    # Step 4: 顧客カルテの作成
    print("[4/4] 顧客カルテDBをセットアップ中...")
    if customer_id:
        print("  既に顧客カルテDBが存在するためスキップします")
        print("  (再作成するにはNotionでアーカイブしてから再実行)")
    else:
        print("  新規DBを作成中（基本プロパティ）...")
        customer_id = api.create_database(
            parent_id, '顧客カルテ', '👥',
            build_customer_basic_properties(treatment_id)
        )
        if not customer_id:
            sys.exit(1)
        print(f"  OK: 顧客カルテDBを作成しました ({customer_id})")

        time.sleep(2)
        print("  ロールアップを追加中...")
        success = api.update_database(customer_id, properties=build_customer_rollup_properties())
        if success:
            print("  OK: ロールアップ（来店回数・最終来店日・累計売上）を追加")
        else:
            print("  ロールアップ追加に失敗。Notionで手動追加が必要です")
    print()

    # 完了
    print("=" * 55)
    print("  セットアップ完了!")
    print("=" * 55)
    print()
    print("作成されたDB:")
    print(f"  メニューマスタ: https://notion.so/{menu_id.replace('-', '')}")
    print(f"  施術履歴:       https://notion.so/{treatment_id.replace('-', '')}")
    print(f"  顧客カルテ:     https://notion.so/{customer_id.replace('-', '')}")
    print()
    print("次のステップ:")
    print("  1. Notionで顧客カルテを開いてテスト顧客を1件追加")
    print("  2. 施術履歴に来店記録を1件追加（顧客と紐付け）")
    print("  3. 顧客カルテに「来店回数」「最終来店日」「累計売上」が反映されることを確認")
    print()


if __name__ == '__main__':
    main()
