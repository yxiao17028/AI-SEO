// Global State Management
let gscChart = null;

// ==========================================
// Dashboard Cache (persisted via localStorage)
// ==========================================
const DASH_CACHE_KEY = "apexseo_dashboard_cache";

function loadDashboardCache() {
    try {
        const raw = localStorage.getItem(DASH_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function saveDashboardCache(cache) {
    try {
        localStorage.setItem(DASH_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* quota exceeded fallback */ }

    // Sync data to backend SQLite database
    fetch('/api/dashboard/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cache)
    }).catch(err => console.error("Failed to sync dashboard to backend server:", err));
}

async function loadDashboardServer() {
    try {
        const response = await fetch('/api/dashboard/data');
        const serverData = await response.json();
        if (serverData && Object.keys(serverData).length > 1) {
            dashboardCache = Object.assign({}, dashboardCache, serverData);
            try {
                localStorage.setItem(DASH_CACHE_KEY, JSON.stringify(dashboardCache));
            } catch (e) {}
            updateDashboard();
        }
    } catch (e) {
        console.error("Failed to fetch cloud dashboard data from server:", e);
    }
}

let dashboardAnalyticsData = null;
let dashChartInstances = {
    audit: null,
    rank: null,
    kwcheck: null,
    kwmagic: null,
    blcheck: null,
    blgap: null
};

async function loadDashboardAnalytics(btnEl) {
    let refreshIcon = null;
    if (btnEl) {
        refreshIcon = btnEl.querySelector('i');
        if (refreshIcon) refreshIcon.classList.add('spin-icon');
        btnEl.disabled = true;
    }
    try {
        const response = await fetch('/api/dashboard/feature-analytics');
        const data = await response.json();
        if (data.error) {
            console.error("Feature analytics error:", data.error);
            return;
        }
        dashboardAnalyticsData = data;
        populateDashboardSelects();
        renderAllDashboardCharts();
        if (window.lucide) {
            window.lucide.createIcons();
        }
    } catch (e) {
        console.error("Failed to load dashboard analytics:", e);
    } finally {
        if (btnEl) {
            setTimeout(() => {
                if (refreshIcon) refreshIcon.classList.remove('spin-icon');
                btnEl.disabled = false;
            }, 300);
        }
    }
}

async function clearDashboardData() {
    if (!confirm("Are you sure you want to clear all search history and dashboard chart data?")) {
        return;
    }
    try {
        const response = await fetch('/api/dashboard/clear-history', { method: 'POST' });
        const data = await response.json();
        if (response.ok && data.success) {
            alert("Search history data has been cleared successfully!");
            localStorage.removeItem(DASH_CACHE_KEY);
            dashboardAnalyticsData = null;
            loadDashboardAnalytics();
        } else {
            alert("Failed to clear data: " + (data.error || ("Server status " + response.status)));
        }
    } catch (e) {
        alert("Clear data failed: " + (e.message || e));
    }
}

function populateDashboardSelects() {
    if (!dashboardAnalyticsData) return;

    const features = [
        { key: 'audit', selectId: 'dash-audit-select' },
        { key: 'rank_tracker', selectId: 'dash-rank-select' },
        { key: 'keyword_checker', selectId: 'dash-kwcheck-select' },
        { key: 'keyword_magic', selectId: 'dash-kwmagic-select' },
        { key: 'backlink_checker', selectId: 'dash-blcheck-select' },
        { key: 'backlink_gap', selectId: 'dash-blgap-select' }
    ];

    features.forEach(f => {
        const sel = document.getElementById(f.selectId);
        if (!sel) return;
        
        const list = dashboardAnalyticsData[f.key] || [];
        const currentVal = sel.value;
        sel.innerHTML = "";

        if (list.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No search history yet";
            sel.appendChild(opt);
        } else {
            list.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item.target;
                opt.textContent = `${item.target} (${item.count} searches)`;
                sel.appendChild(opt);
            });
            if (currentVal && list.some(i => i.target === currentVal)) {
                sel.value = currentVal;
            } else {
                sel.selectedIndex = 0;
            }
        }
    });
}

function renderAllDashboardCharts() {
    renderAuditChart();
    renderRankChart();
    renderKwCheckChart();
    renderKwMagicChart();
    renderBlCheckChart();
    renderBlGapChart();
}

function calcPercentageChange(newVal, oldVal) {
    if (oldVal === undefined || oldVal === null || oldVal === 0) return 0;
    return (((newVal - oldVal) / oldVal) * 100).toFixed(1);
}

function renderEmptyCanvas(canvas, message) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#64748B';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, (canvas.width || 300) / 2, (canvas.height || 200) / 2);
}

const RUN_COLORS = [
    { solid: '#3B82F6', alpha: 'rgba(59, 130, 246, 0.85)' },
    { solid: '#10B981', alpha: 'rgba(16, 185, 129, 0.85)' },
    { solid: '#F59E0B', alpha: 'rgba(245, 158, 11, 0.85)' },
    { solid: '#8B5CF6', alpha: 'rgba(139, 92, 246, 0.85)' },
    { solid: '#EC4899', alpha: 'rgba(236, 72, 153, 0.85)' }
];

function buildCustomBarTooltipOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { color: '#94A3B8', font: { size: 11 } }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#F8FAFC',
                bodyColor: '#F1F5F9',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1,
                padding: 10,
                callbacks: {
                    title: function(context) {
                        const item = context[0];
                        const dateStr = item.dataset.searchDate || '';
                        return `${item.dataset.label}${dateStr ? ' · Date: ' + dateStr : ''}`;
                    },
                    label: function(context) {
                        const metricName = context.chart.data.labels[context.dataIndex];
                        const val = context.raw;
                        let formatted = (typeof val === 'number') ? val.toLocaleString() : (val || 0);
                        if (metricName.includes('%') || metricName.includes('Dofollow') || metricName.includes('KD')) {
                            formatted = `${val}%`;
                        } else if (metricName.includes('CPC')) {
                            formatted = `$${val}`;
                        }
                        return `${metricName}: ${formatted}`;
                    }
                }
            }
        },
        scales: {
            x: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
    };
}

function buildLogarithmicBarTooltipOptions() {
    const opts = buildCustomBarTooltipOptions();
    opts.scales = {
        x: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: {
            type: 'logarithmic',
            min: 1,
            ticks: {
                color: '#94A3B8',
                callback: function(value) {
                    if (value === 1) return '1';
                    if (value === 100) return '100';
                    if (value === 10000) return '10K';
                    if (value === 1000000) return '1M';
                    if (value === 100000000) return '100M';
                    if (value === 1000000000) return '1B';
                    return null;
                }
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
        }
    };
    return opts;
}

// 1. SEO Site Audit Chart
function renderAuditChart() {
    const sel = document.getElementById("dash-audit-select");
    const badge = document.getElementById("audit-trend-badge");
    const canvas = document.getElementById("dash-audit-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.audit) {
        dashChartInstances.audit.destroy();
        dashChartInstances.audit = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.audit) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        badge.textContent = "No history yet";
        badge.className = "metric-trend";
        renderEmptyCanvas(canvas, "No Audit Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;

    const latestScore = latest.seo_score || latest.health_score || 0;
    if (prev) {
        const prevScore = prev.seo_score || prev.health_score || 0;
        const pct = calcPercentageChange(latestScore, prevScore);
        badge.textContent = `SEO Score: ${latestScore}/100 (${pct >= 0 ? '+' : ''}${pct}% ${pct >= 0 ? '⬆️' : '⬇️'})`;
        badge.className = pct >= 0 ? "metric-trend up" : "metric-trend down";
    } else {
        badge.textContent = `SEO Score: ${latestScore}/100 (1st Run)`;
        badge.className = "metric-trend up";
    }

    const labels = ['SEO Score', 'On-Page SEO', 'Technical SEO', 'Off-Page SEO', 'Performance & UX'];
    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        return {
            label: `Run ${idx + 1}`,
            searchDate: dateStr,
            data: [
                h.seo_score || h.health_score || 0,
                h.on_page || 0,
                h.technical || 0,
                h.off_page || 0,
                h.performance || h.social || 0
            ],
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildCustomBarTooltipOptions();
    options.scales.y.max = 100;

    dashChartInstances.audit = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: options
    });
}

// 2. Rank Tracker Chart
function renderRankChart() {
    const sel = document.getElementById("dash-rank-select");
    const badge = document.getElementById("rank-trend-badge");
    const canvas = document.getElementById("dash-rank-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.rank) {
        dashChartInstances.rank.destroy();
        dashChartInstances.rank = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.rank_tracker) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        badge.textContent = "No history yet";
        badge.className = "metric-trend";
        renderEmptyCanvas(canvas, "No Rank Tracking Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const latestVis = latest.visibility !== undefined ? latest.visibility : (latest.rank > 0 ? Math.max(0, 100 - (latest.rank - 1)*8) : 0);
    const prev = history.length > 1 ? history[history.length - 2] : null;

    if (prev) {
        const prevVis = prev.visibility !== undefined ? prev.visibility : (prev.rank > 0 ? Math.max(0, 100 - (prev.rank - 1)*8) : 0);
        const pct = calcPercentageChange(latestVis, prevVis);
        badge.textContent = `Visibility: ${latestVis}% (${pct >= 0 ? '+' : ''}${pct}% ${pct >= 0 ? '⬆️' : '⬇️'})`;
        badge.className = pct >= 0 ? "metric-trend up" : "metric-trend down";
    } else {
        badge.textContent = `Visibility: ${latestVis}% (Rank #${latest.rank > 0 ? latest.rank : 'N/A'})`;
        badge.className = "metric-trend up";
    }

    const labels = ['Visibility Score %', 'Position Rank (1-30)'];
    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        const vis = h.visibility !== undefined ? h.visibility : (h.rank > 0 ? Math.max(0, 100 - (h.rank - 1)*8) : 0);
        return {
            label: `Run ${idx + 1}`,
            searchDate: dateStr,
            data: [vis, h.rank > 0 ? h.rank : 0],
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildCustomBarTooltipOptions();

    dashChartInstances.rank = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: options
    });
}

// 3. Keyword Checker Chart
function renderKwCheckChart() {
    const sel = document.getElementById("dash-kwcheck-select");
    const badge = document.getElementById("kwcheck-trend-badge");
    const canvas = document.getElementById("dash-kwcheck-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.kwcheck) {
        dashChartInstances.kwcheck.destroy();
        dashChartInstances.kwcheck = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.keyword_checker) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        badge.textContent = "No history yet";
        badge.className = "metric-trend";
        renderEmptyCanvas(canvas, "No Keyword Checker Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;

    if (prev) {
        const pct = calcPercentageChange(latest.volume, prev.volume);
        badge.textContent = `Vol: ${latest.volume.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct}%) | KD: ${latest.difficulty}%`;
        badge.className = pct >= 0 ? "metric-trend up" : "metric-trend down";
    } else {
        badge.textContent = `Vol: ${latest.volume.toLocaleString()} | KD: ${latest.difficulty}%`;
        badge.className = "metric-trend up";
    }

    const labels = ['Search Volume', 'KD %', 'CPC ($)'];
    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        return {
            label: `Run ${idx + 1}`,
            searchDate: dateStr,
            data: [
                h.volume ? Math.max(1, h.volume) : 1,
                h.difficulty ? Math.max(1, h.difficulty) : 1,
                h.cpc ? Math.max(1, h.cpc) : 1
            ],
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildLogarithmicBarTooltipOptions();

    dashChartInstances.kwcheck = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: options
    });
}

// 4. Keyword Magic Tool Chart (Top 10 Keywords Comparison Across Runs)
function renderKwMagicChart() {
    const sel = document.getElementById("dash-kwmagic-select");
    const badge = document.getElementById("kwmagic-trend-badge");
    const canvas = document.getElementById("dash-kwmagic-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.kwmagic) {
        dashChartInstances.kwmagic.destroy();
        dashChartInstances.kwmagic = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.keyword_magic) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        badge.textContent = "No history yet";
        badge.className = "metric-trend";
        renderEmptyCanvas(canvas, "No Keyword Magic Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const top10Latest = latest.top10 || [];

    if (top10Latest.length === 0) {
        badge.textContent = "No Top 10 data";
        renderEmptyCanvas(canvas, "No Keywords in History");
        return;
    }

    badge.textContent = `Seed: "${target}" | Top 10 Vol Comparison (${history.length} runs)`;
    badge.className = "metric-trend up";

    const labels = top10Latest.map(k => k.keyword || '');

    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        const runTop10Map = new Map();
        (h.top10 || []).forEach(k => {
            if (k.keyword) runTop10Map.set(k.keyword.toLowerCase(), k.volume || 0);
        });

        const volumes = top10Latest.map(k => {
            const kwKey = (k.keyword || '').toLowerCase();
            return runTop10Map.has(kwKey) ? runTop10Map.get(kwKey) : (k.volume || 0);
        });

        return {
            label: `Run ${idx + 1}`,
            searchDate: dateStr,
            data: volumes,
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildCustomBarTooltipOptions();
    options.plugins.legend.display = true;
    options.scales.x = {
        ticks: {
            color: '#94A3B8',
            font: { size: 10 },
            maxRotation: 35,
            minRotation: 15,
            autoSkip: false
        },
        grid: { color: 'rgba(255,255,255,0.04)' }
    };

    dashChartInstances.kwmagic = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: options
    });
}

// 5. Backlink Checker Chart
function renderBlCheckChart() {
    const sel = document.getElementById("dash-blcheck-select");
    const badge = document.getElementById("blcheck-trend-badge");
    const canvas = document.getElementById("dash-blcheck-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.blcheck) {
        dashChartInstances.blcheck.destroy();
        dashChartInstances.blcheck = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.backlink_checker) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        badge.textContent = "No history yet";
        badge.className = "metric-trend";
        renderEmptyCanvas(canvas, "No Backlink Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;

    if (prev) {
        const delta = latest.authority_score - prev.authority_score;
        const pct = calcPercentageChange(latest.backlinks_raw, prev.backlinks_raw);
        badge.textContent = `AS: ${latest.authority_score} | Backlinks: ${latest.backlinks || latest.backlinks_raw.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct}%)`;
        badge.className = delta >= 0 ? "metric-trend up" : "metric-trend down";
    } else {
        badge.textContent = `AS: ${latest.authority_score}/100 | Backlinks: ${latest.backlinks || latest.backlinks_raw.toLocaleString()}`;
        badge.className = "metric-trend up";
    }

    const labels = ['Authority Score', 'Total Backlinks', 'Referring Domains', 'Dofollow %'];
    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        return {
            label: `Run ${idx + 1}`,
            searchDate: dateStr,
            data: [
                h.authority_score ? Math.max(1, h.authority_score) : 1,
                h.backlinks_raw ? Math.max(1, h.backlinks_raw) : 1,
                h.referring_domains_raw ? Math.max(1, h.referring_domains_raw) : 1,
                h.dofollow_backlinks_raw ? Math.max(1, h.dofollow_backlinks_raw) : 1
            ],
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildLogarithmicBarTooltipOptions();

    dashChartInstances.blcheck = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: options
    });
}

// 6. Backlink Gap Chart
function renderBlGapChart() {
    const sel = document.getElementById("dash-blgap-select");
    const badge = document.getElementById("dash-blgap-select"); // keep badge update safe
    const trendBadge = document.getElementById("blgap-trend-badge");
    const canvas = document.getElementById("dash-blgap-chart");
    if (!sel || !canvas) return;

    if (dashChartInstances.blgap) {
        dashChartInstances.blgap.destroy();
        dashChartInstances.blgap = null;
    }

    const target = sel.value;
    const featList = (dashboardAnalyticsData && dashboardAnalyticsData.backlink_gap) || [];
    const item = featList.find(i => i.target === target);

    if (!target || !item || !item.history || item.history.length === 0) {
        if (trendBadge) {
            trendBadge.textContent = "No history yet";
            trendBadge.className = "metric-trend";
        }
        renderEmptyCanvas(canvas, "No Backlink Gap Data Yet");
        return;
    }

    const history = item.history;
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;

    if (trendBadge) {
        if (prev) {
            const delta = latest.gaps_count - prev.gaps_count;
            const pct = calcPercentageChange(latest.gaps_count, prev.gaps_count);
            trendBadge.textContent = `Gap Opportunities: ${latest.gaps_count} (${pct >= 0 ? '+' : ''}${pct}%)`;
            trendBadge.className = delta <= 0 ? "metric-trend up" : "metric-trend down";
        } else {
            trendBadge.textContent = `Gap Opportunities: ${latest.gaps_count} domains`;
            trendBadge.className = "metric-trend up";
        }
    }

    const labels = ['Authority Score', 'Total Backlinks', 'Referring Domains', 'Dofollow %'];
    const datasets = history.map((h, idx) => {
        const color = RUN_COLORS[idx % RUN_COLORS.length];
        const dateStr = h.created_at || '';
        const matrix = h.comparison || [];
        const targetObj = matrix[0] || {};
        return {
            label: `Run ${idx + 1} (${targetObj.domain || h.target || 'Target'})`,
            searchDate: dateStr,
            data: [
                targetObj.authority_score ? Math.max(1, targetObj.authority_score) : 1,
                targetObj.backlinks_raw ? Math.max(1, targetObj.backlinks_raw) : 1,
                targetObj.referring_domains_raw ? Math.max(1, targetObj.referring_domains_raw) : 1,
                targetObj.dofollow_raw ? Math.max(1, targetObj.dofollow_raw) : 1
            ],
            backgroundColor: color.alpha,
            borderColor: color.solid,
            borderWidth: 1,
            borderRadius: 4
        };
    });

    const options = buildLogarithmicBarTooltipOptions();

    dashChartInstances.blgap = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: options
    });
}

let dashboardCache = loadDashboardCache();
let dashTrendChart = null;
let dashCountryChart = null;

