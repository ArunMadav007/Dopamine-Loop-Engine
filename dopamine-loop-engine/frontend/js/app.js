/**
 * App Module — Central controller
 *
 * Handles:
 *  - Page navigation (sidebar + bottom nav)
 *  - Periodic REST polling (/api/stats, /api/history)
 *  - Goal mode syncing
 *  - History table tabs
 *  - Moss initialisation
 *  - Service Worker registration
 */

(function () {
    'use strict';

    // ── NAVIGATION ──────────────────────────────

    /** Navigate to a page and update nav state. */
    function navigateTo(pageName) {
        // Pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageName}`);
        });
        // Sidebar nav
        document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });
        // Bottom nav
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });
    }

    // Wire sidebar nav buttons
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // Wire bottom nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // ── HISTORY TABS ────────────────────────────

    document.querySelectorAll('.history-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            const readingsCard = document.getElementById('history-readings-card');
            const interventionsCard = document.getElementById('history-interventions-card');

            if (readingsCard) readingsCard.classList.toggle('hidden', tabName !== 'readings');
            if (interventionsCard) interventionsCard.classList.toggle('hidden', tabName !== 'interventions');
        });
    });

    // ── MONITOR CONTROLS ────────────────────────

    const btnStartMonitor = document.getElementById('btn-start-monitor');
    if (btnStartMonitor) {
        btnStartMonitor.addEventListener('click', () => {
            if (Monitor.isRunning()) {
                Monitor.stop();
            } else {
                Monitor.start();
            }
        });
    }

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            Monitor.setMode(btn.dataset.mode);
        });
    });

    // ── GOAL MODE ───────────────────────────────

    // Settings page dropdown
    const settingGoalMode = document.getElementById('setting-goal-mode');
    if (settingGoalMode) {
        settingGoalMode.addEventListener('change', () => {
            changeGoalMode(settingGoalMode.value);
        });
    }

    // Dashboard dropdown
    const dashboardGoalMode = document.getElementById('dashboard-goal-mode');
    if (dashboardGoalMode) {
        dashboardGoalMode.addEventListener('change', () => {
            changeGoalMode(dashboardGoalMode.value);
        });
    }

    // Goal mode cards
    document.querySelectorAll('.goal-mode-card').forEach(card => {
        card.addEventListener('click', () => {
            changeGoalMode(card.dataset.mode);
        });
    });

    async function changeGoalMode(mode) {
        Dashboard.syncGoalModeUI(mode);

        try {
            const resp = await fetch(Config.apiUrl('/api/budget/mode'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ goal_mode: mode }),
            });
            if (resp.ok) {
                const data = await resp.json();
                Dashboard.updateBudgetSummary(data.budget || data);
            }
        } catch (e) {
            console.error('[GOAL_MODE]', e);
        }
    }

    // ── PERIODIC POLLING ────────────────────────

    let pollTimer = null;

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        poll(); // Immediate first call
        pollTimer = setInterval(poll, 15000); // Then every 15s
    }

    async function poll() {
        try {
            await Promise.all([fetchStats(), fetchHistory()]);
        } catch (e) {
            console.warn('[POLL] Error:', e);
        }
    }

    async function fetchStats() {
        try {
            const resp = await fetch(Config.apiUrl('/api/stats'));
            if (!resp.ok) return;
            const data = await resp.json();

            Dashboard.updateRLStats(data.rl_agent);
            Dashboard.renderQTable(data.q_table);
            Dashboard.updateInsights(data.insights);
            if (data.budget) {
                Dashboard.updateBudgetSummary(data.budget);
            }
        } catch (e) {
            console.warn('[STATS]', e);
        }
    }

    async function fetchHistory() {
        try {
            const resp = await fetch(Config.apiUrl('/api/history'));
            if (!resp.ok) return;
            const data = await resp.json();
            const history = data.history || [];

            if (history.length > 0) {
                Dashboard.updateSessionHistoryChart(history);
                Dashboard.updateHistoryReadings(history);
            }

            // Intervention counts for effectiveness chart
            const interventionCounts = {};
            const interventionList = [];
            history.forEach(h => {
                if (h.intervention_triggered && h.intervention_triggered !== 'none') {
                    const type = h.intervention_triggered;
                    interventionCounts[type] = (interventionCounts[type] || 0) + 1;
                    interventionList.push({
                        timestamp: h.timestamp,
                        type: type,
                        risk_score: h.risk_score,
                    });
                }
            });

            if (Object.keys(interventionCounts).length > 0) {
                Dashboard.updateEffectivenessChart(interventionCounts);
            }

            if (interventionList.length > 0) {
                Dashboard.updateHistoryInterventions(interventionList);
            }
        } catch (e) {
            console.warn('[HISTORY]', e);
        }
    }

    // ── MOSS INITIALISATION ─────────────────────

    function initMoss() {
        if (typeof Moss !== 'undefined') {
            Moss.init('moss-container', 'moss-speech-text');
        }
    }

    // ── SERVICE WORKER ──────────────────────────

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.warn('[SW] Registration failed:', err);
        });
    }

    // ── BOOT ────────────────────────────────────

    document.addEventListener('DOMContentLoaded', () => {
        initMoss();
        startPolling();
        navigateTo('dashboard');
    });
})();
