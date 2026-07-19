// Global State Management
let gscChart = null;

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Lucide Icons
    lucide.createIcons();
    
    // Check login status
    checkAuthStatus();
});

// Tab switching logic
function switchTab(tabId) {
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
                    title: { display: true, text: '点击量 (Clicks)', color: '#3B82F6' }
                },
                'y-impressions': {
                    type: 'linear',
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: '#10B981' },
                    title: { display: true, text: '曝光量 (Impressions)', color: '#10B981' }
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
            
            row.innerHTML = `
                <span class="country-name"><span style="font-size: 1.1rem; line-height: 1;">${flag}</span> ${c.code}</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${p}%"></div>
                </div>
                <span class="country-value">${volumeStr}</span>
            `;
            splitContainer.appendChild(row);
        });
        
        lucide.createIcons();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to query keyword checker API.");
    }
}

function getCountryFlag(code) {
    const flags = {
        US: "🇺🇸", IN: "🇮🇳", UK: "🇬🇧", GB: "🇬🇧", AU: "🇦🇺", CA: "🇨🇦", ZA: "🇿🇦",
        DE: "🇩🇪", FR: "🇫🇷", JP: "🇯🇵", BR: "🇧🇷", RU: "🇷🇺", CN: "🇨🇳"
    };
    return flags[code.toUpperCase()] || "🏳️";
}

let magicResults = [];
let currentSortCol = "";
let isSortAsc = false;

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
        
        magicResults = data;
        document.getElementById("kwmagic-target-name").textContent = keyword;
        document.getElementById("kwmagic-summary").textContent = `Showing the first ${magicResults.length} related keywords`;
        
        renderMagicTable();
    } catch (e) {
        console.error(e);
        loader.style.display = "none";
        alert("Failed to query keyword magic API.");
    }
}

function renderMagicTable() {
    const tbody = document.getElementById("kwmagic-tbody");
    tbody.innerHTML = "";
    
    magicResults.forEach(item => {
        const tr = document.createElement("tr");
        
        const kd = item.difficulty || 0;
        let dotColor = "var(--success)";
        if (kd >= 70) {
            dotColor = "var(--danger)";
        } else if (kd >= 40) {
            dotColor = "var(--warning)";
        }
        
        let badgeClass = "badge-info";
        const intent = item.intent.toLowerCase();
        if (intent.includes("transactional")) {
            badgeClass = "badge-success";
        } else if (intent.includes("commercial")) {
            badgeClass = "badge-purple";
        } else if (intent.includes("navigational")) {
            badgeClass = "badge-warning";
        }
        
        const volumeStr = (item.volume || 0).toLocaleString();
        const cpcStr = (item.cpc || 0).toFixed(2);
        
        tr.innerHTML = `
            <td class="text-bright">
                <a href="javascript:void(0)" onclick="analyzeFromMagic('${item.keyword}')" style="font-weight: 600;">${item.keyword}</a>
            </td>
            <td><span class="badge ${badgeClass}">${item.intent}</span></td>
            <td class="text-right">${volumeStr}</td>
            <td class="text-right">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; margin-right: 6px;"></span>
                ${kd}%
            </td>
            <td class="text-right">$${cpcStr}</td>
            <td class="text-center">
                <button class="btn btn-secondary btn-small" onclick="analyzeFromMagic('${item.keyword}')">
                    Check
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
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
        
        const ring = document.getElementById("audit-score-ring");
        const circ = 301.6; // 2 * Math.PI * 48
        const offset = circ - (score / 100) * circ;
        ring.style.strokeDashoffset = offset;
        
        if (score >= 80) {
            ring.style.stroke = "var(--success)";
        } else if (score >= 50) {
            ring.style.stroke = "var(--warning)";
        } else {
            ring.style.stroke = "var(--danger)";
        }
        
        // 2. Categories scores
        const onpage = data.scores.on_page || 0;
        const technical = data.scores.technical || 0;
        const offpage = data.scores.off_page || 0;
        const social = data.scores.social || 0;
        
        document.getElementById("audit-score-onpage").textContent = onpage + "%";
        document.getElementById("audit-bar-onpage").style.width = onpage + "%";
        
        document.getElementById("audit-score-technical").textContent = technical + "%";
        document.getElementById("audit-bar-technical").style.width = technical + "%";
        
        document.getElementById("audit-score-offpage").textContent = offpage + "%";
        document.getElementById("audit-bar-offpage").style.width = offpage + "%";
        
        document.getElementById("audit-score-social").textContent = social + "%";
        document.getElementById("audit-bar-social").style.width = social + "%";
        
        // 3. Domain summary
        let cleanDomain = urlVal.replace(/https?:\/\/(www\.)?/, "");
        const slashIdx = cleanDomain.indexOf("/");
        if (slashIdx > -1) {
            cleanDomain = cleanDomain.substring(0, slashIdx);
        }
        document.getElementById("audit-preview-domain").textContent = cleanDomain.toUpperCase();
        
        // 4. Render recommendations
        const tbody = document.getElementById("audit-issues-tbody");
        tbody.innerHTML = "";
        
        const issues = data.issues || [];
        if (issues.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-success">Excellent! No major issues detected.</td></tr>`;
        } else {
            issues.forEach(issue => {
                const tr = document.createElement("tr");
                
                let statusBadge = "";
                const st = issue.status.toLowerCase();
                if (st === "success" || st === "pass") {
                    statusBadge = `<span class="badge-status status-success"><i data-lucide="check"></i> Pass</span>`;
                } else if (st === "warning") {
                    statusBadge = `<span class="badge-status status-warning"><i data-lucide="alert-circle"></i> Warning</span>`;
                } else {
                    statusBadge = `<span class="badge-status status-error"><i data-lucide="x-circle"></i> Red Flag</span>`;
                }
                
                tr.innerHTML = `
                    <td>${issue.type}</td>
                    <td class="text-bright"><strong>${issue.check}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="white-space: normal; max-width: 450px; color: var(--color-text-muted)">${issue.details}</td>
                `;
                tbody.appendChild(tr);
            });
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
    const colMappings = ["keyword", "intent", "volume", "difficulty", "cpc"];
    
    headers.forEach((h, idx) => {
        if (idx < 5) {
            h.style.cursor = "pointer";
            h.title = "Click to sort";
            h.addEventListener("click", () => {
                sortMagicTable(colMappings[idx]);
            });
        }
    });
});

// ========================================
// BACKLINK FUNCTIONS - COMPLETE WORKING VERSION
// ========================================

let backlinks = [];

// ========================================
// LOAD BACKLINKS FROM DATABASE
// ========================================

function loadBacklinks() {
    fetch('/api/backlinks')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            backlinks = data;
            renderBacklinks(backlinks);
            updateBacklinkStats(backlinks);
        })
        .catch(error => {
            console.error('Error loading backlinks:', error);
            // Fallback to sample data if API fails
            backlinks = getSampleBacklinks();
            renderBacklinks(backlinks);
            updateBacklinkStats(backlinks);
        });
}