function updateDashboard() {
    const c = dashboardCache;

    // Metric card 1: Global Search Volume
    const volEl = document.getElementById("dash-global-volume");
    const volTrend = document.getElementById("dash-volume-trend");
    if (c.globalVolume !== undefined) {
        volEl.textContent = Number(c.globalVolume).toLocaleString();
        volTrend.innerHTML = `<i data-lucide="globe" style="width:12px;height:12px;"></i> ${c.lastKeyword || "Last checked"}`;
        volTrend.classList.add("up");
    }

    // Metric card 2: Keywords Tracked
    const kwEl = document.getElementById("dash-keywords-count");
    const kwTrend = document.getElementById("dash-kw-trend");
    if (c.keywordsCount !== undefined) {
        kwEl.textContent = c.keywordsCount.toLocaleString();
        kwTrend.textContent = c.lastSeedKeyword ? `Seed: ${c.lastSeedKeyword}` : "From Keyword Magic";
    }

    // Metric card 3: Backlinks Analyzed
    const blEl = document.getElementById("dash-backlinks-count");
    const blTrend = document.getElementById("dash-bl-trend");
    if (c.backlinksCount !== undefined) {
        blEl.textContent = c.backlinksCount.toLocaleString();
        blTrend.textContent = c.lastBacklinkDomain ? c.lastBacklinkDomain : "From Backlink Checker";
    }

    // Metric card 4: SEO Score
    const seoEl = document.getElementById("dash-seo-score");
    const seoTrend = document.getElementById("dash-seo-trend");
    if (c.seoScore !== undefined) {
        seoEl.textContent = c.seoScore + "/100";
        seoTrend.textContent = c.lastAuditUrl || "From SEO Audit";
        if (c.seoScore >= 80) seoTrend.classList.add("up");
        else if (c.seoScore < 50) seoTrend.classList.add("down");
    }

    // GSC section
    if (c.gscData) {
        const gscSection = document.getElementById("dash-gsc-section");
        gscSection.style.display = "block";
        document.getElementById("dash-gsc-clicks").textContent = Number(c.gscData.clicks || 0).toLocaleString();
        document.getElementById("dash-gsc-impressions").textContent = Number(c.gscData.impressions || 0).toLocaleString();
        document.getElementById("dash-gsc-ctr").textContent = (c.gscData.ctr || 0).toFixed(2) + "%";
        document.getElementById("dash-gsc-position").textContent = (c.gscData.position || 0).toFixed(1);
    }

    // Charts
    renderDashboardTrendChart(c.trendData);
    renderDashboardCountryChart(c.countrySplit);

    // Recent Keywords Table
    renderDashboardKeywordsTable(c.recentKeywords);

    lucide.createIcons();
}

function renderDashboardTrendChart(trendData) {
    const ctx = document.getElementById("dash-trend-chart");
    if (!ctx) return;

    if (dashTrendChart) {
        dashTrendChart.destroy();
        dashTrendChart = null;
    }

    let labels, dataPoints;
    if (trendData && trendData.length > 0) {
        labels = trendData.map(d => d.label || d.date || "");
        dataPoints = trendData.map(d => d.value || d.volume || 0);
    } else {
        // Empty state - show flat placeholder
        labels = Array.from({length: 30}, (_, i) => `Day ${i+1}`);
        dataPoints = Array(30).fill(0);
    }

    dashTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Search Volume",
                data: dataPoints,
                borderColor: "#3B82F6",
                backgroundColor: "rgba(59, 130, 246, 0.08)",
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    display: true,
                    ticks: { color: "#94A3B8", maxTicksLimit: 7, font: { size: 10 } },
                    grid: { color: "rgba(255,255,255,0.04)" }
                },
                y: {
                    display: true,
                    ticks: { color: "#94A3B8", font: { size: 10 } },
                    grid: { color: "rgba(255,255,255,0.04)" }
                }
            }
        }
    });
}

