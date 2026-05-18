/**
 * SORA Dashboard - メインアプリケーション
 */
(function () {
    'use strict';

    let currentPage = 'home';
    const _cache = {};

    // ============================================
    // Initialization
    // ============================================
    function init() {
        if (!AUTH.isAuthenticated()) {
            showLogin();
            return;
        }
        showDashboard();
        bindNav();
        bindRefresh();
        bindLogout();
        loadPage('home');
    }

    function showLogin() {
        document.getElementById('login-screen').style.display = 'flex';
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const form = document.getElementById('login-form');
        const errEl = document.getElementById('login-error');
        const btn = form.querySelector('button');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errEl.textContent = '';
            btn.disabled = true;
            btn.textContent = 'ログイン中...';
            try {
                await AUTH.login(document.getElementById('password').value);
                location.reload();
            } catch (err) {
                errEl.textContent = err.message || 'ログインに失敗しました';
                btn.disabled = false;
                btn.textContent = 'ログイン';
            }
        });
    }

    function showDashboard() {
        document.getElementById('login-screen').style.display = 'none';
    }

    // ============================================
    // Navigation
    // ============================================
    function bindNav() {
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.getAttribute('data-page');
                if (page) navigateTo(page);
            });
        });
    }

    function navigateTo(page) {
        currentPage = page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const el = document.getElementById(`page-${page}`);
        if (el) el.style.display = 'block';

        const titles = { home: 'ホーム', sales: '売上', staff: 'スタッフ', menu: 'メニュー', attendance: '勤怠管理', invoices: '請求書', customers: '顧客カルテ', qr: 'QRコード' };
        document.getElementById('page-title').textContent = titles[page] || page;
        loadPage(page);
    }

    function bindRefresh() {
        document.getElementById('btn-refresh').addEventListener('click', () => {
            for (const k in _cache) delete _cache[k];
            loadPage(currentPage);
        });
    }

    function bindLogout() {
        document.getElementById('btn-logout').addEventListener('click', () => {
            AUTH.logout();
        });
    }

    // ============================================
    // Page loaders
    // ============================================
    async function loadPage(page) {
        showLoading(true);
        try {
            switch (page) {
                case 'home': await loadHome(); break;
                case 'sales': await loadSales(); break;
                case 'staff': await loadStaff(); break;
                case 'menu': await loadMenu(); break;
                case 'attendance': await loadAttendance(); break;
                case 'invoices': await loadInvoices(); break;
                case 'customers': await loadCustomers(); break;
                case 'qr': await loadQR(); break;
                case 'settings': await loadSettings(); break;
            }
            updateLastUpdated();
        } catch (err) {
            console.error('Load error:', err);
            alert('データ取得エラー: ' + err.message);
        } finally {
            showLoading(false);
        }
    }

    async function getCached(key, fetcher) {
        if (!_cache[key]) {
            _cache[key] = await fetcher();
        }
        return _cache[key];
    }

    async function loadHome() {
        const [summary, sales, recent] = await Promise.all([
            getCached('summary', () => API.summary()),
            getCached('sales', () => API.sales()),
            getCached('recent', () => API.recent())
        ]);

        // KPIs
        document.getElementById('kpi-this-month').textContent = FORMAT.yen(summary.thisMonth.sales);
        document.getElementById('kpi-this-visits').textContent = `${summary.thisMonth.visits}件`;
        document.getElementById('kpi-this-avg').textContent = `平均単価 ${FORMAT.yen(summary.thisMonth.avgPerVisit)}`;
        document.getElementById('kpi-ytd').textContent = FORMAT.yen(summary.ytd.sales);
        document.getElementById('kpi-customers').textContent = `${summary.customerCount}人`;

        const diffEl = document.getElementById('kpi-diff');
        if (summary.diffPercent != null) {
            const diffYen = FORMAT.yen(Math.abs(summary.diff));
            const sign = summary.diff >= 0 ? '↑' : '↓';
            diffEl.textContent = `前月比 ${sign} ${diffYen}（${FORMAT.pct(summary.diffPercent)}）`;
            diffEl.className = 'kpi-diff ' + (summary.diff >= 0 ? 'up' : 'down');
        } else {
            diffEl.textContent = '前月実績なし';
            diffEl.className = 'kpi-diff';
        }

        // Monthly chart
        makeLineChart(
            'chart-monthly',
            sales.monthSeries.map(d => FORMAT.monthLabel(d.month)),
            sales.monthSeries.map(d => d.sales),
            '月別売上'
        );

        // Daily chart (本月だけ)
        const thisMonth = sales.daySeries.filter(d => d.day.startsWith(summary.thisMonth.sales !== undefined ? new Date().toISOString().slice(0, 7) : ''));
        const dayData = thisMonth.length ? thisMonth : sales.daySeries;
        makeBarChart(
            'chart-daily',
            dayData.map(d => FORMAT.date(d.day)),
            dayData.map(d => d.sales),
            '日別売上'
        );

        // Recent table
        const tbody = document.querySelector('#recent-table tbody');
        tbody.innerHTML = recent.recent.map(r => `
            <tr>
                <td data-label="日時">${FORMAT.dateLong(r.date)}</td>
                <td data-label="件名">${escapeHtml(r.title)}</td>
                <td data-label="担当">${escapeHtml(r.staff || '-')}</td>
                <td data-label="メニュー">${escapeHtml(r.menu || '-')}</td>
                <td data-label="料金" class="num">${FORMAT.yen(r.fee)}</td>
                <td data-label="状態"><span class="tag">${escapeHtml(r.status || '-')}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="6" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    async function loadSales() {
        const sales = await getCached('sales', () => API.sales());
        makeBarChart(
            'sales-monthly',
            sales.monthSeries.map(d => FORMAT.monthLabel(d.month)),
            sales.monthSeries.map(d => d.sales),
            '月別売上'
        );
        makeLineChart(
            'sales-daily',
            sales.daySeries.map(d => FORMAT.date(d.day)),
            sales.daySeries.map(d => d.sales),
            '日別売上'
        );
    }

    async function loadStaff() {
        const data = await getCached('staff', () => API.staff());
        const labels = data.staff.map(s => s.name);
        const sales = data.staff.map(s => s.sales);
        const counts = data.staff.map(s => s.count);

        makeHorizontalBarChart('staff-bar', labels, sales, 'スタッフ別売上');
        makePieChart('staff-pie', labels, counts, 'スタッフ別件数');

        const tbody = document.querySelector('#staff-table tbody');
        tbody.innerHTML = data.staff.map((s, i) => `
            <tr>
                <td data-label="順位">${i + 1}</td>
                <td data-label="スタッフ">${escapeHtml(s.name)}</td>
                <td data-label="売上" class="num">${FORMAT.yen(s.sales)}</td>
                <td data-label="件数" class="num">${s.count}</td>
                <td data-label="平均単価" class="num">${FORMAT.yen(s.count ? Math.floor(s.sales / s.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    async function loadMenu() {
        const data = await getCached('menu', () => API.menu());
        const top10 = data.menu.slice(0, 10);
        const labels = top10.map(m => m.name);
        const sales = top10.map(m => m.sales);
        const counts = top10.map(m => m.count);

        makeHorizontalBarChart('menu-bar', labels, sales, 'メニュー別売上');
        makePieChart('menu-pie', labels, counts, 'メニュー別件数');

        const tbody = document.querySelector('#menu-table tbody');
        tbody.innerHTML = data.menu.map((m, i) => `
            <tr>
                <td data-label="順位">${i + 1}</td>
                <td data-label="メニュー">${escapeHtml(m.name)}</td>
                <td data-label="売上" class="num">${FORMAT.yen(m.sales)}</td>
                <td data-label="件数" class="num">${m.count}</td>
                <td data-label="平均単価" class="num">${FORMAT.yen(m.count ? Math.floor(m.sales / m.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
    }

    // ============================================
    // Attendance
    // ============================================
    let _selectedStaff = null;

    async function loadAttendance() {
        // 打刻ウィジェットの初期化
        await renderStaffList();
        await renderTodayPunches();
        await renderMonthlySummary();
        bindPunchHandlers();
    }

    async function renderStaffList() {
        const data = await API.staffList();
        const container = document.getElementById('staff-buttons');
        if (!data.staff || data.staff.length === 0) {
            container.innerHTML = '<div class="loading-text">スタッフが登録されていません</div>';
            return;
        }
        container.innerHTML = data.staff.map(s => `
            <button class="staff-button" data-staff-id="${s.id}" data-staff-name="${escapeHtml(s.name)}">
                <div class="staff-button-name">${escapeHtml(s.name)}</div>
                <div class="staff-button-role">${escapeHtml(s.role || '')}</div>
            </button>
        `).join('');
    }

    function bindPunchHandlers() {
        // スタッフ選択
        document.getElementById('staff-buttons').addEventListener('click', (e) => {
            const btn = e.target.closest('.staff-button');
            if (!btn) return;
            _selectedStaff = {
                id: btn.dataset.staffId,
                name: btn.dataset.staffName,
            };
            document.getElementById('selected-staff-name').textContent = _selectedStaff.name;
            document.getElementById('punch-step-staff').style.display = 'none';
            document.getElementById('punch-step-pin').style.display = 'block';
            document.getElementById('pin-input').value = '';
            document.getElementById('punch-error').textContent = '';
            setTimeout(() => document.getElementById('pin-input').focus(), 100);
        });

        // 戻るボタン
        document.getElementById('punch-back').addEventListener('click', () => {
            document.getElementById('punch-step-pin').style.display = 'none';
            document.getElementById('punch-step-staff').style.display = 'block';
        });

        // 打刻ボタン
        document.querySelectorAll('.punch-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const type = btn.dataset.type;
                const pin = document.getElementById('pin-input').value;
                const errEl = document.getElementById('punch-error');
                errEl.textContent = '';
                if (!_selectedStaff) {
                    errEl.textContent = 'スタッフを選択してください';
                    return;
                }
                if (!pin || pin.length !== 4) {
                    errEl.textContent = 'PIN (4桁) を入力してください';
                    return;
                }
                document.querySelectorAll('.punch-btn').forEach(b => b.disabled = true);
                try {
                    const r = await API.punch(_selectedStaff.id, pin, type);
                    showPunchSuccess(`${r.staff} さんの【${r.type}】を記録しました`);
                    // 履歴・サマリー更新
                    await renderTodayPunches();
                    await renderMonthlySummary();
                } catch (err) {
                    errEl.textContent = err.message;
                } finally {
                    document.querySelectorAll('.punch-btn').forEach(b => b.disabled = false);
                }
            });
        });

        // 続けて打刻
        document.getElementById('punch-restart').addEventListener('click', () => {
            _selectedStaff = null;
            document.getElementById('punch-step-done').style.display = 'none';
            document.getElementById('punch-step-staff').style.display = 'block';
        });
    }

    function showPunchSuccess(msg) {
        document.getElementById('punch-success-msg').textContent = msg;
        document.getElementById('punch-step-pin').style.display = 'none';
        document.getElementById('punch-step-done').style.display = 'block';
    }

    async function renderTodayPunches() {
        const data = await API.attendanceToday();
        const tbody = document.querySelector('#attendance-today-table tbody');
        if (!data.today || data.today.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">本日の打刻なし</td></tr>';
            return;
        }
        tbody.innerHTML = data.today.map(p => {
            const time = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '-';
            return `
                <tr>
                    <td data-label="時刻">${time}</td>
                    <td data-label="スタッフ">${escapeHtml(p.staffName)}</td>
                    <td data-label="種別"><span class="tag">${escapeHtml(p.type)}</span></td>
                    <td data-label="備考">${escapeHtml(p.memo || '-')}</td>
                </tr>
            `;
        }).join('');
    }

    async function renderMonthlySummary() {
        const data = await API.attendanceSummary();
        document.getElementById('attendance-month').textContent = (data.month || '').replace('-', '/');
        const tbody = document.querySelector('#attendance-summary-table tbody');
        if (!data.summary || data.summary.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">今月の勤務記録なし</td></tr>';
            return;
        }
        tbody.innerHTML = data.summary.map(s => {
            const h = Math.floor(s.totalMinutes / 60);
            const m = s.totalMinutes % 60;
            const wage = s.estimatedWage != null ? FORMAT.yen(s.estimatedWage) : '-';
            return `
                <tr>
                    <td data-label="スタッフ">${escapeHtml(s.name)}</td>
                    <td data-label="出勤日数" class="num">${s.workDays}日</td>
                    <td data-label="勤務時間" class="num">${h}h ${m}m</td>
                    <td data-label="概算給与" class="num">${wage}</td>
                </tr>
            `;
        }).join('');
    }

    // ============================================
    // QR Page
    // ============================================
    let _qrRendered = false;
    async function loadQR() {
        const target = document.getElementById('qrcode-dashboard');
        if (!target) return;
        if (!_qrRendered) {
            target.innerHTML = '';
            if (typeof QRCode === 'undefined') {
                target.innerHTML = '<div style="color:#b85c4e;padding:2rem;">QRライブラリ読み込み失敗</div>';
                return;
            }
            try {
                new QRCode(target, {
                    text: 'https://minatech-inc.github.io/SORA-Hair-Eyelash/counseling.html',
                    width: 260,
                    height: 260,
                    colorDark: '#6b5641',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                _qrRendered = true;
            } catch (e) {
                target.innerHTML = '<div style="color:#b85c4e;padding:2rem;">QR生成エラー: ' + e.message + '</div>';
                return;
            }

            document.getElementById('qr-print-btn').addEventListener('click', () => {
                window.open('https://minatech-inc.github.io/SORA-Hair-Eyelash/qr-counseling.html', '_blank');
            });
            document.getElementById('qr-download-btn').addEventListener('click', () => {
                const img = target.querySelector('img');
                if (img) {
                    const a = document.createElement('a');
                    a.download = 'SORA-counseling-qr.png';
                    a.href = img.src;
                    a.click();
                    return;
                }
                const canvas = target.querySelector('canvas');
                if (canvas) {
                    const a = document.createElement('a');
                    a.download = 'SORA-counseling-qr.png';
                    a.href = canvas.toDataURL('image/png');
                    a.click();
                }
            });
        }
    }

    // ============================================
    // Settings: Staff management
    // ============================================
    async function loadSettings() {
        bindStaffAdminHandlers();
        const container = document.getElementById('staff-admin-list');
        container.innerHTML = '<div class="loading-text">読み込み中...</div>';
        try {
            const data = await API.staffAdminList();
            _staffAdminCache = data.staff || [];
            renderStaffAdminList(_staffAdminCache);
        } catch (e) {
            const detail = e.detail ? `<div style="font-size:0.78rem;margin-top:0.5rem;color:var(--gray-500);">${escapeHtml(e.detail)}</div>` : '';
            container.innerHTML = `<div style="color:#b85c4e;padding:1rem;">エラー: ${escapeHtml(e.message)}${detail}</div>`;
        }
    }

    function bindStaffAdminHandlers() {
        if (window._staffAdminBound) return;
        window._staffAdminBound = true;
        document.getElementById('btn-new-staff').addEventListener('click', () => openStaffEdit(null));
        document.getElementById('staff-modal-backdrop').addEventListener('click', closeStaffModal);
        document.getElementById('staff-modal-close').addEventListener('click', closeStaffModal);
    }

    function closeStaffModal() {
        document.getElementById('staff-modal').style.display = 'none';
    }

    function renderStaffAdminList(staffList) {
        const container = document.getElementById('staff-admin-list');
        if (staffList.length === 0) {
            container.innerHTML = '<div class="loading-text">スタッフ未登録</div>';
            return;
        }
        container.innerHTML = staffList.map(s => `
            <div class="staff-admin-card ${s.active ? '' : 'inactive'}" data-staff-id="${s.id}">
                <div class="staff-admin-card-main">
                    <div class="staff-admin-name">
                        ${escapeHtml(s.name)}
                        ${s.active ? '' : '<span class="staff-admin-badge inactive-badge">無効</span>'}
                        ${s.invoiceTarget ? '<span class="staff-admin-badge invoice-badge">請求書対象</span>' : ''}
                    </div>
                    <div class="staff-admin-meta">
                        ${escapeHtml(s.role || '役割未設定')}
                        ・ PIN: ${s.pin ? '<code class="staff-pin">' + escapeHtml(s.pin) + '</code>' : '<span style="color:#b85c4e;">未設定</span>'}
                        ・ ${escapeHtml(s.salaryType || '報酬体系未設定')}
                        ${s.hourlyRate ? '・ 時給 ' + FORMAT.yen(s.hourlyRate) : ''}
                        ${s.commissionRate ? '・ 歩合 ' + s.commissionRate + '%' : ''}
                    </div>
                </div>
                <button class="invoice-action-btn primary" data-edit-staff="${s.id}">編集</button>
            </div>
        `).join('');
        container.querySelectorAll('[data-edit-staff]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.editStaff;
                const staff = staffList.find(s => s.id === id);
                openStaffEdit(staff);
            });
        });
    }

    let _staffAdminCache = []; // 現在表示中の全スタッフ（PIN重複チェック用）

    function openStaffEdit(staff) {
        const isNew = !staff;
        const s = staff || { name: '', pin: '', role: '', hourlyRate: '', salaryType: '', commissionRate: '', active: true, displayOrder: '', invoiceTarget: false };

        const html = `
            <h3 style="font-family:var(--font-serif);color:var(--brown-dark);margin-bottom:0.5rem;font-size:1.3rem;">${isNew ? '＋ 新規スタッフ追加' : 'スタッフ情報を編集'}</h3>
            <p style="font-size:0.78rem;color:var(--gray-500);margin-bottom:1.25rem;">
                ${isNew ? '新規スタッフをスタッフマスタDBに登録します。' : ''}PIN は打刻・請求書承認で使用されます。
            </p>
            <div class="form-error-banner" id="staff-form-error" style="display:none;"></div>

            <form id="staff-edit-form" class="edit-form" novalidate>
                <div class="form-grid-2">
                    <div class="form-field">
                        <label>お名前 <span style="color:var(--red);">*</span></label>
                        <input type="text" name="お名前" value="${escapeHtml(s.name || '')}" required ${isNew ? 'autofocus' : ''}>
                        <div class="field-hint" data-hint-for="お名前"></div>
                    </div>
                    <div class="form-field">
                        <label>役割</label>
                        <select name="役割">
                            <option value="">未選択</option>
                            <option value="オーナー" ${s.role === 'オーナー' ? 'selected' : ''}>オーナー</option>
                            <option value="店長" ${s.role === '店長' ? 'selected' : ''}>店長</option>
                            <option value="スタッフ" ${s.role === 'スタッフ' ? 'selected' : ''}>スタッフ</option>
                            <option value="業務委託" ${s.role === '業務委託' ? 'selected' : ''}>業務委託</option>
                        </select>
                        <div class="field-hint">※ Notionの「役割」プロパティに無い値はエラーになる場合あり</div>
                    </div>
                    <div class="form-field">
                        <label>PIN (4桁数字)</label>
                        <input type="text" name="PIN" value="${escapeHtml(s.pin || '')}" maxlength="4" inputmode="numeric" autocomplete="off" placeholder="例: 1234">
                        <div class="field-hint" data-hint-for="PIN">半角数字4桁。他のスタッフと重複不可。打刻と請求書承認で使用</div>
                    </div>
                    <div class="form-field">
                        <label>表示順</label>
                        <input type="number" name="表示順" value="${s.displayOrder || ''}" min="0" step="1" placeholder="0">
                        <div class="field-hint">数字が小さいほど先に表示されます</div>
                    </div>
                    <div class="form-field">
                        <label>報酬体系</label>
                        <select name="報酬体系">
                            <option value="">未選択</option>
                            <option value="時給制" ${s.salaryType === '時給制' ? 'selected' : ''}>時給制</option>
                            <option value="月給制" ${s.salaryType === '月給制' ? 'selected' : ''}>月給制</option>
                            <option value="歩合制" ${s.salaryType === '歩合制' ? 'selected' : ''}>歩合制</option>
                            <option value="業務委託" ${s.salaryType === '業務委託' ? 'selected' : ''}>業務委託</option>
                        </select>
                        <div class="field-hint">※ Notionの「報酬体系」プロパティに無い値はエラーになる場合あり</div>
                    </div>
                    <div class="form-field">
                        <label>時給 (円)</label>
                        <input type="number" name="時給" value="${s.hourlyRate || ''}" min="0" step="50" placeholder="例: 1200">
                        <div class="field-hint">時給制の場合のみ入力</div>
                    </div>
                    <div class="form-field">
                        <label>歩合率 (%)</label>
                        <input type="number" name="歩合率(%)" value="${s.commissionRate || ''}" min="0" max="100" step="1" placeholder="例: 50">
                        <div class="field-hint">歩合制/業務委託の場合のみ入力</div>
                    </div>
                </div>
                <div class="form-row" style="display:flex;gap:1.5rem;margin-top:1rem;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:0.5rem;">
                        <input type="checkbox" name="有効" ${s.active ? 'checked' : ''}> 有効スタッフ
                    </label>
                    <label style="display:flex;align-items:center;gap:0.5rem;">
                        <input type="checkbox" name="請求書対象" ${s.invoiceTarget ? 'checked' : ''}> 請求書対象（業務委託）
                    </label>
                </div>
                <div class="form-actions">
                    <button type="button" class="invoice-action-btn" id="cancel-staff-edit">キャンセル</button>
                    <button type="submit" class="invoice-action-btn primary">${isNew ? '登録' : '保存'}</button>
                </div>
            </form>
        `;

        document.getElementById('staff-modal-content').innerHTML = html;
        document.getElementById('staff-modal').style.display = 'flex';
        document.getElementById('cancel-staff-edit').addEventListener('click', closeStaffModal);

        const form = document.getElementById('staff-edit-form');
        const errorBanner = document.getElementById('staff-form-error');
        const pinInput = form.querySelector('[name="PIN"]');

        // PIN リアルタイムバリデーション
        const pinHint = form.querySelector('[data-hint-for="PIN"]');
        const validatePin = () => {
            const v = pinInput.value.trim();
            pinInput.classList.remove('field-error', 'field-warn');
            pinHint.classList.remove('error-hint', 'warn-hint');
            pinHint.textContent = '半角数字4桁。他のスタッフと重複不可。打刻と請求書承認で使用';
            if (!v) return; // 空はOK
            if (!/^\d{4}$/.test(v)) {
                pinInput.classList.add('field-error');
                pinHint.classList.add('error-hint');
                pinHint.textContent = '⚠ PINは半角数字4桁で入力してください';
                return;
            }
            // 重複チェック
            const dup = _staffAdminCache.find(x => x.pin === v && x.id !== s.id);
            if (dup) {
                pinInput.classList.add('field-warn');
                pinHint.classList.add('warn-hint');
                pinHint.textContent = `⚠ このPINは「${dup.name}」さんと重複しています`;
            }
        };
        pinInput.addEventListener('input', validatePin);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBanner.style.display = 'none';

            const fd = new FormData(e.target);
            const data = {};
            for (const [k, v] of fd.entries()) data[k] = v;
            data['有効'] = form.querySelector('[name="有効"]').checked;
            data['請求書対象'] = form.querySelector('[name="請求書対象"]').checked;

            // ----- クライアント側バリデーション -----
            const errors = [];
            if (!data['お名前'] || !data['お名前'].trim()) {
                errors.push('お名前は必須です');
            }
            if (data['PIN'] && !/^\d{4}$/.test(data['PIN'])) {
                errors.push('PINは半角数字4桁で入力してください');
            }
            if (data['PIN']) {
                const dup = _staffAdminCache.find(x => x.pin === data['PIN'] && x.id !== s.id);
                if (dup) errors.push(`PIN「${data['PIN']}」は「${dup.name}」さんと重複しています`);
            }
            if (errors.length) {
                showFormError(errorBanner, '入力内容を確認してください', errors);
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            const originalLabel = submitBtn.textContent;
            submitBtn.textContent = '保存中...';

            try {
                if (isNew) {
                    await API.staffCreate(data);
                } else {
                    await API.staffUpdate(s.id, data);
                }
                closeStaffModal();
                await loadSettings();
            } catch (err) {
                const details = [];
                if (err.detail && err.detail !== err.message) details.push(err.detail);
                if (err.notionCode) details.push(`code: ${err.notionCode}`);
                if (err.status) details.push(`HTTP ${err.status}`);
                showFormError(errorBanner, err.message || '保存に失敗しました', details);
                submitBtn.disabled = false;
                submitBtn.textContent = originalLabel;
            }
        });
    }

    function showFormError(banner, title, details) {
        const items = (details || []).filter(Boolean).map(d => `<li>${escapeHtml(d)}</li>`).join('');
        banner.innerHTML = `
            <div class="form-error-title">⚠ ${escapeHtml(title)}</div>
            ${items ? `<ul class="form-error-list">${items}</ul>` : ''}
        `;
        banner.style.display = 'block';
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ============================================
    // Customers
    // ============================================
    let _customerFilter = 'all';
    let _customerList = [];

    async function loadCustomers() {
        bindCustomerHandlers();
        const data = await API.customerList();
        _customerList = data.customers || [];
        renderCustomers();
    }

    function bindCustomerHandlers() {
        if (window._customerHandlersBound) return;
        window._customerHandlersBound = true;

        document.querySelectorAll('.customer-tab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.customer-tab').forEach(b => b.classList.remove('active'));
                t.classList.add('active');
                _customerFilter = t.dataset.cfilter;
                renderCustomers();
            });
        });

        document.getElementById('customer-search').addEventListener('input', renderCustomers);

        document.getElementById('customer-modal-backdrop').addEventListener('click', closeCustomerModal);
        document.getElementById('customer-modal-close').addEventListener('click', closeCustomerModal);

        const newBtn = document.getElementById('btn-new-customer');
        if (newBtn) newBtn.addEventListener('click', openCustomerCreate);
    }

    function renderCustomers() {
        const search = document.getElementById('customer-search').value.toLowerCase();
        let list = _customerList.slice();

        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        const monthAgoStr = monthAgo.toISOString().slice(0, 10);
        const sixtyDaysAgo = new Date(now);
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const sixtyAgoStr = sixtyDaysAgo.toISOString().slice(0, 10);

        if (_customerFilter === 'regular') list = list.filter(c => c.visitCount >= 5);
        if (_customerFilter === 'new') list = list.filter(c => c.firstVisitDate && c.firstVisitDate >= monthAgoStr);
        if (_customerFilter === 'follow') list = list.filter(c => c.status === 'アクティブ' && c.lastVisitDate && c.lastVisitDate < sixtyAgoStr);

        if (search) {
            list = list.filter(c =>
                (c.name || '').toLowerCase().includes(search) ||
                (c.kana || '').toLowerCase().includes(search)
            );
        }

        const container = document.getElementById('customer-grid');
        if (list.length === 0) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;padding:3rem;">該当する顧客なし</div>';
            return;
        }

        container.innerHTML = list.map(c => `
            <div class="customer-card" data-customer-id="${c.id}">
                <div class="customer-card-header">
                    <div class="customer-avatar">${escapeHtml(c.name.charAt(0))}</div>
                    <div>
                        <div class="customer-name">${escapeHtml(c.name)}</div>
                        <div class="customer-kana">${escapeHtml(c.kana || '')}</div>
                    </div>
                </div>
                <div class="customer-stats">
                    <div>
                        <div class="customer-stat-label">来店回数</div>
                        <div class="customer-stat-value">${c.visitCount}回</div>
                    </div>
                    <div>
                        <div class="customer-stat-label">最終来店</div>
                        <div class="customer-stat-value">${formatShortDate(c.lastVisitDate) || '-'}</div>
                    </div>
                    <div>
                        <div class="customer-stat-label">累計</div>
                        <div class="customer-stat-value">${FORMAT.yen(c.totalSpent)}</div>
                    </div>
                    <div>
                        <div class="customer-stat-label">担当</div>
                        <div class="customer-stat-value">${escapeHtml(c.staff || '-')}</div>
                    </div>
                </div>
                <div class="customer-tags">
                    ${(c.tags || []).slice(0, 4).map(t => `<span class="customer-tag ${tagClass(t)}">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('[data-customer-id]').forEach(el => {
            el.addEventListener('click', () => openCustomerModal(el.dataset.customerId));
        });
    }

    function tagClass(tag) {
        if (['アレルギー', '花粉症', '敏感肌'].includes(tag)) return 'alert';
        if (['コンタクト'].includes(tag)) return 'contact';
        if (['常連', 'VIP'].includes(tag)) return 'regular';
        return '';
    }

    function formatShortDate(s) {
        if (!s) return '';
        const d = new Date(s);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    async function openCustomerModal(id) {
        document.getElementById('customer-modal').style.display = 'flex';
        document.getElementById('customer-modal-content').innerHTML = '<div class="loading-text">読み込み中...</div>';
        try {
            const data = await API.customerDetail(id);
            renderCustomerDetail(data.customer);
        } catch (e) {
            document.getElementById('customer-modal-content').innerHTML = `<div style="color:#b85c4e;">エラー: ${escapeHtml(e.message)}</div>`;
        }
    }

    function closeCustomerModal() {
        document.getElementById('customer-modal').style.display = 'none';
    }

    function renderCustomerDetail(c) {
        const html = `
            <div class="customer-detail-header">
                <div class="customer-avatar customer-detail-avatar">${escapeHtml(c.name.charAt(0))}</div>
                <div style="flex:1;">
                    <div class="customer-detail-name">${escapeHtml(c.name)}</div>
                    <div class="customer-detail-sub">
                        ${escapeHtml(c.kana || '')} ${c.birthday ? '・ ' + c.birthday + ' 生' : ''}
                        ${c.firstVisitDate ? '・ 初来店 ' + c.firstVisitDate : ''}
                    </div>
                </div>
                <div class="customer-actions">
                    <button class="invoice-action-btn primary" data-edit-customer="${c.id}">編集</button>
                    <button class="invoice-action-btn" data-add-treatment="${c.id}">施術追加</button>
                </div>
            </div>

            <div class="customer-detail-props">
                <div class="detail-prop"><div class="detail-prop-label">📞 電話</div><div class="detail-prop-value">${escapeHtml(c.phone || '-')}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">✉️ メール</div><div class="detail-prop-value">${escapeHtml(c.email || '-')}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">⭐ 来店回数</div><div class="detail-prop-value">${c.visitCount} 回</div></div>
                <div class="detail-prop"><div class="detail-prop-label">💰 累計売上</div><div class="detail-prop-value">${FORMAT.yen(c.totalSpent)}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">📅 最終来店</div><div class="detail-prop-value">${c.lastVisitDate || '-'}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">👤 担当</div><div class="detail-prop-value">${escapeHtml(c.staff || '-')}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">🏷️ タグ</div><div class="detail-prop-value">${(c.tags || []).join('、') || '-'}</div></div>
                <div class="detail-prop"><div class="detail-prop-label">📊 ステータス</div><div class="detail-prop-value">${escapeHtml(c.status || '-')}</div></div>
            </div>

            ${c.health ? `
            <div class="detail-callout alert">
                <div class="detail-callout-label">⚠️ 健康状態・アレルギー</div>
                ${escapeHtml(c.health)}
            </div>` : ''}

            ${c.preferences ? `
            <div class="detail-callout">
                <div class="detail-callout-label">🌿 お好み・要望</div>
                ${escapeHtml(c.preferences)}
            </div>` : ''}

            ${c.staffMemo ? `
            <div class="detail-callout">
                <div class="detail-callout-label">📝 スタッフメモ</div>
                ${escapeHtml(c.staffMemo)}
            </div>` : ''}

            <div class="detail-section-title">📸 施術履歴（${(c.treatments || []).length}件）</div>
            ${renderTreatments(c.treatments || [])}
        `;
        document.getElementById('customer-modal-content').innerHTML = html;

        // Edit/Add buttons
        const editBtn = document.querySelector('[data-edit-customer]');
        if (editBtn) editBtn.addEventListener('click', () => openCustomerEdit(c));
        const addBtn = document.querySelector('[data-add-treatment]');
        if (addBtn) addBtn.addEventListener('click', () => openTreatmentAdd(c));
    }

    function openCustomerCreate() {
        // モーダルを開いて新規作成フォームを表示
        document.getElementById('customer-modal').style.display = 'flex';
        const html = `
            <h3 style="font-family:var(--font-serif);color:var(--brown-dark);margin-bottom:1.5rem;font-size:1.3rem;">＋ 新規顧客を追加</h3>
            <form id="customer-create-form" class="edit-form">
                <div class="form-grid-2">
                    <div class="form-field">
                        <label>お名前 <span style="color:var(--red);">*</span></label>
                        <input type="text" name="お名前" required autofocus placeholder="山田 花子">
                    </div>
                    <div class="form-field">
                        <label>フリガナ</label>
                        <input type="text" name="フリガナ" placeholder="ヤマダ ハナコ">
                    </div>
                    <div class="form-field">
                        <label>電話番号</label>
                        <input type="tel" name="電話番号" placeholder="090-1234-5678">
                    </div>
                    <div class="form-field">
                        <label>メール</label>
                        <input type="email" name="メールアドレス" placeholder="example@email.com">
                    </div>
                    <div class="form-field">
                        <label>生年月日</label>
                        <input type="date" name="生年月日">
                    </div>
                    <div class="form-field">
                        <label>初来店日</label>
                        <input type="date" name="初来店日" value="${new Date().toISOString().slice(0,10)}">
                    </div>
                    <div class="form-field">
                        <label>性別</label>
                        <select name="性別">
                            <option value="">未選択</option>
                            <option value="女性" selected>女性</option>
                            <option value="男性">男性</option>
                            <option value="その他">その他</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>担当スタッフ</label>
                        <select name="担当スタッフ">
                            <option value="">未選択</option>
                            <option value="唐木田 帆花">唐木田 帆花</option>
                            <option value="玉木 愛">玉木 愛</option>
                            <option value="磯谷">磯谷</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>ステータス</label>
                        <select name="ステータス">
                            <option value="アクティブ" selected>アクティブ</option>
                            <option value="休眠">休眠</option>
                            <option value="離反">離反</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>流入元</label>
                        <select name="流入元">
                            <option value="">未選択</option>
                            <option value="Web予約">Web予約</option>
                            <option value="紹介">紹介</option>
                            <option value="Instagram">Instagram</option>
                            <option value="Google">Google</option>
                            <option value="ホットペッパー">ホットペッパー</option>
                            <option value="飛び込み">飛び込み</option>
                        </select>
                    </div>
                </div>
                <div class="form-field">
                    <label>健康状態・アレルギー</label>
                    <textarea name="健康状態・アレルギー" rows="2" placeholder="例: 花粉症あり、コンタクト使用"></textarea>
                </div>
                <div class="form-field">
                    <label>お好み・要望</label>
                    <textarea name="お好み・要望" rows="2" placeholder="例: ナチュラル仕上げ希望"></textarea>
                </div>
                <div class="form-field">
                    <label>スタッフメモ</label>
                    <textarea name="スタッフメモ" rows="2"></textarea>
                </div>
                <div class="form-row" style="display:flex;gap:1rem;margin-top:1rem;">
                    <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" name="LINE登録"> LINE登録</label>
                    <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" name="同意書受理"> 同意書受理</label>
                </div>
                <div class="form-actions">
                    <button type="button" class="invoice-action-btn" id="cancel-create">キャンセル</button>
                    <button type="submit" class="invoice-action-btn primary">登録</button>
                </div>
            </form>
        `;
        document.getElementById('customer-modal-content').innerHTML = html;

        document.getElementById('cancel-create').addEventListener('click', closeCustomerModal);
        document.getElementById('customer-create-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = '登録中...';
            try {
                const fd = new FormData(e.target);
                const data = {};
                for (const [k, v] of fd.entries()) data[k] = v;
                data['LINE登録'] = e.target.querySelector('[name="LINE登録"]').checked;
                data['同意書受理'] = e.target.querySelector('[name="同意書受理"]').checked;
                const r = await API.customerCreate(data);
                _customerList = []; // 一覧キャッシュクリア
                await loadCustomers();
                if (r && r.id) {
                    // 作成した顧客の詳細を開く（そのまま施術追加に進める）
                    openCustomerModal(r.id);
                } else {
                    closeCustomerModal();
                }
            } catch (err) {
                alert('登録エラー: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.textContent = '登録';
            }
        });
    }

    function openCustomerEdit(c) {
        const html = `
            <h3 style="font-family:var(--font-serif);color:var(--brown-dark);margin-bottom:1.5rem;font-size:1.3rem;">顧客情報を編集</h3>
            <form id="customer-edit-form" class="edit-form">
                <div class="form-grid-2">
                    <div class="form-field">
                        <label>お名前</label>
                        <input type="text" name="お名前" value="${escapeHtml(c.name || '')}" required>
                    </div>
                    <div class="form-field">
                        <label>フリガナ</label>
                        <input type="text" name="フリガナ" value="${escapeHtml(c.kana || '')}">
                    </div>
                    <div class="form-field">
                        <label>電話番号</label>
                        <input type="tel" name="電話番号" value="${escapeHtml(c.phone || '')}">
                    </div>
                    <div class="form-field">
                        <label>メール</label>
                        <input type="email" name="メールアドレス" value="${escapeHtml(c.email || '')}">
                    </div>
                    <div class="form-field">
                        <label>生年月日</label>
                        <input type="date" name="生年月日" value="${c.birthday || ''}">
                    </div>
                    <div class="form-field">
                        <label>初来店日</label>
                        <input type="date" name="初来店日" value="${c.firstVisitDate || ''}">
                    </div>
                    <div class="form-field">
                        <label>性別</label>
                        <select name="性別">
                            <option value="">未選択</option>
                            <option value="女性" ${c.gender === '女性' ? 'selected' : ''}>女性</option>
                            <option value="男性" ${c.gender === '男性' ? 'selected' : ''}>男性</option>
                            <option value="その他" ${c.gender === 'その他' ? 'selected' : ''}>その他</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>担当スタッフ</label>
                        <select name="担当スタッフ">
                            <option value="">未選択</option>
                            <option value="唐木田 帆花" ${c.staff && c.staff.includes('唐木田') ? 'selected' : ''}>唐木田 帆花</option>
                            <option value="玉木 愛" ${c.staff && c.staff.includes('玉木') ? 'selected' : ''}>玉木 愛</option>
                            <option value="磯谷" ${c.staff && c.staff.includes('磯谷') ? 'selected' : ''}>磯谷</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>ステータス</label>
                        <select name="ステータス">
                            <option value="アクティブ" ${c.status === 'アクティブ' ? 'selected' : ''}>アクティブ</option>
                            <option value="休眠" ${c.status === '休眠' ? 'selected' : ''}>休眠</option>
                            <option value="離反" ${c.status === '離反' ? 'selected' : ''}>離反</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>流入元</label>
                        <select name="流入元">
                            <option value="">未選択</option>
                            <option value="Web予約" ${c.source === 'Web予約' ? 'selected' : ''}>Web予約</option>
                            <option value="紹介" ${c.source === '紹介' ? 'selected' : ''}>紹介</option>
                            <option value="Instagram" ${c.source === 'Instagram' ? 'selected' : ''}>Instagram</option>
                            <option value="Google" ${c.source === 'Google' ? 'selected' : ''}>Google</option>
                            <option value="ホットペッパー" ${c.source === 'ホットペッパー' ? 'selected' : ''}>ホットペッパー</option>
                            <option value="飛び込み" ${c.source === '飛び込み' ? 'selected' : ''}>飛び込み</option>
                        </select>
                    </div>
                </div>
                <div class="form-field">
                    <label>健康状態・アレルギー</label>
                    <textarea name="健康状態・アレルギー" rows="2">${escapeHtml(c.health || '')}</textarea>
                </div>
                <div class="form-field">
                    <label>お好み・要望</label>
                    <textarea name="お好み・要望" rows="2">${escapeHtml(c.preferences || '')}</textarea>
                </div>
                <div class="form-field">
                    <label>スタッフメモ</label>
                    <textarea name="スタッフメモ" rows="2">${escapeHtml(c.staffMemo || '')}</textarea>
                </div>
                <div class="form-row" style="display:flex;gap:1rem;margin-top:1rem;">
                    <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" name="LINE登録" ${c.lineRegistered ? 'checked' : ''}> LINE登録</label>
                    <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" name="同意書受理" ${c.consentReceived ? 'checked' : ''}> 同意書受理</label>
                </div>
                <div class="form-actions">
                    <button type="button" class="invoice-action-btn" id="cancel-edit">キャンセル</button>
                    <button type="submit" class="invoice-action-btn primary">保存</button>
                </div>
            </form>
        `;
        document.getElementById('customer-modal-content').innerHTML = html;
        document.getElementById('cancel-edit').addEventListener('click', () => openCustomerModal(c.id));
        document.getElementById('customer-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const data = {};
            for (const [k, v] of fd.entries()) data[k] = v;
            // チェックボックス手動取得
            data['LINE登録'] = e.target.querySelector('[name="LINE登録"]').checked;
            data['同意書受理'] = e.target.querySelector('[name="同意書受理"]').checked;
            try {
                await API.customerUpdate(c.id, data);
                alert('保存しました');
                openCustomerModal(c.id);
                _customerList = []; // 一覧キャッシュクリア
                loadCustomers();
            } catch (err) {
                alert('エラー: ' + err.message);
            }
        });
    }

    function openTreatmentAdd(c) {
        const todayDateTime = new Date().toISOString().slice(0, 16);
        const html = `
            <h3 style="font-family:var(--font-serif);color:var(--brown-dark);margin-bottom:1.5rem;font-size:1.3rem;">${escapeHtml(c.name)} さんの施術を追加</h3>
            <form id="treatment-add-form" class="edit-form">
                <div class="form-grid-2">
                    <div class="form-field">
                        <label>件名</label>
                        <input type="text" name="件名" value="${escapeHtml(c.name)} - ${todayDateTime.slice(0,10)}" required>
                    </div>
                    <div class="form-field">
                        <label>来店日時</label>
                        <input type="datetime-local" name="来店日時" value="${todayDateTime}" required>
                    </div>
                    <div class="form-field">
                        <label>担当スタッフ</label>
                        <select name="担当スタッフ">
                            <option value="唐木田 帆花">唐木田 帆花</option>
                            <option value="玉木 愛">玉木 愛</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>ステータス</label>
                        <select name="ステータス">
                            <option value="予約済">予約済</option>
                            <option value="来店済" selected>来店済</option>
                            <option value="キャンセル">キャンセル</option>
                            <option value="ノーショー">ノーショー</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label>料金（税込）</label>
                        <input type="number" name="料金" value="0" min="0" step="100">
                    </div>
                    <div class="form-field">
                        <label>支払方法</label>
                        <select name="支払方法">
                            <option value="">未選択</option>
                            <option value="現金">現金</option>
                            <option value="クレジット">クレジット</option>
                            <option value="電子マネー">電子マネー</option>
                            <option value="Squareリンク">Squareリンク</option>
                        </select>
                    </div>
                </div>

                <div class="form-field">
                    <label>Before写真</label>
                    <input type="file" id="before-files" multiple accept="image/*">
                    <div class="upload-preview" id="before-preview"></div>
                </div>
                <div class="form-field">
                    <label>After写真</label>
                    <input type="file" id="after-files" multiple accept="image/*">
                    <div class="upload-preview" id="after-preview"></div>
                </div>

                <div class="form-field">
                    <label>詳細メモ</label>
                    <textarea name="詳細メモ" rows="3" placeholder="例: 11mm Jカール、目尻3mm延長..."></textarea>
                </div>
                <div class="form-field">
                    <label>次回提案</label>
                    <textarea name="次回提案" rows="2" placeholder="例: 次回ブラウンミックス提案、3週間後リペア推奨"></textarea>
                </div>

                <div class="form-actions">
                    <button type="button" class="invoice-action-btn" id="cancel-treatment">キャンセル</button>
                    <button type="submit" class="invoice-action-btn primary">保存</button>
                </div>
            </form>
        `;
        document.getElementById('customer-modal-content').innerHTML = html;

        document.getElementById('cancel-treatment').addEventListener('click', () => openCustomerModal(c.id));

        // 画像プレビュー
        const beforeUrls = [];
        const afterUrls = [];
        document.getElementById('before-files').addEventListener('change', (e) => handleFileSelect(e, beforeUrls, 'before-preview'));
        document.getElementById('after-files').addEventListener('change', (e) => handleFileSelect(e, afterUrls, 'after-preview'));

        document.getElementById('treatment-add-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = '保存中...';
            try {
                const fd = new FormData(e.target);
                const data = {};
                for (const [k, v] of fd.entries()) data[k] = v;
                data['Before写真URLs'] = beforeUrls;
                data['After写真URLs'] = afterUrls;
                data['顧客Id'] = c.id;
                await API.treatmentCreate(data);
                alert('施術記録を追加しました');
                openCustomerModal(c.id);
            } catch (err) {
                alert('エラー: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.textContent = '保存';
            }
        });
    }

    async function handleFileSelect(e, urlArray, previewId) {
        const files = Array.from(e.target.files || []);
        const preview = document.getElementById(previewId);
        for (const file of files) {
            const placeholder = document.createElement('div');
            placeholder.className = 'upload-thumb uploading';
            placeholder.textContent = 'アップロード中...';
            preview.appendChild(placeholder);
            try {
                const result = await API.uploadFile(file);
                placeholder.classList.remove('uploading');
                placeholder.textContent = '';
                placeholder.style.backgroundImage = `url('${result.url}')`;
                urlArray.push(result.url);
            } catch (err) {
                placeholder.textContent = 'エラー: ' + err.message;
                placeholder.style.color = 'red';
            }
        }
    }

    function renderTreatments(treatments) {
        if (treatments.length === 0) return '<div style="color:#999;padding:1rem;text-align:center;">施術履歴なし</div>';
        return treatments.map(t => {
            const photos = [...(t.beforePhotos || []), ...(t.afterPhotos || [])];
            return `
            <div class="treatment-item">
                <div class="treatment-header">
                    <div class="treatment-date">${FORMAT.dateLong(t.date)}</div>
                    <div class="treatment-fee">${FORMAT.yen(t.fee)} <span class="tag" style="margin-left:0.5rem;">${escapeHtml(t.status)}</span></div>
                </div>
                <div class="treatment-meta">${escapeHtml(t.staff || '')} / ${escapeHtml(t.menu || '')}</div>
                ${photos.length > 0 ? `
                <div class="treatment-photos">
                    ${photos.map(p => `<div class="treatment-photo" style="background-image:url('${escapeHtml(p)}')"></div>`).join('')}
                </div>` : ''}
                ${t.memo ? `<div class="treatment-memo"><strong>メモ:</strong> ${escapeHtml(t.memo)}</div>` : ''}
                ${t.nextProposal ? `<div class="treatment-memo"><strong>次回提案:</strong> ${escapeHtml(t.nextProposal)}</div>` : ''}
            </div>
        `;
        }).join('');
    }

    // ============================================
    // Invoices
    // ============================================
    let _invoiceFilter = 'all';
    let _staffInvoiceContext = null;

    async function loadInvoices() {
        // 月picker初期値: 前月
        const monthInput = document.getElementById('invoice-month');
        if (monthInput && !monthInput.value) {
            const d = new Date();
            d.setMonth(d.getMonth() - 1);
            monthInput.value = d.toISOString().slice(0, 7);
        }

        bindInvoiceHandlers();
        await renderInvoiceList();
        await renderStaffInvoiceFlow();
    }

    function bindInvoiceHandlers() {
        // 1度だけバインドするためのフラグ
        if (window._invoiceHandlersBound) return;
        window._invoiceHandlersBound = true;

        document.querySelectorAll('.invoice-tab').forEach(t => {
            t.addEventListener('click', async () => {
                document.querySelectorAll('.invoice-tab').forEach(b => b.classList.remove('active'));
                t.classList.add('active');
                _invoiceFilter = t.dataset.tab;
                await renderInvoiceList();
            });
        });

        document.getElementById('btn-generate').addEventListener('click', async () => {
            const ym = document.getElementById('invoice-month').value;
            if (!ym) {
                alert('対象月を選択してください');
                return;
            }
            if (!confirm(`${ym} の請求書を生成しますか？\n（既存があればスキップされます）`)) return;
            const btn = document.getElementById('btn-generate');
            btn.disabled = true;
            btn.textContent = '生成中...';
            try {
                const r = await API.invoiceGenerate(ym);
                let msg = `生成: ${r.generated.length}件\nスキップ: ${r.skipped.length}件`;
                if (r.generated.length > 0) {
                    msg += '\n\n[生成された請求書]\n' + r.generated.map(g => `${g.staff}: ${g.visitCount}件 / ¥${g.feeAmount.toLocaleString()}`).join('\n');
                }
                alert(msg);
                await renderInvoiceList();
            } catch (e) {
                alert('エラー: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '月末請求書を生成';
            }
        });

        // スタッフ請求書フロー
        document.getElementById('invoice-staff-buttons').addEventListener('click', (e) => {
            const btn = e.target.closest('.staff-button');
            if (!btn) return;
            _staffInvoiceContext = { staffId: btn.dataset.staffId, staffName: btn.dataset.staffName };
            document.getElementById('invoice-staff-name').textContent = btn.dataset.staffName;
            document.getElementById('invoice-staff-select').style.display = 'none';
            document.getElementById('invoice-pin-step').style.display = 'block';
            document.getElementById('invoice-pin-input').value = '';
            document.getElementById('invoice-pin-error').textContent = '';
            setTimeout(() => document.getElementById('invoice-pin-input').focus(), 100);
        });

        document.getElementById('invoice-pin-back').addEventListener('click', () => {
            document.getElementById('invoice-pin-step').style.display = 'none';
            document.getElementById('invoice-staff-select').style.display = 'block';
        });

        document.getElementById('invoice-pin-submit').addEventListener('click', async () => {
            const pin = document.getElementById('invoice-pin-input').value;
            const errEl = document.getElementById('invoice-pin-error');
            errEl.textContent = '';
            if (!pin || pin.length !== 4) {
                errEl.textContent = 'PIN (4桁) を入力してください';
                return;
            }
            try {
                const r = await API.staffInvoices(_staffInvoiceContext.staffId, pin);
                _staffInvoiceContext.pin = pin;
                document.getElementById('invoice-list-staff-name').textContent = r.staffName;
                document.getElementById('invoice-pin-step').style.display = 'none';
                document.getElementById('invoice-staff-list').style.display = 'block';
                renderStaffInvoiceItems(r.invoices);
            } catch (e) {
                errEl.textContent = e.message;
            }
        });

        document.getElementById('invoice-list-back').addEventListener('click', () => {
            _staffInvoiceContext = null;
            document.getElementById('invoice-staff-list').style.display = 'none';
            document.getElementById('invoice-staff-select').style.display = 'block';
        });
    }

    async function renderInvoiceList() {
        const data = await API.invoiceList();
        const tbody = document.querySelector('#invoice-table tbody');
        let invoices = data.invoices || [];

        if (_invoiceFilter === 'pending') {
            invoices = invoices.filter(i => i.status === 'スタッフ承認待ち' || i.status === 'オーナー承認待ち');
        } else if (_invoiceFilter === 'approved') {
            invoices = invoices.filter(i => i.status === '確定');
        } else if (_invoiceFilter === 'paid') {
            invoices = invoices.filter(i => i.status === '支払済');
        }

        if (invoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-cell" style="text-align:center;color:#999;padding:2rem;">該当する請求書なし</td></tr>';
            return;
        }

        tbody.innerHTML = invoices.map(i => `
            <tr>
                <td data-label="請求書No"><span style="font-family:var(--font-en)">${escapeHtml(i.invoiceNo)}</span></td>
                <td data-label="スタッフ">${escapeHtml(i.staffName)}</td>
                <td data-label="対象月">${escapeHtml(i.targetMonth || '-')}</td>
                <td data-label="件数" class="num">${i.visitCount}</td>
                <td data-label="売上(税抜)" class="num">${FORMAT.yen(i.salesExclTax)}</td>
                <td data-label="報酬額" class="num">${FORMAT.yen(i.feeAmount)}</td>
                <td data-label="ステータス">${invoiceStatusBadge(i.status)}</td>
                <td data-label="操作">${invoiceActions(i)}</td>
            </tr>
        `).join('');

        document.querySelectorAll('[data-action]').forEach(b => {
            b.addEventListener('click', async () => {
                const action = b.dataset.action;
                const id = b.dataset.id;
                try {
                    if (action === 'preview') {
                        // プレビューURL（パスワード必要）
                        const pw = prompt('プレビューするにはダッシュボードパスワードを入力してください');
                        if (!pw) return;
                        const url = `${CONFIG.API_BASE}/api/invoices/${id}/html?token=${encodeURIComponent(pw)}`;
                        window.open(url, '_blank');
                        return;
                    }
                    if (action === 'approve') {
                        if (!confirm('オーナー承認します。よろしいですか？')) return;
                        await API.invoiceOwnerApprove(id);
                    } else if (action === 'reject') {
                        const reason = prompt('却下理由を入力してください');
                        if (reason === null) return;
                        await API.invoiceReject(id, reason);
                    } else if (action === 'paid') {
                        if (!confirm('支払済としてマークします。よろしいですか？')) return;
                        await API.invoiceMarkPaid(id);
                    }
                    await renderInvoiceList();
                } catch (e) {
                    alert('エラー: ' + e.message);
                }
            });
        });
    }

    function invoiceStatusBadge(status) {
        const map = {
            '下書き': 'draft',
            'スタッフ承認待ち': 'staff-wait',
            'オーナー承認待ち': 'owner-wait',
            '確定': 'approved',
            '支払済': 'paid',
            '却下': 'rejected',
        };
        const cls = map[status] || 'draft';
        return `<span class="invoice-status ${cls}">${escapeHtml(status)}</span>`;
    }

    function invoiceActions(i) {
        const buttons = [];
        // プレビュー（常に表示）
        buttons.push(`<button class="invoice-action-btn" data-action="preview" data-id="${i.id}">PDFプレビュー</button>`);
        if (i.status === 'オーナー承認待ち') {
            buttons.push(`<button class="invoice-action-btn primary" data-action="approve" data-id="${i.id}">承認</button>`);
            buttons.push(`<button class="invoice-action-btn danger" data-action="reject" data-id="${i.id}">却下</button>`);
        }
        if (i.status === '確定') {
            buttons.push(`<button class="invoice-action-btn primary" data-action="paid" data-id="${i.id}">支払済</button>`);
        }
        return buttons.join('') || '<span style="color:#999;">-</span>';
    }

    async function renderStaffInvoiceFlow() {
        const data = await API.staffList();
        const container = document.getElementById('invoice-staff-buttons');
        // 請求書対象のスタッフのみ表示
        const eligible = (data.staff || []).filter(s => s.invoiceTarget);
        if (eligible.length === 0) {
            container.innerHTML = '<div class="loading-text">請求書対象スタッフが登録されていません</div>';
            return;
        }
        container.innerHTML = eligible.map(s => `
            <button class="staff-button" data-staff-id="${s.id}" data-staff-name="${escapeHtml(s.name)}">
                <div class="staff-button-name">${escapeHtml(s.name)}</div>
                <div class="staff-button-role">${escapeHtml(s.role || '')}</div>
            </button>
        `).join('');
    }

    function renderStaffInvoiceItems(invoices) {
        const container = document.getElementById('invoice-staff-items');
        if (!invoices || invoices.length === 0) {
            container.innerHTML = '<div class="loading-text">請求書はまだありません</div>';
            return;
        }
        container.innerHTML = invoices.map(i => `
            <div class="invoice-staff-card">
                <div class="invoice-staff-card-header">
                    <div>
                        <div class="invoice-staff-card-no">${escapeHtml(i.invoiceNo)}</div>
                        <div style="font-family:var(--font-serif);color:var(--brown-dark);">${escapeHtml(i.targetMonth || '')} 月度</div>
                    </div>
                    ${invoiceStatusBadge(i.status)}
                </div>
                <div class="invoice-staff-card-detail">
                    <div><span>件数:</span> <strong>${i.visitCount}件</strong></div>
                    <div><span>売上(税抜):</span> <strong>${FORMAT.yen(i.salesExclTax)}</strong></div>
                    <div><span>報酬率:</span> <strong>${Math.round(i.commissionRate * 100)}%</strong></div>
                    <div><span>報酬額:</span> <strong>${FORMAT.yen(i.feeAmount)}</strong></div>
                    <div><span>締日:</span> <strong style="font-size:0.85rem;">${i.closingDate || '-'}</strong></div>
                    <div><span>支払予定:</span> <strong style="font-size:0.85rem;">${i.paymentDueDate || '-'}</strong></div>
                </div>
                ${i.status === 'スタッフ承認待ち' ? `
                    <button class="btn-primary" data-staff-approve="${i.id}" style="width:100%;padding:0.75rem;">この内容で承認する</button>
                ` : ''}
            </div>
        `).join('');

        container.querySelectorAll('[data-staff-approve]').forEach(b => {
            b.addEventListener('click', async () => {
                const id = b.dataset.staffApprove;
                if (!confirm('この請求書内容で承認します。よろしいですか？')) return;
                try {
                    await API.staffApproveInvoice(id, _staffInvoiceContext.staffId, _staffInvoiceContext.pin);
                    alert('承認しました。オーナー承認をお待ちください。');
                    const r = await API.staffInvoices(_staffInvoiceContext.staffId, _staffInvoiceContext.pin);
                    renderStaffInvoiceItems(r.invoices);
                } catch (e) {
                    alert('エラー: ' + e.message);
                }
            });
        });
    }

    // ============================================
    // Utilities
    // ============================================
    function showLoading(show) {
        document.getElementById('loading').style.display = show ? 'flex' : 'none';
    }

    function updateLastUpdated() {
        const now = new Date();
        document.getElementById('last-updated').textContent =
            `最終更新: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