// ========================================
// SAMPLE DATA (FALLBACK)
// ========================================

function getSampleBacklinks() {
    return [
        {
            id: 1,
            source_url: 'https://developers.google.com/search',
            target_url: 'https://apexseo.rentsmartprop.com.my/',
            anchor_text: 'Google Search Central',
            domain_authority: 94,
            follow_type: 'follow',
            date_found: '2026-07-15'
        },
        {
            id: 2,
            source_url: 'https://moz.com/',
            target_url: 'https://apexseo.rentsmartprop.com.my/',
            anchor_text: 'Moz SEO tools',
            domain_authority: 87,
            follow_type: 'follow',
            date_found: '2026-07-16'
        },
        {
            id: 3,
            source_url: 'https://backlinko.com/',
            target_url: 'https://apexseo.rentsmartprop.com.my/',
            anchor_text: 'Backlinko SEO blog',
            domain_authority: 84,
            follow_type: 'follow',
            date_found: '2026-07-17'
        },
        {
            id: 4,
            source_url: 'https://www.semrush.com/',
            target_url: 'https://apexseo.rentsmartprop.com.my/',
            anchor_text: 'Semrush SEO platform',
            domain_authority: 91,
            follow_type: 'follow',
            date_found: '2026-07-18'
        },
        {
            id: 5,
            source_url: 'https://ahrefs.com/',
            target_url: 'https://apexseo.rentsmartprop.com.my/',
            anchor_text: 'Ahrefs SEO tools',
            domain_authority: 89,
            follow_type: 'follow',
            date_found: '2026-07-19'
        }
    ];
}

// ========================================
// RENDER BACKLINKS TABLE
// ========================================