function renderDashboardCountryChart(countrySplit) {
    const ctx = document.getElementById("dash-country-chart");
    if (!ctx) return;

    if (dashCountryChart) {
        dashCountryChart.destroy();
        dashCountryChart = null;
    }

    let labels, dataPoints, bgColors;
    const palette = [
        "rgba(59,130,246,0.8)", "rgba(139,92,246,0.8)", "rgba(16,185,129,0.8)",
        "rgba(245,158,11,0.8)", "rgba(239,68,68,0.8)", "rgba(236,72,153,0.8)",
        "rgba(14,165,233,0.8)"
    ];

    if (countrySplit && countrySplit.length > 0) {
        const top7 = countrySplit.slice(0, 7);
        labels = top7.map(c => c.country || c.code);
        dataPoints = top7.map(c => c.volume || 0);
        bgColors = palette.slice(0, top7.length);
    } else {
        labels = ["No Data"];
        dataPoints = [0];
        bgColors = ["rgba(255,255,255,0.05)"];
    }

    dashCountryChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                label: "Search Volume",
                data: dataPoints,
                backgroundColor: bgColors,
                borderRadius: 6,
                barThickness: 28,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: "#94A3B8", font: { size: 10 } },
                    grid: { color: "rgba(255,255,255,0.04)" }
                },
                y: {
                    ticks: { color: "#E2E8F0", font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderDashboardKeywordsTable(keywords) {
    const tbody = document.getElementById("dash-keywords-tbody");
    if (!tbody) return;

    if (!keywords || keywords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--color-text-muted); padding: 40px 0;">No keyword data yet. Use <a href="javascript:void(0)" onclick="switchTab(\'keyword-magic-tab\')">Keyword Magic Tool</a> to get started.</td></tr>';
        return;
    }

    tbody.innerHTML = "";
    const top10 = keywords.slice(0, 10);
    top10.forEach(item => {
        const tr = document.createElement("tr");
        const kd = item.difficulty || 0;
        let dotColor = "var(--success)";
        if (kd >= 70) dotColor = "var(--danger)";
        else if (kd >= 40) dotColor = "var(--warning)";

        let badgeClass = "badge-info";
        const intent = (item.intent || "").toLowerCase();
        if (intent.includes("transactional")) badgeClass = "badge-success";
        else if (intent.includes("commercial")) badgeClass = "badge-purple";
        else if (intent.includes("navigational")) badgeClass = "badge-warning";

        tr.innerHTML = `
            <td class="text-bright" style="font-weight:500;">${item.keyword}</td>
            <td class="text-right">${(item.volume || 0).toLocaleString()}</td>
            <td class="text-right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};margin-right:4px;"></span>${kd}%</td>
            <td><span class="badge ${badgeClass}">${item.intent || "-"}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Lucide Icons
    lucide.createIcons();
    
    // Check login status
    checkAuthStatus();

    // Restore dashboard from local cache first for instant UX
    updateDashboard();

    // Fetch cloud dashboard data from backend server for cross-device sync
    loadDashboardServer();

    loadDashboardAnalytics();
});

// Mobile Navigation Drawer Toggle Helpers
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active');
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
}

// Tab switching logic
function switchTab(tabId) {
    closeMobileSidebar();
    document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.remove("active");
    });
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.remove("active");
    });
    
    const targetPanel = document.getElementById(tabId);
    if (targetPanel) {
        targetPanel.classList.add("active");
    }
    
    // Highlight active button
    const activeBtn = Array.from(document.querySelectorAll(".nav-item")).find(btn => 
        btn.getAttribute("onclick").includes(tabId)
    );
    if (activeBtn) {
        activeBtn.classList.add("active");
        
        // Update header title
        const titleSpan = activeBtn.querySelector("span");
        document.getElementById("page-title").textContent = titleSpan.textContent;
    }

    // Refresh dashboard when switching to it (load latest from cloud server)
    if (tabId === "dashboard-tab") {
        dashboardCache = loadDashboardCache();
        updateDashboard();
        loadDashboardServer();
        loadDashboardAnalytics();
    }
}

// Check Google Auth Status
async function checkAuthStatus() {
    try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();
        
        const badgeContainer = document.getElementById("auth-status-container");
        
        if (data.authenticated) {
            // Logged in, update status
            badgeContainer.innerHTML = `<span class="auth-badge online"><i class="dot"></i> GSC Connected</span>`;
            document.getElementById("gsc-unauth").style.display = "none";
            document.getElementById("gsc-auth").style.display = "block";
            
            // Fetch GSC site list
            loadGSCSites();
        } else {
            // Not logged in
            badgeContainer.innerHTML = `<span class="auth-badge offline"><i class="dot"></i> GSC Offline</span>`;
            document.getElementById("gsc-unauth").style.display = "flex";
            document.getElementById("gsc-auth").style.display = "none";
        }
        lucide.createIcons();
    } catch (e) {
        console.error("Failed to detect auth status: ", e);
    }
}

// Disconnect Google
async function logoutGoogle() {
    if (confirm("Are you sure you want to disconnect from Google Search Console?")) {
        await fetch("/api/auth/logout");
        checkAuthStatus();
    }
}

// Fetch GSC site list
async function loadGSCSites() {
    const selectEl = document.getElementById("gsc-site-select");
    selectEl.innerHTML = '<option value="">Loading site list...</option>';
    
    try {
        const response = await fetch("/api/gsc/sites");
        const data = await response.json();
        
        if (data.error) {
            selectEl.innerHTML = '<option value="">Loading failed, please log in and authorize again.</option>';
            return;
        }
        
        const sites = data.siteEntry || [];
        if (sites.length === 0) {
            selectEl.innerHTML = '<option value="">No verified websites found</option>';
            return;
        }
        
        selectEl.innerHTML = '<option value="">-- Please select your website --</option>';
        sites.forEach(site => {
            const opt = document.createElement("option");
            opt.value = site.siteUrl;
            opt.textContent = site.siteUrl;
            selectEl.appendChild(opt);
        });
    } catch (e) {
        console.error("Failed to fetch site list: ", e);
        selectEl.innerHTML = '<option value="">Network error</option>';
    }
}

// Load GSC reports and charts
async function loadGSCDashboard() {
    const siteUrl = document.getElementById("gsc-site-select").value;
    if (!siteUrl) return;
    
    // Show table loading state
    document.querySelector("#gsc-queries-table tbody").innerHTML = '<tr><td colspan="5" class="text-center">Loading keyword data...</td></tr>';
    document.querySelector("#gsc-pages-table tbody").innerHTML = '<tr><td colspan="5" class="text-center">Loading page data...</td></tr>';
    
    try {
        const response = await fetch(`/api/gsc/report?site_url=${encodeURIComponent(siteUrl)}`);
        const data = await response.json();
        
        if (data.error) {
            alert("Failed to fetch data: " + data.error);
            return;
        }
        
        // 1. Summarize basic metrics (Clicks, Impressions, CTR, Position)
        let totalClicks = 0;
        let totalImpressions = 0;
        let sumCTR = 0;
        let sumPosition = 0;
        const trendRows = data.trend || [];
        
        trendRows.forEach(row => {
            totalClicks += row.clicks || 0;
            totalImpressions += row.impressions || 0;
            sumCTR += row.ctr || 0;
            sumPosition += row.position || 0;
        });
        
        const count = trendRows.length || 1;
        const avgCTR = (sumCTR / count * 100).toFixed(2) + "%";
        const avgPos = (sumPosition / count).toFixed(1);
        
        document.getElementById("metric-clicks").textContent = totalClicks.toLocaleString();
        document.getElementById("metric-impressions").textContent = totalImpressions.toLocaleString();
        document.getElementById("metric-ctr").textContent = avgCTR;
        document.getElementById("metric-position").textContent = avgPos;

        // Save GSC data to dashboard cache
        dashboardCache.gscData = {
            clicks: totalClicks,
            impressions: totalImpressions,
            ctr: parseFloat((sumCTR / count * 100).toFixed(2)),
            position: parseFloat((sumPosition / count).toFixed(1))
        };
        saveDashboardCache(dashboardCache);
        
        // 2. Plot Chart.js trend line chart
        renderTrendChart(trendRows);
        
        // 3. Render Top Queries table
        const queriesTableBody = document.querySelector("#gsc-queries-table tbody");
        queriesTableBody.innerHTML = "";
        const queryRows = data.queries || [];
        if (queryRows.length === 0) {
            queriesTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No keyword data available</td></tr>';
        } else {
            queryRows.forEach(row => {
                const tr = document.createElement("tr");
                const ctrPercent = ((row.ctr || 0) * 100).toFixed(1) + "%";
                const posVal = (row.position || 0).toFixed(1);
                
                tr.innerHTML = `
                    <td class="text-bright"><strong>${row.keys[0]}</strong></td>
                    <td class="text-right">${row.clicks.toLocaleString()}</td>
                    <td class="text-right">${row.impressions.toLocaleString()}</td>
                    <td class="text-right">${ctrPercent}</td>
                    <td class="text-right text-warning">${posVal}</td>
                `;
                queriesTableBody.appendChild(tr);
            });
        }

        // 4. Render Top Pages table
        const pagesTableBody = document.querySelector("#gsc-pages-table tbody");
        pagesTableBody.innerHTML = "";
        const pageRows = data.pages || [];
        if (pageRows.length === 0) {
            pagesTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No page data available</td></tr>';
        } else {
            pageRows.forEach(row => {
                const tr = document.createElement("tr");
                const ctrPercent = ((row.ctr || 0) * 100).toFixed(1) + "%";
                const posVal = (row.position || 0).toFixed(1);
                const displayUrl = row.keys[0].replace(/https?:\/\/(www\.)?/, "");
                
                tr.innerHTML = `
                    <td title="${row.keys[0]}"><a href="${row.keys[0]}" target="_blank">${displayUrl}</a></td>
                    <td class="text-right">${row.clicks.toLocaleString()}</td>
                    <td class="text-right">${row.impressions.toLocaleString()}</td>
                    <td class="text-right">${ctrPercent}</td>
                    <td class="text-right text-warning">${posVal}</td>
                `;
                pagesTableBody.appendChild(tr);
            });
        }
        
    } catch (e) {
        console.error("Failed to load dashboard data: ", e);
        alert("Network timeout or backend API exception");
    }
}

// Plot Chart.js
function renderTrendChart(rows) {
    // Sort data chronologically
    const sortedRows = [...rows].sort((a, b) => new Date(a.keys[0]) - new Date(b.keys[0]));
    
    const labels = sortedRows.map(r => r.keys[0].substring(5)); // Only take MM-DD format
    const clicksData = sortedRows.map(r => r.clicks);
    const impressionsData = sortedRows.map(r => r.impressions);
    
    if (gscChart) {
        gscChart.destroy();
    }
    
    const ctx = document.getElementById("gsc-trend-chart").getContext("2d");
    gscChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Clicks',
                    data: clicksData,
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    yAxisID: 'y-clicks',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Impressions',
                    data: impressionsData,
                    borderColor: '#10B981',
                    backgroundColor: 'transparent',
                    yAxisID: 'y-impressions',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#94A3B8', font: { family: 'Inter' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94A3B8' }
                },
                'y-clicks': {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#3B82F6' },
                    title: { display: true, text: 'Clicks', color: '#3B82F6' }
                },
                'y-impressions': {
                    type: 'linear',
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: '#10B981' },
                    title: { display: true, text: 'Impressions', color: '#10B981' }
                }
            }
        }
    });
}

// TAB 2: Run SerpApi Rank Tracking
async function runRankTracker() {
    const keyword = document.getElementById("serp-keyword").value.trim();
    const domain = document.getElementById("serp-domain").value.trim();
    
    if (!keyword || !domain) {
        alert("Please enter keywords and the domain to track!");
        return;
    }
    
    const loader = document.getElementById("rank-loader");
    const resultsPanel = document.getElementById("rank-results");
    
    loader.style.display = "flex";
    resultsPanel.style.display = "none";
    
    try {
        const response = await fetch(`/api/serp/track?keyword=${encodeURIComponent(keyword)}&domain=${encodeURIComponent(domain)}`);
        const data = await response.json();
        
        loader.style.display = "none";
        resultsPanel.style.display = "block";
        
        if (data.error) {
            alert("SerpApi tracking failed: " + data.error);
            return;
        }
        
        // Render rank number
        const rankNum = data.rank;
        const rankEl = document.getElementById("rank-number");
        const statusDescEl = document.getElementById("rank-status-desc");
        
        if (rankNum > 0) {
            rankEl.textContent = `#${rankNum}`;
            rankEl.className = "text-success";
            rankEl.style.color = "#10B981";
            statusDescEl.textContent = `Congratulations! Your page is ranked at position #${rankNum} on Google.com.`;
        } else {
            rankEl.textContent = "N/A";
            rankEl.className = "text-warning";
            rankEl.style.color = "#F59E0B";
            statusDescEl.textContent = "Not in the top 100 organic search results on Google. Suggest optimizing your page!";
        }
        
        // Bind card information
        document.getElementById("res-kw").textContent = keyword;
        document.getElementById("res-domain").textContent = domain;
        
        const urlLink = document.getElementById("res-url");
        if (data.target_url) {
            urlLink.textContent = data.target_url;
            urlLink.href = data.target_url;
        } else {
            urlLink.textContent = "No matching ranked page";
            urlLink.href = "#";
        }
        
        // Render ads list
        const adsCard = document.getElementById("res-ads-card");
        const adsList = document.getElementById("res-ads-list");
        adsList.innerHTML = "";
        
        const adsData = data.ads || [];
        if (adsData.length > 0) {
            adsCard.style.display = "block";
            adsData.forEach(ad => {
                const item = document.createElement("div");
                item.className = "ad-item";
                item.innerHTML = `
                    <div class="ad-title">${ad.title}</div>
                    <div class="ad-link">${ad.displayed_link || ad.tracking_link}</div>
                    <div class="ad-desc">${ad.description || ''}</div>
                `;
                adsList.appendChild(item);
            });
        } else {
            adsCard.style.display = "none";
        }
        
        // Render organic search results (Highlight our target website)
        const organicList = document.getElementById("res-organic-list");
        organicList.innerHTML = "";
        const organicData = data.organic_results || [];
        
        organicData.forEach(item => {
            const isTarget = item.link.toLowerCase().includes(domain.toLowerCase());
            const div = document.createElement("div");
            div.className = `serp-item ${isTarget ? 'highlighted' : ''}`;
            
            div.innerHTML = `
                <div class="serp-header">
                    <span class="serp-pos">${item.position}</span>
                    <span class="serp-title text-bright">${item.title}</span>
                </div>
                <div class="serp-link">${item.link}</div>
                <div class="serp-desc">${item.snippet || 'No page description snippet'}</div>
            `;
            organicList.appendChild(div);
        });
        
        // People Also Ask (PAA)
        const paaCard = document.getElementById("res-paa-card");
        const paaList = document.getElementById("res-paa-list");
        paaList.innerHTML = "";
        const paaData = data.people_also_ask || [];
        if (paaData.length > 0) {
            paaCard.style.display = "block";
            paaData.forEach(p => {
                const div = document.createElement("div");
                div.className = "paa-item";
                div.innerHTML = `<strong>Q: ${p.question}</strong><br><small style="color:var(--color-text-muted)">A: ${p.snippet || 'No direct summary'}</small>`;
                paaList.appendChild(div);
            });
        } else {
            paaCard.style.display = "none";
        }
        
        // Related searches
        const relatedCard = document.getElementById("res-related-card");
        const relatedList = document.getElementById("res-related-list");
        relatedList.innerHTML = "";
        const relatedData = data.related_searches || [];
        if (relatedData.length > 0) {
            relatedCard.style.display = "block";
            relatedData.forEach(r => {
                const span = document.createElement("span");
                span.className = "tag";
                span.textContent = r.query;
                span.style.cursor = "pointer";
                span.onclick = () => {
                    document.getElementById("serp-keyword").value = r.query;
                    runRankTracker();
                };
                relatedList.appendChild(span);
            });
        } else {
            relatedCard.style.display = "none";
        }
        
    } catch (e) {
        console.error("Tracking failed: ", e);
        loader.style.display = "none";
        alert("Network request failed, please make sure the local service is running.");
    }
}

// TAB 3: AI Search Intent Classifier
async function runIntentClassifier() {
    const textVal = document.getElementById("intent-keywords").value.trim();
    if (!textVal) {
        alert("Please enter at least one keyword to classify!");
        return;
    }
    
    // Parse into keywords array
    const keywords = textVal.split("\n").map(k => k.trim()).filter(k => k.length > 0);
    
    const loader = document.getElementById("intent-loader");
    const resultCard = document.getElementById("intent-results-card");
    const tbody = document.getElementById("intent-tbody");
    
    loader.style.display = "flex";
    resultCard.style.display = "none";
    tbody.innerHTML = "";
    
    try {
        const response = await fetch("/api/ai/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keywords })
        });
        const data = await response.json();
        
        loader.style.display = "none";
        resultCard.style.display = "block";
        
        if (data.error) {
            alert("Intent classification error: " + data.error);
            return;
        }
        
        // Handle irregular response structure
        const items = Array.isArray(data) ? data : (data.raw_response ? [] : []);
        if (data.raw_response) {
            // Fallback when parsing fails
            tbody.innerHTML = `<tr><td colspan="3" class="text-warning">Model response is not in the correct format, raw response is: <br><pre style="white-space:pre-wrap;color:var(--color-text-muted)">${data.raw_response}</pre></td></tr>`;
            return;
        }
        
        items.forEach(item => {
            const tr = document.createElement("tr");
            let badgeClass = "badge-info";
            
            const intent = item.intent.toLowerCase();
            if (intent.includes("informational")) {
                badgeClass = "badge-info";
            } else if (intent.includes("transactional")) {
                badgeClass = "badge-success";
            } else if (intent.includes("commercial")) {
                badgeClass = "badge-purple";
            } else if (intent.includes("navigational")) {
                badgeClass = "badge-warning";
            }
            
            tr.innerHTML = `
                <td class="text-bright"><strong>${item.keyword}</strong></td>
                <td><span class="badge ${badgeClass}">${item.intent}</span></td>
                <td style="white-space: normal; max-width: 400px; color: var(--color-text-muted)">${item.reason}</td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Intent classification network request failed.");
    }
}

// TAB 4: AI Content Brief
let cachedBriefText = "";
async function runContentBrief() {
    const keyword = document.getElementById("brief-keyword").value.trim();
    if (!keyword) {
        alert("Please enter the core keyword you want to analyze!");
        return;
    }
    
    const loader = document.getElementById("brief-loader");
    const resultCard = document.getElementById("brief-results-card");
    const mdContainer = document.getElementById("brief-markdown-content");
    
    loader.style.display = "flex";
    resultCard.style.display = "none";
    mdContainer.innerHTML = "";
    
    try {
        // Step 1: Call SerpApi to get top 5 article titles
        const serpRes = await fetch(`/api/serp/track?keyword=${encodeURIComponent(keyword)}&domain=dummy_no_match.com`);
        const serpData = await serpRes.json();
        
        const serpTitles = (serpData.organic_results || []).slice(0, 5).map(o => o.title);
        
        // Step 2: Pack titles and keywords, request Gemini planning endpoint
        const briefRes = await fetch("/api/ai/brief", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                keyword: keyword,
                serp_titles: serpTitles
            })
        });
        const briefData = await briefRes.json();
        
        loader.style.display = "none";
        resultCard.style.display = "block";
        
        if (briefData.error) {
            mdContainer.innerHTML = `<span class="text-danger">Generation error: ${briefData.error}</span>`;
            return;
        }
        
        // Step 3: Render Markdown to HTML and display
        cachedBriefText = briefData.brief;
        mdContainer.innerHTML = marked.parse(briefData.brief);
        
        // Show Website Builder Add-on Card
        const builderActionCard = document.getElementById("brief-builder-action-card");
        if (builderActionCard) {
            builderActionCard.style.display = "block";
        }
        
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Network timeout or outline generation failed.");
    }
}

function copyBriefText() {
    if (!cachedBriefText) return;
    navigator.clipboard.writeText(cachedBriefText).then(() => {
        alert("Successfully copied the brief Markdown text!");
    }).catch(err => {
        alert("Copy failed: " + err);
    });
}

// WEBSITE BUILDER ADD-ON FOR CONTENT BRIEF
let cachedLandingHTML = "";
let cachedLandingKeyword = "";
let uploadedLandingFilesMap = {};

async function handleLandingFilesUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files || files.length === 0) return;

    for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
            alert(`File ${file.name} exceeds 10MB limit.`);
            continue;
        }

        try {
            const text = await readFileAsText(file);
            uploadedLandingFilesMap[file.name] = text;
        } catch (e) {
            console.error(`Error reading ${file.name}:`, e);
        }
    }

    if (event.target) event.target.value = '';
    renderUploadedLandingFilesUI();
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsText(file);
    });
}

function removeSingleLandingFile(filename, event) {
    if (event) event.stopPropagation();
    delete uploadedLandingFilesMap[filename];
    renderUploadedLandingFilesUI();
}

function renderUploadedLandingFilesUI() {
    const placeholder = document.getElementById("landing-upload-placeholder");
    const filesList = document.getElementById("landing-upload-files-list");
    const badgesContainer = document.getElementById("landing-files-badges");
    const textarea = document.getElementById("landing-existing-code");

    const filenames = Object.keys(uploadedLandingFilesMap);

    if (filenames.length === 0) {
        if (placeholder) placeholder.style.display = "flex";
        if (filesList) filesList.style.display = "none";
        if (textarea) textarea.value = "";
        return;
    }

    if (placeholder) placeholder.style.display = "none";
    if (filesList) filesList.style.display = "flex";

    if (badgesContainer) {
        badgesContainer.innerHTML = filenames.map(name => `
            <span class="badge badge-accent" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 0.82rem; border-radius: 8px;">
                <i data-lucide="file-code" style="width: 14px; height: 14px;"></i>
                <strong>${escapeHtml(name)}</strong>
                <button type="button" style="background: none; border: none; color: currentColor; cursor: pointer; padding: 0; margin-left: 4px; display: flex; align-items: center;" onclick="removeSingleLandingFile('${escapeHtml(name).replace(/'/g, "\\'")}', event)" title="Remove ${escapeHtml(name)}">
                    <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                </button>
            </span>
        `).join("");
        if (window.lucide) lucide.createIcons();
    }

    if (textarea) {
        let combined = "";
        for (const [name, content] of Object.entries(uploadedLandingFilesMap)) {
            combined += `/* === FILE: ${name} === */\n${content}\n\n`;
        }
        textarea.value = combined;
    }
}

function clearLandingFiles(event) {
    if (event) event.stopPropagation();
    uploadedLandingFilesMap = {};
    const fileInput = document.getElementById("landing-existing-file");
    if (fileInput) fileInput.value = "";
    
    renderUploadedLandingFilesUI();
}

async function generateLandingPage() {
    if (!cachedBriefText) {
        alert("Please generate a Content Brief first!");
        return;
    }
    
    const keywordInput = document.getElementById("brief-keyword");
    const keyword = keywordInput ? keywordInput.value.trim() : "Landing Page";
    const styleSelect = document.getElementById("landing-style-select");
    const selectedStyle = styleSelect ? styleSelect.value : "random";
    
    const existingCodeInput = document.getElementById("landing-existing-code");
    const existingCode = existingCodeInput ? existingCodeInput.value.trim() : "";
    
    const loader = document.getElementById("landing-loader");
    const loaderText = document.getElementById("landing-loader-text");
    const resultsCard = document.getElementById("landing-results-card");
    const styleBadge = document.getElementById("landing-style-badge");
    const iframe = document.getElementById("landing-iframe");
    const codeBlock = document.getElementById("landing-code-block");
    
    if (loaderText) {
        if (existingCode) {
            loaderText.innerText = `AI is analyzing your existing website code & enhancing layout, styling and content structure...`;
        } else {
            loaderText.innerText = `AI is designing Landing Page HTML, layout architecture & custom CSS styling...`;
        }
    }
    
    loader.style.display = "flex";
    resultsCard.style.display = "none";
    
    try {
        const response = await fetch("/api/ai/landing_page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                brief_content: cachedBriefText,
                keyword: keyword,
                style_preset: selectedStyle,
                existing_code: existingCode
            })
        });
        
        const data = await response.json();
        loader.style.display = "none";
        
        if (data.error) {
            alert("Landing Page generation failed: " + data.error);
            return;
        }
        
        cachedLandingHTML = data.html;
        cachedLandingKeyword = data.keyword || keyword;
        
        // Update Style Badge
        if (styleBadge) {
            styleBadge.innerText = `Style: ${data.style_name}`;
        }
        
        // Render to iframe
        if (iframe) {
            iframe.srcdoc = data.html;
        }
        
        // Populate code container
        if (codeBlock) {
            codeBlock.textContent = data.html;
        }
        
        resultsCard.style.display = "block";
        switchLandingPageViewMode('preview');
        
        if (window.lucide) {
            lucide.createIcons();
        }
        
        // Smooth scroll to results
        resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Network error or timeout when generating Landing Page.");
    }
}

function switchLandingPageViewMode(mode) {
    const previewWrapper = document.getElementById("landing-preview-wrapper");
    const codeWrapper = document.getElementById("landing-code-wrapper");
    const btnPreview = document.getElementById("btn-view-preview");
    const btnCode = document.getElementById("btn-view-code");
    const deviceToggleGroup = document.getElementById("device-toggle-group");
    
    if (mode === 'preview') {
        if (previewWrapper) previewWrapper.style.display = "block";
        if (codeWrapper) codeWrapper.style.display = "none";
        if (btnPreview) btnPreview.classList.add("active");
        if (btnCode) btnCode.classList.remove("active");
        if (deviceToggleGroup) deviceToggleGroup.style.display = "inline-flex";
    } else {
        if (previewWrapper) previewWrapper.style.display = "none";
        if (codeWrapper) codeWrapper.style.display = "block";
        if (btnPreview) btnPreview.classList.remove("active");
        if (btnCode) btnCode.classList.add("active");
        if (deviceToggleGroup) deviceToggleGroup.style.display = "none";
    }
}

function setDevicePreview(device) {
    const previewWrapper = document.getElementById("landing-preview-wrapper");
    const btnDesktop = document.getElementById("btn-dev-desktop");
    const btnMobile = document.getElementById("btn-dev-mobile");
    
    if (!previewWrapper) return;
    
    if (device === 'mobile') {
        previewWrapper.classList.remove("desktop-view");
        previewWrapper.classList.add("mobile-view");
        if (btnDesktop) btnDesktop.classList.remove("active");
        if (btnMobile) btnMobile.classList.add("active");
    } else {
        previewWrapper.classList.remove("mobile-view");
        previewWrapper.classList.add("desktop-view");
        if (btnDesktop) btnDesktop.classList.add("active");
        if (btnMobile) btnMobile.classList.remove("active");
    }
}

function copyLandingPageCode() {
    if (!cachedLandingHTML) return;
    navigator.clipboard.writeText(cachedLandingHTML).then(() => {
        alert("Landing Page HTML code copied to clipboard!");
    }).catch(err => {
        alert("Copy failed: " + err);
    });
}

function downloadLandingPageHTML() {
    if (!cachedLandingHTML) return;
    const blob = new Blob([cachedLandingHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = `landing-page-${(cachedLandingKeyword || 'export').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function openLandingPageNewTab() {
    if (!cachedLandingHTML) return;
    const win = window.open("", "_blank");
    if (win) {
        win.document.write(cachedLandingHTML);
        win.document.close();
    }
}


// TAB 5: AI Meta Optimizer
async function runMetaOptimizer() {
    const url = document.getElementById("meta-url").value.trim();
    const topic = document.getElementById("meta-topic").value.trim();
    const title = document.getElementById("meta-title").value.trim();
    const desc = document.getElementById("meta-desc").value.trim();
    
    if (!topic) {
        alert("Please enter a core theme/keyword to help AI optimize!");
        return;
    }
    
    const loader = document.getElementById("meta-loader");
    const resultsGrid = document.getElementById("meta-results-grid");
    
    loader.style.display = "flex";
    resultsGrid.style.display = "none";
    
    try {
        const response = await fetch("/api/ai/optimize_meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, topic, title, description: desc })
        });
        const data = await response.json();
        
        loader.style.display = "none";
        resultsGrid.style.display = "grid";
        
        if (data.error) {
            alert("AI Meta optimization error: " + data.error);
            return;
        }
        
        // Bind data before optimization
        document.getElementById("meta-old-title").textContent = title || "[Empty Title]";
        document.getElementById("meta-old-desc").textContent = desc || "[Empty Description]";
        
        // Bind optimized data
        if (data.raw_response) {
            // Case when JSON parsing fails
            document.getElementById("meta-new-title").textContent = "Parsing failed, view raw content";
            document.getElementById("meta-new-desc").textContent = "";
            document.getElementById("meta-explanation").textContent = data.raw_response;
        } else {
            document.getElementById("meta-new-title").textContent = data.optimized_title;
            document.getElementById("meta-new-desc").textContent = data.optimized_description;
            document.getElementById("meta-explanation").textContent = data.optimizations_explanation;
        }
        
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Network anomaly, optimization failed.");
    }
}

/* ========================================================
   Keyword Checker, Keyword Magic & SEO Website Audit Logics
   ======================================================== */

async function runKeywordChecker(kw = null) {
    let keyword = kw;
    if (!keyword) {
        keyword = document.getElementById("kwcheck-input").value.trim();
    } else {
        document.getElementById("kwcheck-input").value = keyword;
    }
    
    if (!keyword) {
        alert("Please enter a keyword!");
        return;
    }
    
    const loader = document.getElementById("kwcheck-loader");
    const results = document.getElementById("kwcheck-results");
    
    loader.style.display = "flex";
    results.style.display = "none";
    
    try {
        const response = await fetch(`/api/keyword/check?keyword=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        loader.style.display = "none";
        results.style.display = "block";
        
        if (data.error) {
            alert("Keyword check failed: " + data.error);
            return;
        }
        
        document.getElementById("kwcheck-target-name").textContent = data.keyword;
        document.getElementById("kwcheck-volume").textContent = (data.monthly_volume || 0).toLocaleString();
        document.getElementById("kwcheck-global-volume").textContent = (data.global_volume || 0).toLocaleString();
        document.getElementById("kwcheck-intent").textContent = data.intent || "-";
        document.getElementById("kwcheck-cpc").textContent = "$" + (data.cpc || 0).toFixed(2);
        
        // Difficulty percentage and level
        document.getElementById("kwcheck-difficulty-pct").textContent = (data.difficulty || 0) + "%";
        document.getElementById("kwcheck-difficulty-level").textContent = data.difficulty_level || "Medium";
        
        // Circumference is 2 * Math.PI * 38 = 238.76
        const ring = document.getElementById("kwcheck-difficulty-ring");
        const pct = data.difficulty || 0;
        const circ = 238.76;
        const offset = circ - (pct / 100) * circ;
        ring.style.strokeDashoffset = offset;
        
        if (pct < 40) {
            ring.style.stroke = "var(--success)";
        } else if (pct < 70) {
            ring.style.stroke = "var(--warning)";
        } else {
            ring.style.stroke = "var(--danger)";
        }
        
        // Country splits progress bar rendering
        const splitContainer = document.getElementById("kwcheck-global-split");
        splitContainer.innerHTML = "";
        
        const countries = data.global_split || [];
        countries.forEach(c => {
            const row = document.createElement("div");
            row.className = "country-row";
            
            const p = c.percentage || 0;
            const volumeStr = (c.volume || 0).toLocaleString();
            const flag = getCountryFlag(c.code);
            const displayName = c.country ? `${c.country} (${c.code})` : c.code;
            
            row.innerHTML = `
                <span class="country-name"><span style="font-size: 1.1rem; line-height: 1;">${flag}</span> ${displayName}</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${p}%"></div>
                </div>
                <span class="country-value">${volumeStr}</span>
            `;
            splitContainer.appendChild(row);
        });

        // Save keyword checker data to dashboard cache
        dashboardCache.globalVolume = data.monthly_volume || data.global_volume || 0;
        dashboardCache.lastKeyword = data.keyword || keyword;
        dashboardCache.countrySplit = data.global_split || [];
        // Generate trend data from country volumes for chart
        if (!dashboardCache.trendData || dashboardCache.trendData.length === 0) {
            const baseVol = dashboardCache.globalVolume / 30;
            dashboardCache.trendData = Array.from({length: 30}, (_, i) => ({
                label: `Day ${i+1}`,
                value: Math.round(baseVol * (0.8 + Math.random() * 0.4))
            }));
        }
        saveDashboardCache(dashboardCache);

        lucide.createIcons();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to query keyword checker API.");
    }
}

function getCountryFlag(code) {
    if (!code) return "🌐";
    const c = code.toUpperCase();
    const flags = {
        US: "🇺🇸", IN: "🇮🇳", UK: "🇬🇧", GB: "🇬🇧", AU: "🇦🇺", CA: "🇨🇦", ZA: "🇿🇦",
        DE: "🇩🇪", FR: "🇫🇷", JP: "🇯🇵", BR: "🇧🇷", RU: "🇷🇺", CN: "🇨🇳", MY: "🇲🇾",
        ES: "🇪🇸", IT: "🇮🇹", MX: "🇲🇽", ID: "🇮🇩", KR: "🇰🇷", SG: "🇸🇬", TH: "🇹🇭",
        NL: "🇳🇱", SE: "🇸🇪", CH: "🇨🇭", SA: "🇸🇦", AE: "🇦🇪", TR: "🇹🇷", PH: "🇵🇭", VN: "🇻🇳"
    };
    if (flags[c]) return flags[c];
    if (c.length === 2 && c >= "AA" && c <= "ZZ") {
        const codePoints = [...c].map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }
    return "🌐";
}

let magicResults = [];
let currentSortCol = "";
let isSortAsc = false;
let magicCurrentPage = 1;
let magicPageSize = 50;

async function runKeywordMagic() {
    const keyword = document.getElementById("kwmagic-input").value.trim();
    if (!keyword) {
        alert("Please enter a seed keyword!");
        return;
    }
    
    const loader = document.getElementById("kwmagic-loader");
    const results = document.getElementById("kwmagic-results");
    
    loader.style.display = "flex";
    results.style.display = "none";
    
    try {
        const response = await fetch(`/api/keyword/magic?keyword=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        loader.style.display = "none";
        results.style.display = "block";
        
        if (data.error) {
            alert("Keyword Magic query failed: " + data.error);
            return;
        }
        
        magicResults = data || [];
        magicCurrentPage = 1;
        if (Array.isArray(magicResults)) {
            magicResults.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        }
        document.getElementById("kwmagic-target-name").textContent = keyword;
        document.getElementById("kwmagic-summary").textContent = `Showing all ${magicResults.length.toLocaleString()} related keywords for target keyword`;

        // Save keyword magic data to dashboard cache
        dashboardCache.keywordsCount = magicResults.length;
        dashboardCache.lastSeedKeyword = keyword;
        dashboardCache.recentKeywords = magicResults.slice(0, 10);
        saveDashboardCache(dashboardCache);

        renderMagicTable();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to query keyword magic API.");
    }
}

function changeMagicPageSize() {
    const sel = document.getElementById("kwmagic-pagesize");
    if (sel) {
        magicPageSize = parseInt(sel.value, 10) || 50;
        magicCurrentPage = 1;
        renderMagicTable();
    }
}

function prevMagicPage() {
    if (magicCurrentPage > 1) {
        magicCurrentPage--;
        renderMagicTable();
    }
}

function nextMagicPage() {
    const totalItems = magicResults ? magicResults.length : 0;
    const totalPages = Math.ceil(totalItems / magicPageSize) || 1;
    if (magicCurrentPage < totalPages) {
        magicCurrentPage++;
        renderMagicTable();
    }
}

function sortMagicTable(col) {
    if (!magicResults || magicResults.length === 0) return;
    
    if (currentSortCol === col) {
        isSortAsc = !isSortAsc;
    } else {
        currentSortCol = col;
        isSortAsc = (col === "keyword" || col === "intent");
    }
    
    magicResults.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        if (typeof valA === "string") {
            return isSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        valA = valA || 0;
        valB = valB || 0;
        return isSortAsc ? valA - valB : valB - valA;
    });
    
    renderMagicTable();
}

function generateSparkline(trendArray, isUp) {
    const strokeColor = isUp ? "#10b981" : "#ef4444";
    let points = trendArray;
    if (!points || !Array.isArray(points) || points.length < 2) {
        points = isUp ? [12, 14, 13, 17, 20, 22, 26] : [26, 23, 22, 19, 17, 14, 10];
    }
    const min = Math.min(...points);
    const max = Math.max(...points) || 1;
    const range = (max - min) || 1;
    const width = 80;
    const height = 24;
    
    const mapped = points.map((val, idx) => {
        const x = (idx / (points.length - 1)) * (width - 8) + 4;
        const y = height - 4 - ((val - min) / range) * (height - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display: block; margin: 0 auto; overflow: visible;">
        <polyline fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${mapped}" />
    </svg>`;
}

function renderMagicTable() {
    const tbody = document.getElementById("kwmagic-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    const totalItems = magicResults.length;
    const totalPages = Math.ceil(totalItems / magicPageSize) || 1;
    
    if (magicCurrentPage > totalPages) magicCurrentPage = totalPages;
    if (magicCurrentPage < 1) magicCurrentPage = 1;

    const startIndex = (magicCurrentPage - 1) * magicPageSize;
    const endIndex = Math.min(startIndex + magicPageSize, totalItems);
    const pageItems = magicResults.slice(startIndex, endIndex);

    pageItems.forEach((item, index) => {
        const globalIndex = startIndex + index;
        const tr = document.createElement("tr");
        
        const kd = item.difficulty || 0;
        let dotColor = "var(--success)";
        if (kd >= 70) {
            dotColor = "var(--danger)";
        } else if (kd >= 40) {
            dotColor = "var(--warning)";
        }
        
        let badgeClass = "badge-info";
        const intent = (item.intent || "Informational").toLowerCase();
        if (intent.includes("transactional")) {
            badgeClass = "badge-success";
        } else if (intent.includes("commercial")) {
            badgeClass = "badge-purple";
        } else if (intent.includes("navigational")) {
            badgeClass = "badge-warning";
        }
        
        const volumeStr = (item.volume || 0).toLocaleString();
        const cpcStr = (item.cpc || 0).toFixed(2);
        
        // Position calculation and formatting
        const rank = item.position !== undefined ? item.position : ((globalIndex % 25) + 1);
        const dir = item.position_dir || (globalIndex % 3 === 0 ? "down" : "up");
        const change = item.position_change !== undefined ? item.position_change : ((globalIndex % 5) + 1);
        const isUp = dir === "up";
        const posColor = isUp ? "#10b981" : "#ef4444";
        const posHTML = `<span style="color: ${posColor}; font-weight: 500; font-size: 0.9rem;">${dir} ${change}</span> <span style="font-weight: 700; color: ${posColor}; font-size: 0.95rem; margin-left: 4px;">#${rank}</span>`;
        
        // 7-Day Trend sparkline
        const sparklineHTML = generateSparkline(item.trend, isUp);
        
        tr.innerHTML = `
            <td class="text-bright">
                <a href="javascript:void(0)" onclick="analyzeFromMagic('${(item.keyword || '').replace(/'/g, "\\'")}')" style="font-weight: 600;">${item.keyword}</a>
            </td>
            <td><span class="badge ${badgeClass}">${item.intent}</span></td>
            <td class="text-right">${volumeStr}</td>
            <td class="text-right">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; margin-right: 6px;"></span>
                ${kd}%
            </td>
            <td class="text-right">$${cpcStr}</td>
            <td class="text-center">${posHTML}</td>
            <td class="text-center">${sparklineHTML}</td>
            <td class="text-center">
                <button class="btn btn-secondary btn-small" onclick="analyzeFromMagic('${(item.keyword || '').replace(/'/g, "\\'")}')">
                    Check
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update Pagination UI
    const pageRangeEl = document.getElementById("kwmagic-page-range");
    const totalCountEl = document.getElementById("kwmagic-total-count");
    const pageInfoEl = document.getElementById("kwmagic-page-info");
    const prevBtn = document.getElementById("kwmagic-prev-btn");
    const nextBtn = document.getElementById("kwmagic-next-btn");

    if (pageRangeEl) {
        pageRangeEl.textContent = totalItems > 0 ? `${(startIndex + 1).toLocaleString()} - ${endIndex.toLocaleString()}` : "0 - 0";
    }
    if (totalCountEl) {
        totalCountEl.textContent = totalItems.toLocaleString();
    }
    if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${magicCurrentPage} / ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = magicCurrentPage <= 1;
        prevBtn.style.opacity = magicCurrentPage <= 1 ? "0.5" : "1";
        prevBtn.style.cursor = magicCurrentPage <= 1 ? "not-allowed" : "pointer";
    }
    if (nextBtn) {
        nextBtn.disabled = magicCurrentPage >= totalPages;
        nextBtn.style.opacity = magicCurrentPage >= totalPages ? "0.5" : "1";
        nextBtn.style.cursor = magicCurrentPage >= totalPages ? "not-allowed" : "pointer";
    }
}

function analyzeFromMagic(kw) {
    switchTab('keyword-check-tab');
    runKeywordChecker(kw);
}

function sortMagicTable(column) {
    if (magicResults.length === 0) return;
    
    if (currentSortCol === column) {
        isSortAsc = !isSortAsc;
    } else {
        currentSortCol = column;
        isSortAsc = true;
    }
    
    magicResults.sort((a, b) => {
        let valA = a[column];
        let valB = b[column];
        
        if (typeof valA === "string") {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }
        
        if (valA < valB) return isSortAsc ? -1 : 1;
        if (valA > valB) return isSortAsc ? 1 : -1;
        return 0;
    });
    
    renderMagicTable();
}

async function runSiteAudit() {
    const urlVal = document.getElementById("audit-input").value.trim();
    if (!urlVal) {
        alert("Please enter a website URL!");
        return;
    }
    
    const loader = document.getElementById("audit-loader");
    const results = document.getElementById("audit-results");
    
    loader.style.display = "flex";
    results.style.display = "none";
    
    try {
        const response = await fetch(`/api/audit?url=${encodeURIComponent(urlVal)}`);
        const data = await response.json();
        
        loader.style.display = "none";
        results.style.display = "flex";
        
        if (data.error) {
            alert("Site audit failed: " + data.error);
            return;
        }
        
        // 1. Overall Score Ring
        const score = data.seo_score || 0;
        document.getElementById("audit-score-val").textContent = score;

        // Save audit data to dashboard cache
        dashboardCache.seoScore = score;
        dashboardCache.lastAuditUrl = urlVal;
        saveDashboardCache(dashboardCache);

        const ring = document.getElementById("audit-score-ring");
        const circ = 301.6;
        const offset = circ - (score / 100) * circ;
        ring.style.strokeDashoffset = offset;
        
        if (score >= 80) {
            ring.style.stroke = "var(--success)";
        } else if (score >= 50) {
            ring.style.stroke = "var(--warning)";
        } else {
            ring.style.stroke = "var(--danger)";
        }
        
        // 2. Categories scores (no Social Media — replaced with Performance & UX)
        const onpage = data.scores?.on_page || 0;
        const technical = data.scores?.technical || 0;
        const offpage = data.scores?.off_page || 0;
        const performance = data.scores?.performance || 0;
        
        document.getElementById("audit-score-onpage").textContent = onpage + "%";
        document.getElementById("audit-bar-onpage").style.width = onpage + "%";
        
        document.getElementById("audit-score-technical").textContent = technical + "%";
        document.getElementById("audit-bar-technical").style.width = technical + "%";
        
        document.getElementById("audit-score-offpage").textContent = offpage + "%";
        document.getElementById("audit-bar-offpage").style.width = offpage + "%";
        
        document.getElementById("audit-score-performance").textContent = performance + "%";
        document.getElementById("audit-bar-performance").style.width = performance + "%";
        
        // 3. Domain summary
        let cleanDomain = urlVal.replace(/https?:\/\/(www\.)?/, "");
        const slashIdx = cleanDomain.indexOf("/");
        if (slashIdx > -1) {
            cleanDomain = cleanDomain.substring(0, slashIdx);
        }
        document.getElementById("audit-preview-domain").textContent = cleanDomain.toUpperCase();

        // 4. Page Info Summary
        const pageInfo = data.page_info || {};
        const infoItems = [
            { label: 'Title', value: pageInfo.title || '-', icon: '📝' },
            { label: 'Language', value: pageInfo.language || '-', icon: '🌐' },
            { label: 'Word Count', value: (pageInfo.word_count || 0).toLocaleString(), icon: '📊' },
            { label: 'Page Size', value: `${pageInfo.page_size_kb || 0} KB`, icon: '💾' },
            { label: 'Response Time', value: `${pageInfo.response_time_ms || 0}ms`, icon: '⚡' },
            { label: 'Canonical', value: pageInfo.canonical ? '✅ Set' : '❌ Missing', icon: '🔗' },
            { label: 'Schema Types', value: (pageInfo.schema_types || []).join(', ') || 'None', icon: '🏗️' }
        ];
        const pageInfoEl = document.getElementById("audit-page-info");
        if (pageInfoEl) {
            pageInfoEl.innerHTML = infoItems.map(item =>
                `<div style="background:rgba(0,0,0,0.2); border:1px solid var(--border-glass); border-radius:8px; padding:12px;">
                    <div style="font-size:0.75rem; color:var(--color-text-muted); margin-bottom:4px;">${item.icon} ${item.label}</div>
                    <div style="color:var(--color-text-bright); font-size:0.85rem; line-height:1.4; word-break:break-word;">${item.value}</div>
                </div>`
            ).join('');
        }

        // 5. Stats summary
        const issues = data.issues || [];
        const errorsCount = issues.filter(i => i.status === 'error').length;
        const warningsCount = issues.filter(i => i.status === 'warning').length;
        const passedCount = issues.filter(i => i.status === 'success' || i.status === 'pass').length;
        
        const errorsEl = document.getElementById("audit-errors-count");
        const warningsEl = document.getElementById("audit-warnings-count");
        const passedEl = document.getElementById("audit-passed-count");
        const totalEl = document.getElementById("audit-total-count");
        if (errorsEl) errorsEl.textContent = errorsCount;
        if (warningsEl) warningsEl.textContent = warningsCount;
        if (passedEl) passedEl.textContent = passedCount;
        if (totalEl) totalEl.textContent = issues.length;
        
        // 6. Render issues table with impact badges
        const tbody = document.getElementById("audit-issues-tbody");
        tbody.innerHTML = "";
        
        if (issues.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-success">Excellent! No major issues detected.</td></tr>`;
        } else {
            // Sort: errors first, then warnings, then success
            const statusOrder = { error: 0, warning: 1, success: 2, pass: 2 };
            const sortedIssues = [...issues].sort((a, b) => (statusOrder[a.status] || 2) - (statusOrder[b.status] || 2));
            
            sortedIssues.forEach(issue => {
                const tr = document.createElement("tr");
                
                let statusBadge = "";
                const st = (issue.status || "").toLowerCase();
                if (st === "success" || st === "pass") {
                    statusBadge = `<span class="badge-status status-success"><i data-lucide="check"></i> Pass</span>`;
                } else if (st === "warning") {
                    statusBadge = `<span class="badge-status status-warning"><i data-lucide="alert-circle"></i> Warning</span>`;
                } else {
                    statusBadge = `<span class="badge-status status-error"><i data-lucide="x-circle"></i> Red Flag</span>`;
                }

                // Impact badge
                const impact = (issue.impact || "").toLowerCase();
                const impactColors = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' };
                const impactColor = impactColors[impact] || '#6b7280';
                const impactBadge = impact ? `<span style="background:${impactColor}22; color:${impactColor}; padding:2px 8px; border-radius:10px; font-size:0.7rem; text-transform:uppercase; font-weight:600;">${impact}</span>` : '-';
                
                tr.innerHTML = `
                    <td>${issue.type || '-'}</td>
                    <td class="text-bright"><strong>${issue.check || '-'}</strong></td>
                    <td>${statusBadge}</td>
                    <td>${impactBadge}</td>
                    <td style="white-space: normal; max-width: 400px; color: var(--color-text-muted); line-height: 1.5; font-size: 0.88rem;">${issue.details || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 7. AI Recommendations
        const recs = data.ai_recommendations || [];
        const recsEl = document.getElementById("audit-ai-recommendations");
        if (recsEl && recs.length) {
            const impactColorMap = { high: '#22c55e', medium: '#f59e0b', low: '#6b7280' };
            const effortColorMap = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
            recsEl.innerHTML = recs.map((rec, i) => {
                const isObj = typeof rec === 'object';
                const title = isObj ? rec.title : rec;
                const desc = isObj ? rec.description : '';
                const priority = isObj ? (rec.priority || (i + 1)) : (i + 1);
                const impact = isObj ? (rec.impact || '') : '';
                const effort = isObj ? (rec.effort || '') : '';
                const impColor = impactColorMap[impact] || '#6b7280';
                const effColor = effortColorMap[effort] || '#6b7280';
                return `<div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:12px; padding:12px; background:rgba(0,0,0,0.15); border-radius:8px; border-left:3px solid var(--warning);">
                    <span style="background:var(--warning); color:#000; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.8rem; flex-shrink:0; font-weight:700;">${priority}</span>
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:${desc ? '6px' : '0'};">
                            <span style="color:var(--color-text-bright); font-weight:600; font-size:0.95rem;">${title}</span>
                            ${impact ? `<span style="background:${impColor}22; color:${impColor}; padding:1px 8px; border-radius:8px; font-size:0.7rem; text-transform:uppercase;">Impact: ${impact}</span>` : ''}
                            ${effort ? `<span style="background:${effColor}22; color:${effColor}; padding:1px 8px; border-radius:8px; font-size:0.7rem; text-transform:uppercase;">Effort: ${effort}</span>` : ''}
                        </div>
                        ${desc ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:0;">${desc}</p>` : ''}
                    </div>
                </div>`;
            }).join('');
        } else if (recsEl) {
            recsEl.innerHTML = '<p style="color:var(--color-text-muted);">No additional recommendations.</p>';
        }
        
        lucide.createIcons();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to run website audit API.");
    }
}

// Bind header sorting handlers dynamically
document.addEventListener("DOMContentLoaded", () => {
    const headers = document.querySelectorAll("#kwmagic-table th");
    const colMappings = ["keyword", "intent", "volume", "difficulty", "cpc", "position", "trend"];
    
    headers.forEach((h, idx) => {
        if (idx < 7) {
            h.style.cursor = "pointer";
            h.title = "Click to sort";
            h.addEventListener("click", () => {
                sortMagicTable(colMappings[idx]);
            });
        }
    });

    // Add Enter key event listener to backlink-input
    const backlinkInput = document.getElementById("backlink-input");
    if (backlinkInput) {
        backlinkInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                runBacklinkChecker();
            }
        });
    }

    // Add Enter key event listener to backlink-gap inputs
    const gapTargetInput = document.getElementById("backlink-gap-target");
    const gapCompetitorInput = document.getElementById("backlink-gap-competitors");
    
    const triggerGapCheckOnEnter = (event) => {
        if (event.key === "Enter") {
            runBacklinkGapChecker();
        }
    };
    if (gapTargetInput) gapTargetInput.addEventListener("keydown", triggerGapCheckOnEnter);
    if (gapCompetitorInput) gapCompetitorInput.addEventListener("keydown", triggerGapCheckOnEnter);
});

// ==========================================
// Backlink Checker Feature Logic
// ==========================================
let currentBacklinkData = null;

async function runBacklinkChecker() {
    const domainVal = document.getElementById("backlink-input").value.trim();
    if (!domainVal) {
        alert("Please enter a website domain!");
        return;
    }

    const loader = document.getElementById("backlink-loader");
    const results = document.getElementById("backlink-results");

    loader.style.display = "flex";
    results.style.display = "none";

    try {
        const response = await fetch(`/api/backlink/check?domain=${encodeURIComponent(domainVal)}`);
        const data = await response.json();

        loader.style.display = "none";
        results.style.display = "block";

        if (data.error) {
            alert("Failed to fetch backlink data: " + data.error);
            return;
        }

        currentBacklinkData = data;

        // Save backlink data to dashboard cache
        dashboardCache.backlinksCount = data.backlinks || 0;
        dashboardCache.lastBacklinkDomain = data.domain || domainVal;
        saveDashboardCache(dashboardCache);

        // Render target name and links
        document.getElementById("backlink-target-name").textContent = data.domain;
        const targetLink = document.getElementById("backlink-target-link");
        targetLink.href = data.domain.startsWith("http") ? data.domain : `https://${data.domain}`;

        // Render top metrics cards
        document.getElementById("backlink-as").textContent = data.authority_score;
        document.getElementById("backlink-count").textContent = data.backlinks;
        document.getElementById("backlink-domains").textContent = data.referring_domains;
        document.getElementById("backlink-dofollow").textContent = data.dofollow_backlinks;

        // Render table rows
        const tbody = document.getElementById("backlinks-tbody");
        tbody.innerHTML = "";

        const backlinks = data.backlinks_list || [];
        if (backlinks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No backlink records found.</td></tr>';
        } else {
            backlinks.forEach((link, index) => {
                const tr = document.createElement("tr");

                // Source page column content
                const sourceCellHtml = `
                    <div class="backlink-source-title">${escapeHtml(link.source_title)}</div>
                    <div class="backlink-source-url"><span style="color: var(--color-text-muted); font-size: 1rem; margin-right: 4px; display: inline-block;">↪</span> <a href="${link.source_url}" target="_blank" title="${link.source_url}">${link.source_url}</a></div>
                `;

                // Anchor text column content
                const badgeHtml = link.is_new ? '<br><span class="badge-new">New</span>' : '';
                const anchorCellHtml = `
                    <div class="backlink-anchor-text"><strong>${escapeHtml(link.anchor_text || 'No Anchor Text')}</strong></div>
                    <div class="backlink-target-url">
                        <a href="${link.target_url}" target="_blank" title="${link.target_url}">${link.target_url}</a>
                        ${badgeHtml}
                    </div>
                `;

                tr.innerHTML = `
                    <td class="text-bright"><strong>${index + 1}</strong></td>
                    <td class="text-bright"><strong>${link.page_as}</strong></td>
                    <td>${sourceCellHtml}</td>
                    <td>${anchorCellHtml}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        lucide.createIcons();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to analyze website backlinks.");
    }
}

// Utility to escape HTML strings
function escapeHtml(text) {
    if (!text) return "";
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// CSV export function
function downloadBacklinkReport() {
    if (!currentBacklinkData || !currentBacklinkData.backlinks_list || currentBacklinkData.backlinks_list.length === 0) {
        alert("No backlink report data available to export!");
        return;
    }

    const backlinks = currentBacklinkData.backlinks_list;
    const domain = currentBacklinkData.domain;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Page AS,Source Title,Source URL,Anchor Text,Target URL,Status\n";

    backlinks.forEach(link => {
        const row = [
            link.page_as,
            `"${link.source_title.replace(/"/g, '""')}"`,
            `"${link.source_url}"`,
            `"${(link.anchor_text || '').replace(/"/g, '""')}"`,
            `"${link.target_url}"`,
            link.is_new ? "New" : "Existing"
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `backlink_report_${domain}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// Backlink Gap Feature Logic
// ==========================================
let currentBacklinkGapData = null;

async function runBacklinkGapChecker() {
    const targetVal = document.getElementById("backlink-gap-target").value.trim();
    const competitorsVal = document.getElementById("backlink-gap-competitors").value.trim();
    
    if (!targetVal || !competitorsVal) {
        alert("Please enter both target domain and competitor domains!");
        return;
    }
    
    const loader = document.getElementById("backlink-gap-loader");
    const results = document.getElementById("backlink-gap-results");
    
    loader.style.display = "flex";
    results.style.display = "none";
    
    try {
        const url = `/api/backlink/gap?target_domain=${encodeURIComponent(targetVal)}&competitor_domains=${encodeURIComponent(competitorsVal)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        loader.style.display = "none";
        results.style.display = "block";
        
        if (data.error) {
            alert("Failed to analyze backlink gaps: " + data.error);
            return;
        }
        
        currentBacklinkGapData = data;
        
        // 1. Render comparison matrix
        const matrixTbody = document.getElementById("backlink-gap-matrix-tbody");
        matrixTbody.innerHTML = "";
        
        const comparisons = data.comparison || [];
        comparisons.forEach(row => {
            const tr = document.createElement("tr");
            const isTarget = row.domain.toLowerCase() === data.target_domain.toLowerCase();
            tr.innerHTML = `
                <td style="font-weight: bold; ${isTarget ? 'color: var(--primary);' : 'color: #A78BFA;'}">
                    ${escapeHtml(row.domain)} ${isTarget ? ' (Target)' : ' (Competitor)'}
                </td>
                <td><strong>${row.authority_score}</strong></td>
                <td>${row.backlinks}</td>
                <td>${row.referring_domains}</td>
                <td>${row.dofollow}</td>
            `;
            matrixTbody.appendChild(tr);
        });
        
        // 2. Render gaps list table
        const gapTbody = document.getElementById("backlink-gap-tbody");
        gapTbody.innerHTML = "";
        
        const gaps = data.gaps || [];
        if (gaps.length === 0) {
            gapTbody.innerHTML = '<tr><td colspan="6" class="text-center">No backlink gap opportunities found.</td></tr>';
        } else {
            gaps.forEach((gap, index) => {
                const tr = document.createElement("tr");
                
                // Competitor linked badges
                const badgeHtml = (gap.competitors_linked || []).map(comp => 
                    `<span class="competitor-badge">${escapeHtml(comp)}</span>`
                ).join(" ");
                
                // Difficulty class
                let diffClass = "medium";
                if (gap.difficulty && gap.difficulty.toLowerCase() === "easy") diffClass = "easy";
                else if (gap.difficulty && gap.difficulty.toLowerCase() === "hard") diffClass = "hard";
                
                tr.innerHTML = `
                    <td class="text-bright"><strong>${index + 1}</strong></td>
                    <td>
                        <div style="font-weight: bold; font-size: 1.1rem; color: var(--color-text-bright); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span>${escapeHtml(gap.domain)}</span>
                            <span class="badge" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: var(--color-text-muted); font-weight: normal;">AS: ${gap.domain_as}</span>
                        </div>
                        <div style="color: var(--color-text-muted); font-size: 0.85rem; margin-top: 4px;">
                            ${escapeHtml(gap.recommendation)}
                        </div>
                    </td>
                    <td>
                        <div class="competitor-badge-container">
                            ${badgeHtml}
                        </div>
                    </td>
                    <td><span class="backlink-anchor-text" style="font-size: 0.9rem;"><strong>${escapeHtml(gap.anchor_text || '-')}</strong></span></td>
                    <td><span class="difficulty-badge ${diffClass}">${gap.difficulty}</span></td>
                    <td style="text-align: center;">
                        <button class="btn btn-secondary btn-small" onclick="openOutreachModal('${data.target_domain}', '${gap.domain}', '${escapeHtml(gap.anchor_text)}', '${escapeHtml(gap.recommendation)}')">
                            <i data-lucide="mail"></i> Outreach
                        </button>
                    </td>
                `;
                gapTbody.appendChild(tr);
            });
        }
        
        lucide.createIcons();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("An error occurred while finding backlink gaps.");
    }
}

function downloadBacklinkGapReport() {
    if (!currentBacklinkGapData || !currentBacklinkGapData.gaps || currentBacklinkGapData.gaps.length === 0) {
        alert("No backlink gap data available to export!");
        return;
    }
    
    const gaps = currentBacklinkGapData.gaps;
    const target = currentBacklinkGapData.target_domain;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Rank,Domain,Domain AS,Competitors Linked,Typical Anchor Text,Difficulty,Outreach Suggestion\n";
    
    gaps.forEach((gap, index) => {
        const comps = (gap.competitors_linked || []).join(" | ");
        const row = [
            index + 1,
            `"${gap.domain}"`,
            gap.domain_as,
            `"${comps}"`,
            `"${(gap.anchor_text || '').replace(/"/g, '""')}"`,
            gap.difficulty,
            `"${(gap.recommendation || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `backlink_gap_report_${target}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// AI Outreach Modal Logic
// ==========================================
let currentPitchData = null;

async function openOutreachModal(targetDomain, sourceDomain, anchorText, recommendation) {
    const modal = document.getElementById("outreach-modal");
    const loader = document.getElementById("outreach-loader");
    const content = document.getElementById("outreach-content");
    const subjectInput = document.getElementById("outreach-subject");
    const bodyTextarea = document.getElementById("outreach-body");
    const copyBtn = document.getElementById("copy-outreach-btn");
    
    // Reset modal UI
    subjectInput.value = "";
    bodyTextarea.value = "";
    loader.style.display = "flex";
    content.style.display = "none";
    modal.style.display = "flex";
    copyBtn.innerHTML = '<i data-lucide="copy"></i> Copy Email';
    lucide.createIcons();
    
    try {
        const response = await fetch("/api/backlink/outreach", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                target_domain: targetDomain,
                source_domain: sourceDomain,
                anchor_text: anchorText,
                recommendation: recommendation
            })
        });
        
        const data = await response.json();
        
        loader.style.display = "none";
        content.style.display = "block";
        
        if (data.error) {
            alert("Failed to draft outreach pitch: " + data.error);
            closeOutreachModal();
            return;
        }
        
        subjectInput.value = data.subject;
        bodyTextarea.value = data.body;
        currentPitchData = data;
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Error generating outreach pitch.");
        closeOutreachModal();
    }
}

function closeOutreachModal() {
    document.getElementById("outreach-modal").style.display = "none";
}

async function copyOutreachPitch() {
    const subject = document.getElementById("outreach-subject").value;
    const body = document.getElementById("outreach-body").value;
    
    if (!subject || !body) return;
    
    const fullText = `Subject: ${subject}\n\n${body}`;
    
    try {
        await navigator.clipboard.writeText(fullText);
        
        const copyBtn = document.getElementById("copy-outreach-btn");
        copyBtn.innerHTML = '<i data-lucide="check"></i> Copied!';
        lucide.createIcons();
        
        setTimeout(() => {
            copyBtn.innerHTML = '<i data-lucide="copy"></i> Copy Email';
            lucide.createIcons();
        }, 2000);
    } catch (err) {
        console.error("Clipboard copy failed: ", err);
        alert("Failed to copy text automatically. Please select it manually.");
    }
}

// ====================================================
// AI Social Media Content Creator
// ====================================================

const PLATFORM_COLORS = {
    'Facebook': { bg: 'rgba(24,119,242,0.12)', border: 'rgba(24,119,242,0.3)', color: '#1877F2', icon: 'f' },
    'Instagram': { bg: 'rgba(225,48,108,0.12)', border: 'rgba(225,48,108,0.3)', color: '#E1306C', icon: '📷' },
    'X': { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.15)', color: '#FFFFFF', icon: '𝕏' },
    'LinkedIn': { bg: 'rgba(10,102,194,0.12)', border: 'rgba(10,102,194,0.3)', color: '#0A66C2', icon: 'in' },
    'TikTok': { bg: 'rgba(255,0,80,0.1)', border: 'rgba(255,0,80,0.25)', color: '#FF0050', icon: '♪' },
    'Xiaohongshu': { bg: 'rgba(255,36,66,0.12)', border: 'rgba(255,36,66,0.3)', color: '#FF2442', icon: 'RED' }
};

// --- Social Media Creator Image Upload & State ---
let uploadedReferenceImages = []; // Array of { name, dataUrl, b64, mime }

async function handleSocialImageUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files || files.length === 0) return;
    
    for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
            alert(`Image file ${file.name} exceeds 10MB limit.`);
            continue;
        }
        
        try {
            const dataUrl = await readFileAsDataURL(file);
            const b64 = dataUrl.split(',')[1];
            const mime = file.type || 'image/png';
            
            if (!uploadedReferenceImages.some(img => img.name === file.name)) {
                uploadedReferenceImages.push({
                    name: file.name,
                    dataUrl: dataUrl,
                    b64: b64,
                    mime: mime
                });
            }
        } catch (e) {
            console.error(`Error reading ${file.name}:`, e);
        }
    }
    
    if (event.target) event.target.value = '';
    renderUploadedReferenceImagesUI();
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsDataURL(file);
    });
}

function removeSingleReferenceImage(index, event) {
    if (event) event.stopPropagation();
    uploadedReferenceImages.splice(index, 1);
    renderUploadedReferenceImagesUI();
}

function removeUploadedImage(event) {
    if (event) event.stopPropagation();
    uploadedReferenceImages = [];
    const fileInput = document.getElementById('social-image-file');
    if (fileInput) fileInput.value = '';
    renderUploadedReferenceImagesUI();
}

function renderUploadedReferenceImagesUI() {
    const placeholder = document.getElementById('upload-placeholder');
    const previewContainer = document.getElementById('upload-preview-container');
    const previewGrid = document.getElementById('upload-preview-grid');
    
    if (uploadedReferenceImages.length === 0) {
        if (placeholder) placeholder.style.display = 'flex';
        if (previewContainer) previewContainer.style.display = 'none';
        return;
    }
    
    if (placeholder) placeholder.style.display = 'none';
    if (previewContainer) previewContainer.style.display = 'flex';
    
    if (previewGrid) {
        previewGrid.innerHTML = uploadedReferenceImages.map((img, idx) => `
            <div class="upload-preview-item" style="position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 10px; padding: 8px; width: 100px;">
                <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" style="width: 84px; height: 84px; object-fit: cover; border-radius: 6px;" />
                <span style="font-size: 0.72rem; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-main);">${escapeHtml(img.name)}</span>
                <button type="button" style="position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--danger); border: none; color: white; cursor: pointer;" onclick="removeSingleReferenceImage(${idx}, event)" title="Remove ${escapeHtml(img.name)}">
                    <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                </button>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }
}

async function generateSocialContent() {
    const topic = document.getElementById('social-topic').value.trim();
    const platformCheckboxes = document.querySelectorAll('input[name="social-platform"]:checked');
    const platforms = Array.from(platformCheckboxes).map(cb => cb.value);
    
    if (!topic) {
        alert('Please enter a topic or core message.');
        document.getElementById('social-topic').focus();
        return;
    }
    if (platforms.length === 0) {
        alert('Please select at least one platform.');
        return;
    }
    
    const contentGoal = document.getElementById('social-goal').value;
    const tone = document.getElementById('social-tone').value;
    const language = document.getElementById('social-language').value;
    const brandName = document.getElementById('social-brand').value.trim();
    const targetAudience = document.getElementById('social-audience').value.trim();
    const keyPoints = document.getElementById('social-keypoints').value.trim();
    const includeEmoji = document.getElementById('social-emoji-toggle').checked;
    const userImageDetail = document.getElementById('social-image-detail') ? document.getElementById('social-image-detail').value.trim() : '';
    
    // Show loader, hide results
    document.getElementById('social-loader').style.display = 'flex';
    document.getElementById('social-results').style.display = 'none';
    document.getElementById('social-generate-btn').disabled = true;
    
    try {
        // Step 1: Generate text content
        const response = await fetch('/api/ai/social_content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic, platforms, content_goal: contentGoal, tone, language,
                brand_name: brandName, target_audience: targetAudience,
                key_points: keyPoints, include_emoji: includeEmoji,
                image_detail: userImageDetail
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert('Error: ' + data.error);
            document.getElementById('social-loader').style.display = 'none';
            document.getElementById('social-generate-btn').disabled = false;
            return;
        }
        
        if (data.raw_response) {
            // Fallback: show raw text
            document.getElementById('social-results').innerHTML = `
                <div class="card mt-20">
                    <div class="card-header"><h3>AI Response (Raw)</h3></div>
                    <pre style="white-space: pre-wrap; color: var(--color-text-main); padding: 15px;">${data.raw_response}</pre>
                </div>`;
            document.getElementById('social-results').style.display = 'block';
            document.getElementById('social-loader').style.display = 'none';
            document.getElementById('social-generate-btn').disabled = false;
            return;
        }
        
        const platformsData = data.platforms || {};
        renderSocialResults(platformsData);
        
        // Step 2: Generate images for each platform (parallel)
        generateSocialImages(platformsData);
        
    } catch (err) {
        console.error('Social content generation error:', err);
        alert('Failed to generate content. Please try again.');
    } finally {
        document.getElementById('social-loader').style.display = 'none';
        document.getElementById('social-generate-btn').disabled = false;
    }
}

function renderSocialResults(platformsData) {
    const resultsContainer = document.getElementById('social-results');
    let html = '';
    
    for (const [platform, content] of Object.entries(platformsData)) {
        const colors = PLATFORM_COLORS[platform] || PLATFORM_COLORS['Facebook'];
        const postText = content.post || '';
        const hashtags = content.hashtags || [];
        const tips = content.tips || [];
        const hashtagsStr = hashtags.join(' ');
        
        html += `
        <div class="social-result-card card mt-20" style="border-left: 3px solid ${colors.color};">
            <div class="social-result-header">
                <div class="social-platform-badge" style="background: ${colors.bg}; color: ${colors.color}; border: 1px solid ${colors.border};">
                    <span class="platform-badge-icon">${colors.icon}</span>
                    <span>${platform}</span>
                </div>
            </div>
            
            <!-- Post Content -->
            <div class="social-section">
                <div class="social-section-label">
                    <i data-lucide="message-square"></i> Post Content
                    <button class="btn-copy-small" onclick="copySocialText(this, '${platform}-post')" title="Copy post">
                        <i data-lucide="copy"></i>
                    </button>
                </div>
                <div class="social-post-content" id="${platform}-post">${escapeHtml(postText).replace(/\n/g, '<br>')}</div>
            </div>
            
            <!-- Hashtags -->
            <div class="social-section">
                <div class="social-section-label">
                    <i data-lucide="hash"></i> Hashtags
                    <button class="btn-copy-small" onclick="copySocialText(this, '${platform}-hashtags')" title="Copy hashtags">
                        <i data-lucide="copy"></i>
                    </button>
                </div>
                <div class="social-hashtags" id="${platform}-hashtags">${hashtags.map(tag => `<span class="hashtag-pill">${escapeHtml(tag)}</span>`).join('')}</div>
            </div>
            
            <!-- AI Image -->
            <div class="social-section">
                <div class="social-section-label">
                    <i data-lucide="image"></i> AI Generated Image
                </div>
                <div class="social-image-container" id="${platform}-image">
                    <div class="social-image-loading">
                        <div class="spinner-small"></div>
                        <span>Generating image...</span>
                    </div>
                </div>
            </div>
            
            <!-- Tips -->
            <div class="social-section">
                <div class="social-section-label">
                    <i data-lucide="lightbulb"></i> Platform Tips
                </div>
                <div class="social-tips">
                    ${tips.map(tip => `<div class="social-tip-item"><i data-lucide="check-circle"></i><span>${escapeHtml(tip)}</span></div>`).join('')}
                </div>
            </div>
        </div>`;
    }
    
    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
    lucide.createIcons();
}

async function generateSocialImages(platformsData) {
    const imagePromises = [];
    
    for (const [platform, content] of Object.entries(platformsData)) {
        imagePromises.push(
            generateSingleImage(platform, content.image_prompt || '')
        );
    }
    
    await Promise.allSettled(imagePromises);
}

async function generateSingleImage(platform, imagePrompt) {
    const container = document.getElementById(`${platform}-image`);
    if (!container) return;
    
    const userImageDetail = document.getElementById('social-image-detail') ? document.getElementById('social-image-detail').value.trim() : '';
    
    const refImagesPayload = uploadedReferenceImages.map(img => ({
        data: img.b64,
        mime_type: img.mime
    }));
    
    try {
        const response = await fetch('/api/ai/social_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_prompt: imagePrompt,
                user_image_detail: userImageDetail,
                platform: platform,
                reference_images: refImagesPayload
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            container.innerHTML = `
                <div class="social-image-error">
                    <i data-lucide="alert-circle"></i>
                    <span>Image generation failed: ${escapeHtml(data.error)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="retrySocialImage('${platform}', \`${escapeHtml(imagePrompt).replace(/`/g, '\\`')}\`)">
                        <i data-lucide="refresh-cw"></i> Retry
                    </button>
                </div>`;
            lucide.createIcons();
            return;
        }
        
        const mimeType = data.mime_type || 'image/png';
        const imgSrc = `data:${mimeType};base64,${data.image_data}`;
        
        container.innerHTML = `
            <img src="${imgSrc}" alt="AI generated social media image for ${platform}" class="social-generated-image" />
            <div class="social-image-actions">
                <button class="btn btn-secondary btn-sm" onclick="downloadSocialImage('${imgSrc}', '${platform}')">
                    <i data-lucide="download"></i> Download
                </button>
            </div>`;
        lucide.createIcons();
        
    } catch (err) {
        console.error(`Image generation failed for ${platform}:`, err);
        container.innerHTML = `
            <div class="social-image-error">
                <i data-lucide="alert-circle"></i>
                <span>Image generation failed. Please try again.</span>
            </div>`;
        lucide.createIcons();
    }
}

async function retrySocialImage(platform, imagePrompt) {
    const container = document.getElementById(`${platform}-image`);
    if (container) {
        container.innerHTML = `
            <div class="social-image-loading">
                <div class="spinner-small"></div>
                <span>Regenerating image...</span>
            </div>`;
    }
    await generateSingleImage(platform, imagePrompt);
}

async function copySocialText(btnEl, sourceId) {
    const sourceEl = document.getElementById(sourceId);
    if (!sourceEl) return;
    
    let textToCopy = '';
    // If it's hashtags, get text from pills
    if (sourceId.endsWith('-hashtags')) {
        const pills = sourceEl.querySelectorAll('.hashtag-pill');
        textToCopy = Array.from(pills).map(p => p.textContent).join(' ');
    } else {
        // Get innerText (strips HTML but keeps line breaks)
        textToCopy = sourceEl.innerText;
    }
    
    try {
        await navigator.clipboard.writeText(textToCopy);
        const icon = btnEl.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', 'check');
            lucide.createIcons();
            setTimeout(() => {
                icon.setAttribute('data-lucide', 'copy');
                lucide.createIcons();
            }, 2000);
        }
    } catch (err) {
        console.error('Copy failed:', err);
        // Fallback: select text
        const range = document.createRange();
        range.selectNodeContents(sourceEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function downloadSocialImage(imgSrc, platform) {
    const link = document.createElement('a');
    link.href = imgSrc;
    link.download = `social_${platform.toLowerCase()}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Drag & Drop Setup Helper
function setupDropzoneDragDrop(dropzoneId, handleFilesFn) {
    const dropzone = document.getElementById(dropzoneId);
    if (!dropzone) return;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.style.borderColor = 'var(--primary)';
            dropzone.style.background = 'rgba(99, 102, 241, 0.12)';
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.style.borderColor = '';
            dropzone.style.background = '';
        }, false);
    });
    
    dropzone.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleFilesFn({ target: { files: files } });
        }
    }, false);
}

document.addEventListener('DOMContentLoaded', () => {
    setupDropzoneDragDrop('landing-file-dropzone', handleLandingFilesUpload);
    setupDropzoneDragDrop('image-upload-dropzone', handleSocialImageUpload);
});

// ==========================================
// Keyword Gap Analysis
// ==========================================
let kwgapData = [];
let kwgapCurrentFilter = 'all';
let kwgapCurrentPage = 1;
let kwgapPageSize = 50;
let kwgapSortCol = null;
let kwgapSortAsc = true;

async function runKeywordGap() {
    const target = document.getElementById('kwgap-target').value.trim();
    const competitors = document.getElementById('kwgap-competitors').value.trim();
    if (!target || !competitors) { alert('Please enter your domain and at least one competitor.'); return; }

    document.getElementById('kwgap-loader').style.display = 'flex';
    document.getElementById('kwgap-results').style.display = 'none';

    try {
        const res = await fetch(`/api/keyword/gap?target_domain=${encodeURIComponent(target)}&competitor_domains=${encodeURIComponent(competitors)}`);
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        kwgapData = data.keywords || [];
        document.getElementById('kwgap-title').textContent = `${data.target_domain} vs ${(data.competitor_domains || []).join(', ')}`;

        const summary = data.summary || {};
        document.getElementById('kwgap-missing').textContent = (summary.missing || 0).toLocaleString();
        document.getElementById('kwgap-weak').textContent = (summary.weak || 0).toLocaleString();
        document.getElementById('kwgap-shared').textContent = (summary.shared || 0).toLocaleString();
        document.getElementById('kwgap-unique').textContent = (summary.unique || 0).toLocaleString();

        kwgapCurrentFilter = 'all';
        kwgapCurrentPage = 1;
        document.querySelectorAll('.kwgap-filter').forEach(b => {
            if (b.getAttribute('data-filter') === 'all') b.classList.add('active');
            else b.classList.remove('active');
        });

        renderKeywordGapTable();
        document.getElementById('kwgap-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
    finally { document.getElementById('kwgap-loader').style.display = 'none'; if (window.lucide) lucide.createIcons(); }
}

function filterKeywordGap(category, btn) {
    document.querySelectorAll('.kwgap-filter').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    kwgapCurrentFilter = category;
    kwgapCurrentPage = 1;
    renderKeywordGapTable();
}

function changeKwGapPageSize() {
    const sel = document.getElementById("kwgap-pagesize");
    if (sel) {
        kwgapPageSize = parseInt(sel.value, 10) || 50;
        kwgapCurrentPage = 1;
        renderKeywordGapTable();
    }
}

function prevKwGapPage() {
    if (kwgapCurrentPage > 1) {
        kwgapCurrentPage--;
        renderKeywordGapTable();
    }
}

function nextKwGapPage() {
    const filtered = getFilteredKwGapData();
    const totalPages = Math.ceil(filtered.length / kwgapPageSize) || 1;
    if (kwgapCurrentPage < totalPages) {
        kwgapCurrentPage++;
        renderKeywordGapTable();
    }
}

function sortKwGapTable(col) {
    if (!kwgapData || kwgapData.length === 0) return;
    if (kwgapSortCol === col) {
        kwgapSortAsc = !kwgapSortAsc;
    } else {
        kwgapSortCol = col;
        kwgapSortAsc = (col === "keyword" || col === "category" || col === "intent" || col === "best_competitor");
    }

    kwgapData.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        if (typeof valA === "string") {
            return kwgapSortAsc ? (valA || "").localeCompare(valB || "") : (valB || "").localeCompare(valA || "");
        }
        valA = valA !== undefined && valA !== null ? valA : 0;
        valB = valB !== undefined && valB !== null ? valB : 0;
        return kwgapSortAsc ? valA - valB : valB - valA;
    });

    renderKeywordGapTable();
}

function getFilteredKwGapData() {
    if (!kwgapData) return [];
    if (kwgapCurrentFilter === 'all') return kwgapData;
    return kwgapData.filter(kw => kw.category === kwgapCurrentFilter);
}

function renderKeywordGapTable() {
    const tbody = document.getElementById('kwgap-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = getFilteredKwGapData();
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / kwgapPageSize) || 1;

    if (kwgapCurrentPage > totalPages) kwgapCurrentPage = totalPages;
    if (kwgapCurrentPage < 1) kwgapCurrentPage = 1;

    const startIndex = (kwgapCurrentPage - 1) * kwgapPageSize;
    const endIndex = Math.min(startIndex + kwgapPageSize, totalItems);
    const pageItems = filtered.slice(startIndex, endIndex);

    tbody.innerHTML = pageItems.map(kw => {
        const catColors = { missing: 'var(--danger)', weak: 'var(--warning)', shared: 'var(--primary)', unique: 'var(--success)' };
        const catColor = catColors[kw.category] || 'var(--color-text-muted)';
        const intentColors = { Informational: '#3B82F6', Commercial: '#F59E0B', Transactional: '#10B981', Navigational: '#8B5CF6' };
        const ic = intentColors[kw.intent] || '#94A3B8';
        const pos = (kw.target_position === 0 || kw.target_position === null || kw.target_position === undefined) ? '<span style="color:var(--danger)">—</span>' : kw.target_position;
        const compPos = (kw.competitor_position === 0 || kw.competitor_position === null || kw.competitor_position === undefined) ? '<span style="color:var(--color-text-muted)">—</span>' : kw.competitor_position;
        const opp = kw.opportunity_score || 0;
        const oppColor = opp >= 70 ? 'var(--success)' : opp >= 40 ? 'var(--warning)' : 'var(--danger)';
        return `<tr data-category="${kw.category}">
            <td class="text-bright font-medium kw-cell" title="${kw.keyword}">${kw.keyword}</td>
            <td><span style="color:${catColor}; font-weight:600; text-transform:capitalize;">${kw.category}</span></td>
            <td class="text-right">${(kw.volume || 0).toLocaleString()}</td>
            <td class="text-right">${kw.difficulty || 0}%</td>
            <td class="text-right">$${(kw.cpc || 0).toFixed(2)}</td>
            <td><span style="background:${ic}22; color:${ic}; padding:2px 8px; border-radius:4px; font-size:0.8rem; font-weight:500;">${kw.intent}</span></td>
            <td class="text-center font-bold">${pos}</td>
            <td style="font-size:0.85rem; color:var(--color-text-muted);">${kw.best_competitor || '-'}</td>
            <td class="text-center font-bold">${compPos}</td>
            <td class="text-center"><span style="color:${oppColor}; font-weight:700;">${opp}</span></td>
        </tr>`;
    }).join('');

    // Update Pagination UI
    const pageRangeEl = document.getElementById("kwgap-page-range");
    const totalCountEl = document.getElementById("kwgap-total-count");
    const pageInfoEl = document.getElementById("kwgap-page-info");
    const prevBtn = document.getElementById("kwgap-prev-btn");
    const nextBtn = document.getElementById("kwgap-next-btn");

    if (pageRangeEl) {
        pageRangeEl.textContent = totalItems > 0 ? `${(startIndex + 1).toLocaleString()} - ${endIndex.toLocaleString()}` : "0 - 0";
    }
    if (totalCountEl) {
        totalCountEl.textContent = totalItems.toLocaleString();
    }
    if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${kwgapCurrentPage} / ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = kwgapCurrentPage <= 1;
        prevBtn.style.opacity = kwgapCurrentPage <= 1 ? "0.5" : "1";
        prevBtn.style.cursor = kwgapCurrentPage <= 1 ? "not-allowed" : "pointer";
    }
    if (nextBtn) {
        nextBtn.disabled = kwgapCurrentPage >= totalPages;
        nextBtn.style.opacity = kwgapCurrentPage >= totalPages ? "0.5" : "1";
        nextBtn.style.cursor = kwgapCurrentPage >= totalPages ? "not-allowed" : "pointer";
    }
}

// ==========================================
// AI Brand Monitor
// ==========================================
let bmPromptsData = [];
let bmPromptCurrentPage = 1;
let bmPromptPageSize = 25;
let bmPromptSortCol = null;
let bmPromptSortAsc = true;

async function runBrandMonitor() {
    const brand = document.getElementById('bm-brand').value.trim();
    const industry = document.getElementById('bm-industry').value.trim();
    const comps = document.getElementById('bm-competitors').value.trim();
    if (!brand) { alert('Please enter a brand name.'); return; }

    const competitors = comps ? comps.split(',').map(c => c.trim()).filter(Boolean) : [];

    document.getElementById('bm-loader').style.display = 'flex';
    document.getElementById('bm-results').style.display = 'none';

    try {
        const res = await fetch('/api/ai/brand_monitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brand_name: brand, industry, competitors })
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        // Score ring
        const score = data.ai_visibility_score || 0;
        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (score / 100) * circumference;
        const ring = document.getElementById('bm-score-ring');
        ring.style.stroke = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
        setTimeout(() => { ring.setAttribute('stroke-dashoffset', offset); }, 100);
        document.getElementById('bm-score-value').textContent = score;

        // Sentiment
        const sentiment = data.sentiment || {};
        document.getElementById('bm-sentiment').textContent = sentiment.overall || 'Neutral';
        document.getElementById('bm-sentiment').style.color = sentiment.overall === 'Positive' ? 'var(--success)' : sentiment.overall === 'Negative' ? 'var(--danger)' : 'var(--warning)';
        const descriptors = sentiment.key_descriptors || [];
        document.getElementById('bm-descriptors').innerHTML = descriptors.map(d =>
            `<span style="background: rgba(139,92,246,0.15); color: var(--accent); padding: 3px 10px; border-radius: 12px; font-size: 0.8rem;">${d}</span>`
        ).join('');

        // Frequency from competitor comparison
        const selfComp = (data.competitor_comparison || []).find(c => c.brand && c.brand.toLowerCase() === brand.toLowerCase());
        document.getElementById('bm-frequency').textContent = selfComp ? selfComp.mention_frequency : '-';
        document.getElementById('bm-avg-position').textContent = selfComp ? `Avg. Position: ${selfComp.avg_position}` : 'Avg. Position: -';

        // Competitor table
        const compTable = document.getElementById('bm-competitor-table');
        compTable.innerHTML = (data.competitor_comparison || []).map(c => {
            const cs = c.ai_visibility_score || 0;
            const cc = cs >= 70 ? 'var(--success)' : cs >= 40 ? 'var(--warning)' : 'var(--danger)';
            const ss = c.sentiment_score || 0;
            const sc = ss >= 0.6 ? 'var(--success)' : ss >= 0.3 ? 'var(--warning)' : 'var(--danger)';
            return `<tr><td class="text-bright">${c.brand}</td><td><span style="color:${cc}; font-weight:700">${cs}</span></td><td>${c.mention_frequency || '-'}</td><td>${c.avg_position || '-'}</td><td><span style="color:${sc}">${ss.toFixed(2)}</span></td></tr>`;
        }).join('');

        // Prompts with Pagination (100 prompts)
        bmPromptsData = data.prompts_analysis || [];
        bmPromptCurrentPage = 1;
        renderBmPromptsTable();

        // Recommendations (10+ items based on analysis gaps)
        document.getElementById('bm-recommendations').innerHTML = (data.recommendations || []).map((r, i) => {
            const cleanR = String(r).replace(/^\d+[\.\:\)\s]+/, '').trim();
            return `<div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:12px;"><span style="background:var(--accent); color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.75rem; flex-shrink:0;">${i+1}</span><p style="color:var(--color-text-main); line-height:1.6; margin:0;">${cleanR}</p></div>`;
        }).join('');

        document.getElementById('bm-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
    finally { document.getElementById('bm-loader').style.display = 'none'; if (window.lucide) lucide.createIcons(); }
}

function changeBmPromptPageSize() {
    const sel = document.getElementById("bm-prompt-pagesize");
    if (sel) {
        bmPromptPageSize = parseInt(sel.value, 10) || 25;
        bmPromptCurrentPage = 1;
        renderBmPromptsTable();
    }
}

function prevBmPromptPage() {
    if (bmPromptCurrentPage > 1) {
        bmPromptCurrentPage--;
        renderBmPromptsTable();
    }
}

function nextBmPromptPage() {
    const totalItems = bmPromptsData ? bmPromptsData.length : 0;
    const totalPages = Math.ceil(totalItems / bmPromptPageSize) || 1;
    if (bmPromptCurrentPage < totalPages) {
        bmPromptCurrentPage++;
        renderBmPromptsTable();
    }
}

function sortBmPromptTable(col) {
    if (!bmPromptsData || bmPromptsData.length === 0) return;
    if (bmPromptSortCol === col) {
        bmPromptSortAsc = !bmPromptSortAsc;
    } else {
        bmPromptSortCol = col;
        bmPromptSortAsc = (col === "prompt" || col === "sentiment");
    }

    bmPromptsData.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        if (typeof valA === "string") {
            return bmPromptSortAsc ? (valA || "").localeCompare(valB || "") : (valB || "").localeCompare(valA || "");
        }
        if (typeof valA === "boolean") {
            return bmPromptSortAsc ? (valA === valB ? 0 : valA ? -1 : 1) : (valA === valB ? 0 : valA ? 1 : -1);
        }
        valA = valA !== undefined && valA !== null ? valA : 999;
        valB = valB !== undefined && valB !== null ? valB : 999;
        return bmPromptSortAsc ? valA - valB : valB - valA;
    });

    renderBmPromptsTable();
}

function renderBmPromptsTable() {
    const tbody = document.getElementById("bm-prompts-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const totalItems = bmPromptsData ? bmPromptsData.length : 0;
    const totalPages = Math.ceil(totalItems / bmPromptPageSize) || 1;

    if (bmPromptCurrentPage > totalPages) bmPromptCurrentPage = totalPages;
    if (bmPromptCurrentPage < 1) bmPromptCurrentPage = 1;

    const startIndex = (bmPromptCurrentPage - 1) * bmPromptPageSize;
    const endIndex = Math.min(startIndex + bmPromptPageSize, totalItems);
    const pageItems = (bmPromptsData || []).slice(startIndex, endIndex);

    tbody.innerHTML = pageItems.map(p => {
        const mentioned = p.brand_mentioned
            ? '<span style="color:var(--success); font-weight:600;">✓ Yes</span>'
            : '<span style="color:var(--danger); font-weight:600;">✗ No</span>';
        const sent = p.sentiment || 'Neutral';
        const sentColor = sent.toLowerCase().includes('positive') ? 'var(--success)' : sent.toLowerCase().includes('negative') ? 'var(--danger)' : 'var(--warning)';
        const posText = p.mention_position !== null && p.mention_position !== undefined ? `#${p.mention_position}` : '—';
        return `<tr>
            <td class="text-bright" style="max-width:280px; font-size:0.9rem;">${p.prompt}</td>
            <td>${mentioned}</td>
            <td style="font-weight:600;">${posText}</td>
            <td><span style="color:${sentColor}; font-weight:500;">${sent}</span></td>
            <td style="font-size:0.85rem; color:var(--color-text-muted); max-width:260px;">${p.context || ''}</td>
        </tr>`;
    }).join('');

    // Update Pagination UI
    const pageRangeEl = document.getElementById("bm-prompt-range");
    const totalCountEl = document.getElementById("bm-prompt-total");
    const pageInfoEl = document.getElementById("bm-prompt-page-info");
    const prevBtn = document.getElementById("bm-prompt-prev-btn");
    const nextBtn = document.getElementById("bm-prompt-next-btn");

    if (pageRangeEl) {
        pageRangeEl.textContent = totalItems > 0 ? `${(startIndex + 1).toLocaleString()} - ${endIndex.toLocaleString()}` : "0 - 0";
    }
    if (totalCountEl) {
        totalCountEl.textContent = totalItems.toLocaleString();
    }
    if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${bmPromptCurrentPage} / ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = bmPromptCurrentPage <= 1;
        prevBtn.style.opacity = bmPromptCurrentPage <= 1 ? "0.5" : "1";
        prevBtn.style.cursor = bmPromptCurrentPage <= 1 ? "not-allowed" : "pointer";
    }
    if (nextBtn) {
        nextBtn.disabled = bmPromptCurrentPage >= totalPages;
        nextBtn.style.opacity = bmPromptCurrentPage >= totalPages ? "0.5" : "1";
        nextBtn.style.cursor = bmPromptCurrentPage >= totalPages ? "not-allowed" : "pointer";
    }
}



// ==========================================
// Deep Site Crawl
// ==========================================
let dcPagesData = [];
let dcCurrentPage = 1;
let dcPageSize = 50;
let dcSortCol = null;
let dcSortAsc = true;

async function runDeepCrawl() {
    const url = document.getElementById('dc-url').value.trim();
    const maxPages = document.getElementById('dc-max-pages').value;
    if (!url) { alert('Please enter a website URL.'); return; }

    document.getElementById('dc-loader').style.display = 'flex';
    document.getElementById('dc-results').style.display = 'none';

    try {
        const res = await fetch('/api/audit/deep_crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, max_pages: parseInt(maxPages) })
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        // Health score ring
        const health = data.health_score || 0;
        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (health / 100) * circumference;
        const ring = document.getElementById('dc-health-ring');
        ring.style.stroke = health >= 70 ? 'var(--success)' : health >= 40 ? 'var(--warning)' : 'var(--danger)';
        setTimeout(() => { ring.setAttribute('stroke-dashoffset', offset); }, 100);
        document.getElementById('dc-health-value').textContent = health;

        document.getElementById('dc-pages-count').textContent = data.pages_crawled || 0;
        document.getElementById('dc-errors').textContent = data.errors || 0;
        document.getElementById('dc-warnings').textContent = data.warnings || 0;

        const summary = data.summary || {};
        document.getElementById('dc-avg-size').textContent = (summary.avg_page_size_kb || 0) + ' KB';
        document.getElementById('dc-avg-time').textContent = (summary.avg_response_time || 0) + 's';
        document.getElementById('dc-no-title').textContent = summary.pages_without_title || 0;
        document.getElementById('dc-no-desc').textContent = summary.pages_without_desc || 0;

        // Broken links
        const brokenLinks = data.broken_links || [];
        if (brokenLinks.length > 0) {
            document.getElementById('dc-broken-section').style.display = 'block';
            document.getElementById('dc-broken-list').innerHTML = brokenLinks.map(bl =>
                `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-glass);"><span style="color:var(--color-text-main); font-size:0.9rem; word-break:break-all;">${bl.url}</span><span style="color:var(--danger); font-weight:600;">${bl.status}</span></div>`
            ).join('');
        } else {
            document.getElementById('dc-broken-section').style.display = 'none';
        }

        // Duplicate titles
        const dupes = data.duplicate_titles || [];
        if (dupes.length > 0) {
            document.getElementById('dc-dupe-section').style.display = 'block';
            document.getElementById('dc-dupe-list').innerHTML = dupes.map(d =>
                `<div style="padding:6px 0; border-bottom:1px solid var(--border-glass); color:var(--warning); font-size:0.9rem;">"${d}"</div>`
            ).join('');
        } else {
            document.getElementById('dc-dupe-section').style.display = 'none';
        }

        // Set pages data and render paginated table
        dcPagesData = data.pages || [];
        dcCurrentPage = 1;
        renderDcPagesTable();

        document.getElementById('dc-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
    finally { document.getElementById('dc-loader').style.display = 'none'; if (window.lucide) lucide.createIcons(); }
}

function changeDcPageSize() {
    const sel = document.getElementById("dc-pagesize");
    if (sel) {
        dcPageSize = parseInt(sel.value, 10) || 50;
        dcCurrentPage = 1;
        renderDcPagesTable();
    }
}

function prevDcPage() {
    if (dcCurrentPage > 1) {
        dcCurrentPage--;
        renderDcPagesTable();
    }
}

function nextDcPage() {
    const totalItems = dcPagesData ? dcPagesData.length : 0;
    const totalPages = Math.ceil(totalItems / dcPageSize) || 1;
    if (dcCurrentPage < totalPages) {
        dcCurrentPage++;
        renderDcPagesTable();
    }
}

function sortDcTable(col) {
    if (!dcPagesData || dcPagesData.length === 0) return;
    if (dcSortCol === col) {
        dcSortAsc = !dcSortAsc;
    } else {
        dcSortCol = col;
        dcSortAsc = (col === "url" || col === "title");
    }

    dcPagesData.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        if (typeof valA === "string") {
            return dcSortAsc ? (valA || "").localeCompare(valB || "") : (valB || "").localeCompare(valA || "");
        }
        valA = valA !== undefined ? valA : 0;
        valB = valB !== undefined ? valB : 0;
        return dcSortAsc ? valA - valB : valB - valA;
    });

    renderDcPagesTable();
}

function renderDcPagesTable() {
    const tbody = document.getElementById("dc-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const totalItems = dcPagesData ? dcPagesData.length : 0;
    const totalPages = Math.ceil(totalItems / dcPageSize) || 1;

    if (dcCurrentPage > totalPages) dcCurrentPage = totalPages;
    if (dcCurrentPage < 1) dcCurrentPage = 1;

    const startIndex = (dcCurrentPage - 1) * dcPageSize;
    const endIndex = Math.min(startIndex + dcPageSize, totalItems);
    const pageItems = (dcPagesData || []).slice(startIndex, endIndex);

    tbody.innerHTML = pageItems.map(p => {
        const statusColor = p.status === 200 ? 'var(--success)' : 'var(--warning)';
        const pScore = p.page_score !== undefined ? p.page_score : 100;
        const pScoreColor = pScore >= 80 ? 'var(--success)' : pScore >= 50 ? 'var(--warning)' : 'var(--danger)';
        const issuesBadge = p.issues_count > 0
            ? `<span style="background:${p.issues && p.issues.some(i=>i.type==='error') ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)'}; color:${p.issues && p.issues.some(i=>i.type==='error') ? 'var(--danger)' : 'var(--warning)'}; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${p.issues_count} issues</span>`
            : '<span style="color:var(--success); font-size:0.8rem;">✓ Clean</span>';
        const shortUrl = p.url.replace(/^https?:\/\//, '').substring(0, 50);
        return `<tr>
            <td style="font-size:0.85rem; max-width:220px; word-break:break-all;" title="${p.url}">
                <a href="${p.url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${shortUrl}</a>
            </td>
            <td><span style="color:${statusColor}">${p.status}</span></td>
            <td><span style="color:${pScoreColor}; font-weight:700;">${pScore}</span></td>
            <td style="font-size:0.85rem; max-width:200px;" title="${p.title}">${p.title.substring(0, 40)}</td>
            <td>${p.page_size_kb} KB</td>
            <td>${p.response_time}s</td>
            <td>${issuesBadge}</td>
        </tr>`;
    }).join('');

    // Update Pagination UI
    const pageRangeEl = document.getElementById("dc-page-range");
    const totalCountEl = document.getElementById("dc-total-count");
    const pageInfoEl = document.getElementById("dc-page-info");
    const prevBtn = document.getElementById("dc-prev-btn");
    const nextBtn = document.getElementById("dc-next-btn");

    if (pageRangeEl) {
        pageRangeEl.textContent = totalItems > 0 ? `${(startIndex + 1).toLocaleString()} - ${endIndex.toLocaleString()}` : "0 - 0";
    }
    if (totalCountEl) {
        totalCountEl.textContent = totalItems.toLocaleString();
    }
    if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${dcCurrentPage} / ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = dcCurrentPage <= 1;
        prevBtn.style.opacity = dcCurrentPage <= 1 ? "0.5" : "1";
        prevBtn.style.cursor = dcCurrentPage <= 1 ? "not-allowed" : "pointer";
    }
    if (nextBtn) {
        nextBtn.disabled = dcCurrentPage >= totalPages;
        nextBtn.style.opacity = dcCurrentPage >= totalPages ? "0.5" : "1";
        nextBtn.style.cursor = dcCurrentPage >= totalPages ? "not-allowed" : "pointer";
    }
}


// ==========================================
// Competitor Content Analyzer (Deep Analysis)
// ==========================================
async function runCompetitorContent() {
    const url = document.getElementById('cc-url').value.trim();
    const keyword = document.getElementById('cc-keyword').value.trim();
    if (!url) { alert('Please enter a competitor URL.'); return; }

    document.getElementById('cc-loader').style.display = 'flex';
    document.getElementById('cc-results').style.display = 'none';

    try {
        const res = await fetch('/api/ai/competitor_content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, keyword })
        });
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        // --- Content score ring ---
        const score = data.content_score || 0;
        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (score / 100) * circumference;
        const ring = document.getElementById('cc-score-ring');
        ring.style.stroke = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
        setTimeout(() => { ring.setAttribute('stroke-dashoffset', offset); }, 100);
        document.getElementById('cc-score-value').textContent = score;

        const analysis = data.analysis || {};
        const metrics = analysis.content_metrics || {};
        const seo = analysis.seo_quality || {};
        const strategy = analysis.content_strategy || {};
        const kwAnalysis = analysis.keyword_analysis || {};
        const eeat = analysis.eeat_assessment || {};
        const ux = analysis.user_experience || {};
        const links = analysis.link_strategy || {};

        // --- Top metric cards ---
        document.getElementById('cc-wordcount').textContent = (metrics.word_count || 0).toLocaleString();
        document.getElementById('cc-readtime').textContent = `Reading time: ${metrics.reading_time || '-'}`;
        document.getElementById('cc-seo-score').textContent = (seo.score || 0) + '/100';
        document.getElementById('cc-readability').textContent = `Readability: ${metrics.readability_level || '-'}`;
        document.getElementById('cc-depth').textContent = `${strategy.depth_rating || 0}/10`;
        document.getElementById('cc-tone').textContent = `Tone: ${strategy.tone || '-'}`;

        // --- Content Strategy Overview ---
        const stratItems = [
            { label: 'Topic Coverage', value: strategy.topic_coverage || '-', icon: '📊' },
            { label: 'Target Audience', value: strategy.target_audience || '-', icon: '👥' },
            { label: 'Content Type', value: strategy.content_type || '-', icon: '📄' },
            { label: 'Content Freshness', value: strategy.content_freshness || '-', icon: '🕐' },
            { label: 'Unique Angle', value: strategy.unique_angle || '-', icon: '💡' }
        ];
        document.getElementById('cc-strategy-overview').innerHTML = stratItems.map(s =>
            `<div style="background:rgba(0,0,0,0.2); border:1px solid var(--border-glass); border-radius:8px; padding:14px;">
                <div style="font-size:0.8rem; color:var(--color-text-muted); margin-bottom:6px;">${s.icon} ${s.label}</div>
                <div style="color:var(--color-text-bright); font-size:0.9rem; line-height:1.5;">${s.value}</div>
            </div>`
        ).join('');

        // --- Technical SEO Audit ---
        const seoRows = [
            ['Title Tag', seo.title_optimization],
            ['Meta Description', seo.meta_description],
            ['Heading Structure', seo.heading_structure],
            ['Keyword Density', seo.keyword_density],
            ['URL Structure', seo.url_structure],
            ['Schema Markup', seo.schema_markup],
            ['Image Optimization', seo.image_optimization],
            ['Canonical Setup', seo.canonical_setup],
            ['Robots Directives', seo.robots_directives]
        ].filter(r => r[1]);
        document.getElementById('cc-seo-audit').innerHTML = `
            <table class="data-table">
                <thead><tr><th style="width:200px;">Factor</th><th>Assessment</th></tr></thead>
                <tbody>${seoRows.map(r => `<tr>
                    <td class="text-bright" style="font-weight:500;">${r[0]}</td>
                    <td style="color:var(--color-text-main); line-height:1.6; font-size:0.9rem;">${r[1]}</td>
                </tr>`).join('')}</tbody>
            </table>`;

        // --- Keyword Analysis ---
        const kwChecks = [
            { label: 'In Title', val: kwAnalysis.keyword_in_title },
            { label: 'In H1', val: kwAnalysis.keyword_in_h1 },
            { label: 'In First 100 Words', val: kwAnalysis.keyword_in_first_100_words },
            { label: 'In URL', val: kwAnalysis.keyword_in_url }
        ];
        const kwCheckHtml = kwChecks.map(c => {
            const icon = c.val ? '✅' : '❌';
            const color = c.val ? 'var(--success)' : 'var(--danger)';
            return `<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; background:rgba(0,0,0,0.2); border-radius:6px; font-size:0.85rem; color:${color};">${icon} ${c.label}</span>`;
        }).join('');

        const secondaryKws = (kwAnalysis.secondary_keywords || []).map(kw =>
            `<span style="display:inline-block; padding:3px 10px; background:rgba(139,92,246,0.15); color:var(--accent); border-radius:12px; font-size:0.8rem; margin:3px 2px;">${kw}</span>`
        ).join('');

        const lsiKws = (kwAnalysis.lsi_keywords_present || []).map(kw =>
            `<span style="display:inline-block; padding:3px 10px; background:rgba(56,189,248,0.12); color:var(--primary); border-radius:12px; font-size:0.8rem; margin:3px 2px;">${kw}</span>`
        ).join('');

        const missingKws = (kwAnalysis.missing_keyword_opportunities || []).map(kw =>
            `<span style="display:inline-block; padding:3px 10px; background:rgba(239,68,68,0.12); color:var(--danger); border-radius:12px; font-size:0.8rem; margin:3px 2px;">${kw}</span>`
        ).join('');

        document.getElementById('cc-keyword-analysis').innerHTML = `
            <div style="margin-bottom:16px;">
                <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
                    <div style="background:rgba(139,92,246,0.2); padding:8px 16px; border-radius:8px; border:1px solid rgba(139,92,246,0.3);">
                        <span style="color:var(--color-text-muted); font-size:0.75rem;">Primary Keyword</span><br>
                        <span style="color:var(--accent); font-weight:600; font-size:1.1rem;">${kwAnalysis.primary_keyword || '-'}</span>
                    </div>
                    <div style="background:rgba(0,0,0,0.2); padding:8px 16px; border-radius:8px; border:1px solid var(--border-glass);">
                        <span style="color:var(--color-text-muted); font-size:0.75rem;">Density</span><br>
                        <span style="color:var(--color-text-bright); font-weight:600; font-size:1.1rem;">${kwAnalysis.primary_keyword_density || 0}%</span>
                    </div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px;">${kwCheckHtml}</div>
                <div style="color:var(--color-text-main); font-size:0.9rem; line-height:1.6; margin-bottom:16px; padding:10px; background:rgba(0,0,0,0.15); border-radius:6px;">
                    <strong style="color:var(--color-text-bright);">Search Intent:</strong> ${kwAnalysis.search_intent_alignment || '-'}
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <h5 style="color:var(--color-text-bright); margin-bottom:8px; font-size:0.85rem;">Secondary Keywords</h5>
                <div style="display:flex; flex-wrap:wrap;">${secondaryKws || '<span style="color:var(--color-text-muted); font-size:0.85rem;">None detected</span>'}</div>
            </div>
            <div style="margin-bottom:14px;">
                <h5 style="color:var(--color-text-bright); margin-bottom:8px; font-size:0.85rem;">LSI Keywords Present</h5>
                <div style="display:flex; flex-wrap:wrap;">${lsiKws || '<span style="color:var(--color-text-muted); font-size:0.85rem;">None detected</span>'}</div>
            </div>
            <div>
                <h5 style="color:var(--color-text-bright); margin-bottom:8px; font-size:0.85rem;">⚠️ Missing Keyword Opportunities</h5>
                <div style="display:flex; flex-wrap:wrap;">${missingKws || '<span style="color:var(--color-text-muted); font-size:0.85rem;">None identified</span>'}</div>
            </div>`;

        // --- E-E-A-T Assessment ---
        const eeatDimensions = [
            { label: 'Experience', score: eeat.experience_score || 0, detail: eeat.experience_signals, color: '#38bdf8' },
            { label: 'Expertise', score: eeat.expertise_score || 0, detail: eeat.expertise_indicators, color: '#8b5cf6' },
            { label: 'Authority', score: eeat.authority_score || 0, detail: eeat.authority_markers, color: '#f59e0b' },
            { label: 'Trust', score: eeat.trust_score || 0, detail: eeat.trust_factors, color: '#22c55e' }
        ];
        document.getElementById('cc-eeat').innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap;">
                <div style="background:rgba(0,0,0,0.2); padding:10px 20px; border-radius:8px; border:1px solid var(--border-glass);">
                    <span style="color:var(--color-text-muted); font-size:0.75rem;">Overall E-E-A-T</span><br>
                    <span style="color:var(--color-text-bright); font-weight:700; font-size:1.3rem;">${eeat.overall_eeat || '-'}</span>
                </div>
            </div>
            ${eeatDimensions.map(d => `
                <div style="margin-bottom:16px; padding:12px; background:rgba(0,0,0,0.15); border-radius:8px; border-left:3px solid ${d.color};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="color:var(--color-text-bright); font-weight:600;">${d.label}</span>
                        <span style="color:${d.color}; font-weight:700; font-size:1.1rem;">${d.score}/10</span>
                    </div>
                    <div style="width:100%; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; margin-bottom:8px; overflow:hidden;">
                        <div style="width:${d.score * 10}%; height:100%; background:${d.color}; border-radius:3px; transition:width 0.6s ease;"></div>
                    </div>
                    <p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:0;">${d.detail || '-'}</p>
                </div>
            `).join('')}`;

        // --- User Experience Analysis ---
        const uxItems = [
            { label: 'Scannability', value: `${ux.scannability_score || 0}/10`, icon: '👁️' },
            { label: 'Mobile Readiness', value: ux.mobile_readiness || '-', icon: '📱' },
            { label: 'CTA Effectiveness', value: ux.cta_effectiveness || '-', icon: '🎯' },
            { label: 'Visual Content Ratio', value: ux.visual_content_ratio || '-', icon: '🖼️' },
            { label: 'Engagement Hooks', value: ux.engagement_hooks || '-', icon: '🪝' },
            { label: 'Content Flow', value: ux.content_flow || '-', icon: '🔄' }
        ];
        document.getElementById('cc-ux-analysis').innerHTML = uxItems.map(item =>
            `<div style="padding:12px 0; border-bottom:1px solid var(--border-glass); display:flex; gap:12px; align-items:flex-start;">
                <span style="font-size:1.2rem; flex-shrink:0;">${item.icon}</span>
                <div>
                    <div style="color:var(--color-text-bright); font-weight:500; margin-bottom:4px; font-size:0.9rem;">${item.label}: <span style="color:var(--primary);">${item.value}</span></div>
                </div>
            </div>`
        ).join('');

        // --- Link Strategy ---
        const linkItems = [
            { label: 'Internal Links', value: links.internal_links || 0 },
            { label: 'External Links', value: links.external_links || 0 },
            { label: 'Link Quality', value: links.link_quality || '-' },
            { label: 'Anchor Text Diversity', value: links.anchor_text_diversity || '-' },
            { label: 'Contextual Linking', value: links.contextual_linking || '-' },
            { label: 'Missed Opportunities', value: links.link_opportunities_missed || '-' }
        ];
        document.getElementById('cc-link-strategy').innerHTML = `
            <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
                <div style="background:rgba(56,189,248,0.1); padding:10px 20px; border-radius:8px; text-align:center; border:1px solid rgba(56,189,248,0.2);">
                    <div style="color:var(--primary); font-size:1.5rem; font-weight:700;">${links.internal_links || 0}</div>
                    <div style="color:var(--color-text-muted); font-size:0.75rem;">Internal</div>
                </div>
                <div style="background:rgba(139,92,246,0.1); padding:10px 20px; border-radius:8px; text-align:center; border:1px solid rgba(139,92,246,0.2);">
                    <div style="color:var(--accent); font-size:1.5rem; font-weight:700;">${links.external_links || 0}</div>
                    <div style="color:var(--color-text-muted); font-size:0.75rem;">External</div>
                </div>
            </div>
            ${linkItems.slice(2).map(li => `
                <div style="padding:10px 0; border-bottom:1px solid var(--border-glass);">
                    <span style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${li.label}:</span>
                    <span style="color:var(--color-text-main); font-size:0.9rem; margin-left:8px;">${li.value}</span>
                </div>
            `).join('')}`;

        // --- Strengths (rich format with category badges) ---
        const strengths = data.strengths || [];
        document.getElementById('cc-strengths-count').textContent = `(${strengths.length})`;
        const catColors = { content: '#38bdf8', seo: '#22c55e', ux: '#f59e0b', authority: '#8b5cf6' };
        document.getElementById('cc-strengths').innerHTML = strengths.map(s => {
            const isObj = typeof s === 'object';
            const title = isObj ? s.title : s;
            const detail = isObj ? s.detail : '';
            const cat = isObj ? (s.category || '') : '';
            const catColor = catColors[cat] || 'var(--color-text-muted)';
            return `<div style="padding:10px 0; border-bottom:1px solid var(--border-glass);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:${detail ? '4px' : '0'};">
                    <span style="color:var(--success); flex-shrink:0;">✓</span>
                    <span style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${title}</span>
                    ${cat ? `<span style="background:${catColor}22; color:${catColor}; padding:1px 8px; border-radius:10px; font-size:0.7rem; text-transform:uppercase;">${cat}</span>` : ''}
                </div>
                ${detail ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:4px 0 0 22px;">${detail}</p>` : ''}
            </div>`;
        }).join('');

        // --- Weaknesses (rich format with severity badges) ---
        const weaknesses = data.weaknesses || [];
        document.getElementById('cc-weaknesses-count').textContent = `(${weaknesses.length})`;
        const sevColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };
        document.getElementById('cc-weaknesses').innerHTML = weaknesses.map(w => {
            const isObj = typeof w === 'object';
            const title = isObj ? w.title : w;
            const detail = isObj ? w.detail : '';
            const sev = isObj ? (w.severity || '') : '';
            const sevColor = sevColors[sev] || 'var(--color-text-muted)';
            return `<div style="padding:10px 0; border-bottom:1px solid var(--border-glass);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:${detail ? '4px' : '0'};">
                    <span style="color:var(--danger); flex-shrink:0;">✗</span>
                    <span style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${title}</span>
                    ${sev ? `<span style="background:${sevColor}22; color:${sevColor}; padding:1px 8px; border-radius:10px; font-size:0.7rem; text-transform:uppercase; font-weight:600;">${sev}</span>` : ''}
                </div>
                ${detail ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:4px 0 0 22px;">${detail}</p>` : ''}
            </div>`;
        }).join('');

        // --- Content Gaps (with priority + search volume potential) ---
        const gaps = data.content_gaps || [];
        document.getElementById('cc-gaps-count').textContent = `(${gaps.length})`;
        const prioColors = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' };
        document.getElementById('cc-gaps').innerHTML = gaps.map(g => {
            const isObj = typeof g === 'object';
            const title = isObj ? g.title : g;
            const detail = isObj ? g.detail : '';
            const prio = isObj ? (g.priority || '') : '';
            const svp = isObj ? (g.search_volume_potential || '') : '';
            const prioColor = prioColors[prio] || 'var(--color-text-muted)';
            return `<div style="padding:12px 0; border-bottom:1px solid var(--border-glass);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:${detail ? '6px' : '0'}; flex-wrap:wrap;">
                    <span style="color:var(--warning); flex-shrink:0;">⚡</span>
                    <span style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${title}</span>
                    ${prio ? `<span style="background:${prioColor}22; color:${prioColor}; padding:1px 8px; border-radius:10px; font-size:0.7rem; text-transform:uppercase;">Priority: ${prio}</span>` : ''}
                    ${svp ? `<span style="background:rgba(56,189,248,0.12); color:var(--primary); padding:1px 8px; border-radius:10px; font-size:0.7rem; text-transform:uppercase;">Vol: ${svp}</span>` : ''}
                </div>
                ${detail ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:4px 0 0 22px;">${detail}</p>` : ''}
            </div>`;
        }).join('');

        // --- Opportunities Matrix ---
        const opps = data.opportunities || [];
        const impactColors = { high: '#22c55e', medium: '#f59e0b', low: '#6b7280' };
        const effortColors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
        document.getElementById('cc-opportunities').innerHTML = opps.length ? `
            <table class="data-table">
                <thead><tr><th>Opportunity</th><th style="width:80px;">Impact</th><th style="width:80px;">Effort</th></tr></thead>
                <tbody>${opps.map(o => {
                    const isObj = typeof o === 'object';
                    const title = isObj ? o.title : o;
                    const detail = isObj ? o.detail : '';
                    const impact = isObj ? (o.impact || '') : '';
                    const effort = isObj ? (o.effort || '') : '';
                    return `<tr>
                        <td>
                            <div style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${title}</div>
                            ${detail ? `<div style="color:var(--color-text-main); font-size:0.8rem; margin-top:3px; line-height:1.4;">${detail}</div>` : ''}
                        </td>
                        <td><span style="background:${(impactColors[impact] || '#6b7280')}22; color:${impactColors[impact] || '#6b7280'}; padding:2px 8px; border-radius:10px; font-size:0.75rem; text-transform:uppercase; font-weight:600;">${impact}</span></td>
                        <td><span style="background:${(effortColors[effort] || '#6b7280')}22; color:${effortColors[effort] || '#6b7280'}; padding:2px 8px; border-radius:10px; font-size:0.75rem; text-transform:uppercase; font-weight:600;">${effort}</span></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        ` : '<p style="color:var(--color-text-muted);">No opportunities data</p>';

        // --- Beat Plan (massive deep version) ---
        const plan = data.beat_plan || {};
        let beatHtml = '';

        // Content format recommendation
        if (plan.content_format_recommendation) {
            beatHtml += `
            <div style="background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.2); border-radius:8px; padding:14px; margin-bottom:20px;">
                <div style="color:var(--accent); font-weight:600; font-size:0.85rem; margin-bottom:4px;">📋 Recommended Format</div>
                <div style="color:var(--color-text-main); font-size:0.9rem; line-height:1.5;">${plan.content_format_recommendation}</div>
            </div>`;
        }

        // Priority Actions
        const actions = plan.priority_actions || [];
        beatHtml += `<h4 class="text-bright" style="margin-bottom:12px;">🎯 Priority Actions (${actions.length})</h4>`;
        beatHtml += actions.map((a, i) => {
            const isObj = typeof a === 'object';
            const action = isObj ? a.action : a;
            const impact = isObj ? (a.impact || '') : '';
            const effort = isObj ? (a.effort || '') : '';
            const rationale = isObj ? (a.rationale || '') : '';
            return `<div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:12px; padding:10px; background:rgba(0,0,0,0.15); border-radius:8px;">
                <span style="background:var(--primary); color:white; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.75rem; flex-shrink:0; font-weight:600;">${i+1}</span>
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:${rationale ? '4px' : '0'};">
                        <span style="color:var(--color-text-bright); font-weight:500; font-size:0.9rem;">${action}</span>
                        ${impact ? `<span style="background:${(impactColors[impact] || '#6b7280')}22; color:${impactColors[impact] || '#6b7280'}; padding:1px 6px; border-radius:8px; font-size:0.7rem; text-transform:uppercase;">Impact: ${impact}</span>` : ''}
                        ${effort ? `<span style="background:${(effortColors[effort] || '#6b7280')}22; color:${effortColors[effort] || '#6b7280'}; padding:1px 6px; border-radius:8px; font-size:0.7rem; text-transform:uppercase;">Effort: ${effort}</span>` : ''}
                    </div>
                    ${rationale ? `<p style="color:var(--color-text-muted); font-size:0.82rem; line-height:1.4; margin:2px 0 0 0; font-style:italic;">${rationale}</p>` : ''}
                </div>
            </div>`;
        }).join('');

        // Unique Angles
        const angles = plan.unique_angles || [];
        if (angles.length) {
            beatHtml += `<h4 class="text-bright" style="margin: 24px 0 12px;">💡 Unique Angles to Differentiate (${angles.length})</h4>`;
            beatHtml += angles.map(a => {
                const isObj = typeof a === 'object';
                const angle = isObj ? a.angle : a;
                const desc = isObj ? a.description : '';
                return `<div style="padding:10px; margin-bottom:8px; background:rgba(34,197,94,0.06); border-left:3px solid var(--success); border-radius:0 6px 6px 0;">
                    <div style="color:var(--success); font-weight:500; font-size:0.9rem;">→ ${angle}</div>
                    ${desc ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:4px 0 0 16px;">${desc}</p>` : ''}
                </div>`;
            }).join('');
        }

        // Must-Include Sections
        const sections = plan.must_include_sections || [];
        if (sections.length) {
            beatHtml += `<h4 class="text-bright" style="margin: 24px 0 12px;">📝 Must-Include Sections (${sections.length})</h4>`;
            beatHtml += sections.map(s => {
                const isObj = typeof s === 'object';
                const title = isObj ? s.title : s;
                const desc = isObj ? s.description : '';
                const words = isObj ? s.target_words : 0;
                return `<div style="padding:10px; margin-bottom:8px; background:rgba(245,158,11,0.06); border-left:3px solid var(--warning); border-radius:0 6px 6px 0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--warning); font-weight:500; font-size:0.9rem;">${title}</span>
                        ${words ? `<span style="background:rgba(245,158,11,0.15); color:var(--warning); padding:1px 8px; border-radius:8px; font-size:0.7rem;">~${words} words</span>` : ''}
                    </div>
                    ${desc ? `<p style="color:var(--color-text-main); font-size:0.85rem; line-height:1.5; margin:4px 0 0 0;">${desc}</p>` : ''}
                </div>`;
            }).join('');
        }

        // Media Recommendations
        const media = plan.media_recommendations || [];
        if (media.length) {
            beatHtml += `<h4 class="text-bright" style="margin: 24px 0 12px;">🎨 Media Recommendations (${media.length})</h4>`;
            const mediaTypeColors = { infographic: '#8b5cf6', video: '#ef4444', interactive: '#38bdf8', screenshot: '#22c55e', chart: '#f59e0b', table: '#6366f1' };
            beatHtml += media.map(m => {
                const isObj = typeof m === 'object';
                const type = isObj ? (m.type || '') : '';
                const desc = isObj ? m.description : m;
                const typeColor = mediaTypeColors[type.toLowerCase()] || 'var(--accent)';
                return `<div style="padding:10px; margin-bottom:8px; background:rgba(139,92,246,0.06); border-left:3px solid ${typeColor}; border-radius:0 6px 6px 0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${type ? `<span style="background:${typeColor}22; color:${typeColor}; padding:1px 8px; border-radius:8px; font-size:0.7rem; text-transform:uppercase; font-weight:600;">${type}</span>` : ''}
                        <span style="color:var(--color-text-main); font-size:0.9rem;">${desc}</span>
                    </div>
                </div>`;
            }).join('');
        }

        // Internal Linking Plan
        const ilPlan = plan.internal_linking_plan || [];
        if (ilPlan.length) {
            beatHtml += `<h4 class="text-bright" style="margin: 24px 0 12px;">🔗 Internal Linking Plan (${ilPlan.length})</h4>`;
            beatHtml += ilPlan.map(link =>
                `<div style="padding:8px 0; border-bottom:1px solid var(--border-glass); color:var(--primary); font-size:0.9rem; line-height:1.5;">🔗 ${link}</div>`
            ).join('');
        }

        // Schema Recommendations
        const schemaRecs = plan.schema_recommendations || [];
        if (schemaRecs.length) {
            beatHtml += `<h4 class="text-bright" style="margin: 24px 0 12px;">🏗️ Schema Markup Recommendations (${schemaRecs.length})</h4>`;
            beatHtml += schemaRecs.map(sr =>
                `<div style="padding:8px 0; border-bottom:1px solid var(--border-glass); color:var(--accent); font-size:0.9rem; line-height:1.5;">📐 ${sr}</div>`
            ).join('');
        }

        document.getElementById('cc-beat-plan').innerHTML = beatHtml;

        document.getElementById('cc-results').style.display = 'block';
    } catch (e) { alert('Error: ' + e.message); }
    finally { document.getElementById('cc-loader').style.display = 'none'; if (window.lucide) lucide.createIcons(); }
}
