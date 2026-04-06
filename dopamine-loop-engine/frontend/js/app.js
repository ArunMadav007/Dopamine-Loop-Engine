/**
 * App Controller — Main application entry point
 * Handles routing, navigation, initialization, and global state
 */

(function () {
    'use strict';

    // ── Page Navigation ─────────────────────────────

    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    let currentPage = 'dashboard';

    function navigateTo(pageId) {
        currentPage = pageId;

        pages.forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageId);
        });

        // Refresh data when switching to certain pages
        if (pageId === 'history') {
            loadHistoryData();
        }
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navigateTo(item.dataset.page);
        });
    });

    // Settings button → settings page
    document.getElementById('btn-settings')?.addEventListener('click', () => {
        navigateTo('settings');
    });

    // ── Monitor Controls ────────────────────────────

    document.getElementById('btn-start-monitor')?.addEventListener('click', () => {
        if (Monitor.isRunning()) {
            Monitor.stop();
        } else {
            Monitor.start();
        }
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            Monitor.setMode(btn.dataset.mode);
        });
    });

    // ── Load Historical Data ────────────────────────

    async function loadHistoryData() {
        try {
            // Load session history
            const histResp = await fetch('/api/history');
            if (histResp.ok) {
                const histData = await histResp.json();
                Dashboard.updateSessionHistoryChart(histData.history);

                // Compute intervention counts
                const counts = {};
                (histData.interventions || []).forEach(i => {
                    const type = i.type || 'unknown';
                    counts[type] = (counts[type] || 0) + 1;
                });
                Dashboard.updateEffectivenessChart(counts);
            }

            // Load stats (includes Q-table)
            const statsResp = await fetch('/api/stats');
            if (statsResp.ok) {
                const statsData = await statsResp.json();
                Dashboard.updateRLStats(statsData.rl_agent);
                Dashboard.renderQTable(statsData.q_table);
            }
        } catch (e) {
            console.warn('[APP] Could not load history:', e);
        }
    }

    // ── Initial Stats Load ──────────────────────────

    async function loadInitialStats() {
        try {
            const resp = await fetch('/api/stats');
            if (resp.ok) {
                const data = await resp.json();
                Dashboard.updateRLStats(data.rl_agent);

                // Show initial safe state
                Dashboard.updateRiskGauge(0, 'SAFE');
                Dashboard.updateAIState({
                    state: 'NORMAL',
                    confidence: 0,
                });
            }
        } catch (e) {
            console.warn('[APP] Backend not reachable. Make sure the server is running.');
            Dashboard.updateRiskGauge(0, 'SAFE');
        }
    }

    // ── Periodic Stats Refresh ──────────────────────

    setInterval(async () => {
        if (currentPage === 'dashboard') {
            try {
                const resp = await fetch('/api/stats');
                if (resp.ok) {
                    const data = await resp.json();
                    Dashboard.updateRLStats(data.rl_agent);
                }
            } catch (e) {
                // Silent fail
            }
        }
    }, 10000);

    // ── Service Worker Registration ─────────────────

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').catch(err => {
            console.warn('[SW] Registration failed:', err);
        });
    }

    // ── Initialize ──────────────────────────────────

    loadInitialStats();

    console.log(
        '%c🧠 DOPAMINE LOOP DISRUPTION ENGINE%c v1.0',
        'color: #00f0ff; font-size: 16px; font-weight: bold; font-family: monospace;',
        'color: #bf00ff; font-size: 12px; font-family: monospace;'
    );
    console.log(
        '%cAI-powered anti-addiction system active.',
        'color: #00ff88; font-family: monospace;'
    );
})();