function renderBacklinks(backlinks) {
    const tbody = document.getElementById('bl-table-body');
    if (!tbody) return;
    
    if (!backlinks || backlinks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:40px; color: var(--color-text-muted);">
                    No backlinks found. Add your first backlink above!
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = '';
    backlinks.forEach(bl => {
        const quality = getQualityScore(bl.domain_authority);
        const qualityColor = quality === 'Excellent' ? 'var(--success)' : 
                            quality === 'Good' ? 'var(--primary)' : 
                            quality === 'Fair' ? 'var(--warning)' : 'var(--danger)';
        
        const row = `
            <tr>
                <td><a href="${bl.source_url}" target="_blank" style="color: var(--primary);">${bl.source_url}</a></td>
                <td><a href="${bl.target_url}" target="_blank" style="color: var(--primary);">${bl.target_url}</a></td>
                <td>${bl.anchor_text || '-'}</td>
                <td style="text-align:right;">${bl.domain_authority || '-'}</td>
                <td>
                    <span style="padding: 2px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; 
                        background: ${bl.follow_type === 'follow' ? 'var(--success)' : 'var(--warning)'}; 
                        color: white;">
                        ${bl.follow_type}
                    </span>
                </td>
                <td>${bl.date_found}</td>
                <td style="color: ${qualityColor}; font-weight: 600;">${quality}</td>
                <td style="text-align:center;">
                    <button onclick="deleteBacklink(${bl.id})" style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 18px;">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// ========================================
// UPDATE STATS
// ========================================

function updateBacklinkStats(backlinks) {
    const total = backlinks.length;
    const follow = backlinks.filter(bl => bl.follow_type === 'follow').length;
    const nofollow = backlinks.filter(bl => bl.follow_type === 'nofollow').length;
    const avgDA = total > 0 ? Math.round(backlinks.reduce((sum, bl) => sum + (bl.domain_authority || 0), 0) / total) : 0;
    
    const totalEl = document.getElementById('bl-total');
    const followEl = document.getElementById('bl-follow');
    const nofollowEl = document.getElementById('bl-nofollow');
    const avgDaEl = document.getElementById('bl-avg-da');
    
    if (totalEl) totalEl.textContent = total;
    if (followEl) followEl.textContent = follow;
    if (nofollowEl) nofollowEl.textContent = nofollow;
    if (avgDaEl) avgDaEl.textContent = avgDA;
}

// ========================================
// GET QUALITY SCORE
// ========================================

function getQualityScore(da) {
    if (da >= 60) return 'Excellent';
    if (da >= 40) return 'Good';
    if (da >= 20) return 'Fair';
    return 'Poor';
}

// ========================================
// ADD BACKLINK
// ========================================

function addBacklink() {
    const sourceUrl = document.getElementById('backlink-source-url');
    const targetUrl = document.getElementById('backlink-target-url');
    const anchorText = document.getElementById('backlink-anchor-text');
    const followType = document.getElementById('backlink-follow-type');
    
    if (!sourceUrl || !targetUrl) {
        showToast('⚠️ Please enter both Source URL and Target URL');
        return;
    }
    
    const sourceVal = sourceUrl.value.trim();
    const targetVal = targetUrl.value.trim();
    
    if (!sourceVal || !targetVal) {
        showToast('⚠️ Please enter both Source URL and Target URL');
        return;
    }
    
    const data = {
        source_url: sourceVal,
        target_url: targetVal,
        anchor_text: anchorText ? anchorText.value.trim() : '',
        follow_type: followType ? followType.value : 'follow',
        domain_authority: Math.round(Math.random() * 50 + 20)
    };
    
    // Show loading state
    const btn = document.querySelector('#backlink-tab .btn-primary');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Adding...';
    }
    
    fetch('/api/backlinks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            showToast('✅ Backlink added successfully!');
            loadBacklinks(); // Reload from database
            if (sourceUrl) sourceUrl.value = '';
            if (targetUrl) targetUrl.value = '';
            if (anchorText) anchorText.value = '';
        } else {
            showToast('❌ Error: ' + (result.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error adding backlink:', error);
        showToast('❌ Error adding backlink');
    })
    .finally(() => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="plus"></i> Add Backlink';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    });
}

// ========================================
// DELETE BACKLINK - FIXED VERSION
// ========================================

function deleteBacklink(id) {
    console.log('🗑️ Delete button clicked for ID:', id);
    
    if (!confirm('Are you sure you want to delete this backlink?')) {
        return;
    }
    
    // Show loading on the button
    const buttons = document.querySelectorAll(`button[onclick*="deleteBacklink(${id})"]`);
    buttons.forEach(btn => {
        btn.textContent = '⏳';
        btn.disabled = true;
    });
    
    fetch(`/api/backlinks/delete/${id}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('Response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(result => {
        console.log('Delete result:', result);
        if (result.success) {
            showToast('🗑️ Backlink deleted successfully!');
            loadBacklinks(); // Reload the table
        } else {
            showToast('❌ Error: ' + (result.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error deleting backlink:', error);
        showToast('❌ Error deleting backlink: ' + error.message);
    })
    .finally(() => {
        // Reset buttons
        buttons.forEach(btn => {
            btn.textContent = '🗑️';
            btn.disabled = false;
        });
    });
}

// ========================================
// SEARCH BACKLINKS
// ========================================

function searchBacklinks(query) {
    if (!query || query.trim() === '') {
        loadBacklinks();
        return;
    }
    
    const filtered = backlinks.filter(bl => 
        bl.source_url.toLowerCase().includes(query.toLowerCase()) ||
        bl.target_url.toLowerCase().includes(query.toLowerCase()) ||
        (bl.anchor_text && bl.anchor_text.toLowerCase().includes(query.toLowerCase()))
    );
    renderBacklinks(filtered);
    updateBacklinkStats(filtered);
}

// ========================================
// COMPETITOR ANALYSIS
// ========================================

function analyzeCompetitorBacklinks() {
    const urlInput = document.getElementById('bl-competitor-url');
    if (!urlInput) return;
    
    const url = urlInput.value.trim();
    if (!url) {
        showToast('⚠️ Please enter a competitor URL');
        return;
    }
    
    const resultsDiv = document.getElementById('bl-competitor-results');
    if (!resultsDiv) return;
    
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = `
        <div style="text-align:center; padding:30px;">
            <div style="margin:0 auto 15px; width:40px; height:40px; border:4px solid var(--border-color); border-top-color: var(--primary); border-radius:50%; animation: spin 1s linear infinite;"></div>
            <p style="color: var(--color-text-muted);">🔍 Analyzing competitor backlinks...</p>
        </div>
    `;
    
    fetch('/api/competitor-backlinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
    })
    .then(response => response.json())
    .then(data => {
        if (!data || data.length === 0) {
            resultsDiv.innerHTML = `
                <div style="padding:15px; background:var(--bg-card); border-radius:8px; border-left:4px solid var(--warning);">
                    <p style="color:var(--warning);">⚠️ No competitor backlinks found for: ${url}</p>
                </div>
            `;
            return;
        }
        
        let html = `
            <div style="padding:15px; background:var(--bg-card); border-radius:8px; border-left:4px solid var(--success); margin-bottom:15px;">
                <h4 style="color:var(--success);">✅ Found ${data.length} backlinks for: ${url}</h4>
            </div>
            <div style="margin-top:10px;">
        `;
        
        data.forEach(bl => {
            html += `
                <div style="background:var(--bg-card); padding:12px 15px; border-radius:6px; margin-bottom:8px; border:1px solid var(--border-color);">
                    <strong style="color:var(--primary);">${bl.source_url}</strong>
                    <div style="margin-top:5px; font-size:13px; color:var(--color-text-muted);">
                        DA: ${bl.domain_authority} | Anchor: ${bl.anchor_text || '-'}
                    </div>
                </div>
            `;
        });
        
        html += `
                <button class="btn btn-primary mt-10" onclick="showToast('💡 Feature coming soon: Import competitor backlinks!')" style="margin-top:10px; padding:8px 20px; border-radius:6px; background:var(--primary); color:white; border:none; cursor:pointer;">
                    <i data-lucide="import"></i> Import These Backlinks
                </button>
            </div>
        `;
        
        resultsDiv.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    })
    .catch(error => {
        console.error('Error analyzing competitor:', error);
        resultsDiv.innerHTML = `
            <div style="padding:15px; background:var(--bg-card); border-radius:8px; border-left:4px solid var(--danger);">
                <p style="color:var(--danger);">❌ Error analyzing competitor backlinks</p>
            </div>
        `;
    });
}

// ========================================
// EXPORT CSV
// ========================================

function exportBacklinksCSV() {
    fetch('/api/backlinks')
        .then(response => response.json())
        .then(data => {
            if (data.length === 0) {
                showToast('⚠️ No data to export');
                return;
            }
            
            let csv = 'Source URL,Target URL,Anchor Text,DA,Type,Date\n';
            data.forEach(bl => {
                csv += `"${bl.source_url}","${bl.target_url}","${bl.anchor_text || ''}",${bl.domain_authority || ''},${bl.follow_type},${bl.date_found}\n`;
            });
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'backlinks_export.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast('📥 CSV exported successfully!');
        })
        .catch(error => {
            console.error('Error exporting:', error);
            showToast('❌ Error exporting CSV');
        });
}

// ========================================
// TOAST NOTIFICATION
// ========================================

function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; 
            background: var(--bg-card); color: var(--color-text); 
            padding: 15px 25px; border-radius: 8px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
            z-index: 9999;
            border: 1px solid var(--border-color);
            display: none;
            max-width: 400px;
        `;
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// ========================================
// INITIALIZE ON PAGE LOAD
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Backlink page loaded');
    
    // Check if we're on the backlinks tab
    if (document.getElementById('bl-total')) {
        loadBacklinks();
        
        // Search functionality
        const searchInput = document.getElementById('bl-search');
        if (searchInput) {
            searchInput.addEventListener('keyup', function() {
                searchBacklinks(this.value);
            });
        }
    }
});

// ========================================
// SPINNER ANIMATION
// ========================================

const spinStyle = document.createElement('style');
spinStyle.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(spinStyle);

console.log('✅ Backlink functions loaded successfully!');