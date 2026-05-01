/**
 * SORA Dashboard - Chart.js コンフィギュレーション
 * SORAブランドカラーで一貫性のあるグラフを描画
 */

// SORAパレット
const SORA_COLORS = {
    sage: '#8fa085',
    sageDark: '#667a5d',
    sageSoft: '#b3c4a8',
    sagePale: '#e8eee0',
    brown: '#9a7f62',
    brownDark: '#6b5641',
    cream: '#fdfbf5',
    ivory: '#faf7ef',
    pink: '#d49a9a',
    blue: '#7a9bb8',
    purple: '#a48ba8',
    yellow: '#d4b87a',
};

const PIE_COLORS = [
    SORA_COLORS.sage,
    SORA_COLORS.brown,
    SORA_COLORS.pink,
    SORA_COLORS.blue,
    SORA_COLORS.purple,
    SORA_COLORS.yellow,
    SORA_COLORS.sageDark,
    SORA_COLORS.brownDark,
    SORA_COLORS.sageSoft,
    SORA_COLORS.sagePale,
];

Chart.defaults.font.family = "'Noto Sans JP', sans-serif";
Chart.defaults.color = '#4d493f';
Chart.defaults.borderColor = '#e9e4d5';

// チャートインスタンスを保持して、再描画時に破棄するため
const _chartInstances = {};

function destroyChart(id) {
    if (_chartInstances[id]) {
        _chartInstances[id].destroy();
        delete _chartInstances[id];
    }
}

function makeBarChart(canvasId, labels, data, label, color) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data,
                backgroundColor: color || SORA_COLORS.sage,
                borderRadius: 6,
                maxBarThickness: 36,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${label}: ¥${ctx.parsed.y.toLocaleString()}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => '¥' + (v / 1000) + 'k' },
                    grid: { color: '#f0eadb' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function makeLineChart(canvasId, labels, data, label) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label,
                data,
                borderColor: SORA_COLORS.sageDark,
                backgroundColor: 'rgba(143, 160, 133, 0.15)',
                fill: true,
                tension: 0.35,
                pointBackgroundColor: SORA_COLORS.sageDark,
                pointBorderColor: 'white',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${label}: ¥${ctx.parsed.y.toLocaleString()}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => '¥' + (v / 1000) + 'k' },
                    grid: { color: '#f0eadb' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function makePieChart(canvasId, labels, data, label) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: PIE_COLORS,
                borderColor: 'white',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { padding: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total ? Math.round(ctx.parsed / total * 100) : 0;
                            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '55%'
        }
    });
}

function makeHorizontalBarChart(canvasId, labels, data, label) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data,
                backgroundColor: SORA_COLORS.sage,
                borderRadius: 4,
                maxBarThickness: 24,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${label}: ¥${ctx.parsed.x.toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => '¥' + (v / 1000) + 'k' },
                    grid: { color: '#f0eadb' }
                },
                y: { grid: { display: false } }
            }
        }
    });
}
