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

        const titles = { home: 'ホーム', sales: '売上', staff: 'スタッフ', menu: 'メニュー', attendance: '勤怠管理', invoices: '請求書' };
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
                <td>${FORMAT.dateLong(r.date)}</td>
                <td>${escapeHtml(r.title)}</td>
                <td>${escapeHtml(r.staff || '-')}</td>
                <td>${escapeHtml(r.menu || '-')}</td>
                <td class="num">${FORMAT.yen(r.fee)}</td>
                <td><span class="tag">${escapeHtml(r.status || '-')}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
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
                <td>${i + 1}</td>
                <td>${escapeHtml(s.name)}</td>
                <td class="num">${FORMAT.yen(s.sales)}</td>
                <td class="num">${s.count}</td>
                <td class="num">${FORMAT.yen(s.count ? Math.floor(s.sales / s.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
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
                <td>${i + 1}</td>
                <td>${escapeHtml(m.name)}</td>
                <td class="num">${FORMAT.yen(m.sales)}</td>
                <td class="num">${m.count}</td>
                <td class="num">${FORMAT.yen(m.count ? Math.floor(m.sales / m.count) : 0)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:2rem;">データなし</td></tr>';
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
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:2rem;">本日の打刻なし</td></tr>';
            return;
        }
        tbody.innerHTML = data.today.map(p => {
            const time = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '-';
            return `
                <tr>
                    <td>${time}</td>
                    <td>${escapeHtml(p.staffName)}</td>
                    <td><span class="tag">${escapeHtml(p.type)}</span></td>
                    <td>${escapeHtml(p.memo || '-')}</td>
                </tr>
            `;
        }).join('');
    }

    async function renderMonthlySummary() {
        const data = await API.attendanceSummary();
        document.getElementById('attendance-month').textContent = (data.month || '').replace('-', '/');
        const tbody = document.querySelector('#attendance-summary-table tbody');
        if (!data.summary || data.summary.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:2rem;">今月の勤務記録なし</td></tr>';
            return;
        }
        tbody.innerHTML = data.summary.map(s => {
            const h = Math.floor(s.totalMinutes / 60);
            const m = s.totalMinutes % 60;
            const wage = s.estimatedWage != null ? FORMAT.yen(s.estimatedWage) : '-';
            return `
                <tr>
                    <td>${escapeHtml(s.name)}</td>
                    <td class="num">${s.workDays}日</td>
                    <td class="num">${h}h ${m}m</td>
                    <td class="num">${wage}</td>
                </tr>
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
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:2rem;">該当する請求書なし</td></tr>';
            return;
        }

        tbody.innerHTML = invoices.map(i => `
            <tr>
                <td><span style="font-family:var(--font-en)">${escapeHtml(i.invoiceNo)}</span></td>
                <td>${escapeHtml(i.staffName)}</td>
                <td>${escapeHtml(i.targetMonth || '-')}</td>
                <td class="num">${i.visitCount}</td>
                <td class="num">${FORMAT.yen(i.salesExclTax)}</td>
                <td class="num">${FORMAT.yen(i.feeAmount)}</td>
                <td>${invoiceStatusBadge(i.status)}</td>
                <td>${invoiceActions(i)}</td>
            </tr>
        `).join('');

        document.querySelectorAll('[data-action]').forEach(b => {
            b.addEventListener('click', async () => {
                const action = b.dataset.action;
                const id = b.dataset.id;
                try {
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
