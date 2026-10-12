/**
 * Dashboard Module — Risk gauge, stats, component bars, RL info,
 *                    budget summary, insights, history charts
 */

const Dashboard = (() => {
    const riskHistory = [];
    const MAX_HISTORY = 60;

    // ── Risk gauge ──────────────────────────────────

    function updateRiskGauge(score, zone) {
        const scoreEl = document.getElementById('risk-score-value');
        if (scoreEl) {
            animateNumber(scoreEl, parseFloat(scoreEl.textContent) || 0, score, 600);
            // Color based on zone
            if (score < 30) scoreEl.style.color = '#10b981';
            else if (score < 70) scoreEl.style.color = '#f59e0b';
            else scoreEl.style.color = '#ef4444';
        }

        // Update arc
        const arc = document.getElementById('risk-arc');
        if (arc) {
            const totalLength = 251;
            const offset = totalLength - (score / 100) * totalLength;
            arc.style.strokeDashoffset = offset;
        }

        // Update zone badge
        const badge = document.getElementById('risk-zone-badge');
        const zoneText = document.getElementById('risk-zone-text');
        if (badge && zoneText) {
            badge.className = 'zone-badge';
            const zoneClass = zone === 'HIGH_RISK' ? 'high-risk' : zone.toLowerCase();
            badge.classList.add(zoneClass);
            zoneText.textContent = zone.replace('_', ' ');
        }
    }

    // ── AI State ────────────────────────────────────

    function updateAIState(prediction) {
        const stateEl = document.getElementById('ai-state-text');
        const confEl = document.getElementById('ai-confidence');

        if (stateEl) {
            stateEl.textContent = prediction.state;
            stateEl.style.color = prediction.state === 'ADDICTIVE' ? '#ef4444' : '#10b981';
        }
        if (confEl) {
            confEl.textContent = prediction.confidence != null
                ? (prediction.confidence * 100).toFixed(1) + '%'
                : '—';
        }
    }

    // ── Session stat cards ──────────────────────────

    function updateStats(sessionTime, interventions, readings, responsiveness) {
        const mins = Math.floor(sessionTime / 60);
        const secs = Math.floor(sessionTime % 60);
        setText('stat-session-time', `${mins}m ${secs}s`);
        setText('stat-interventions', interventions);
        setText('stat-readings', readings);
        setText('stat-responsiveness', capitalizeFirst(responsiveness));
    }

    // ── Risk components bars ────────────────────────

    function updateComponents(components) {
        if (!components) return;
        setBar('comp-scroll', 'comp-scroll-val', components.scroll_speed);
        setBar('comp-session', 'comp-session-val', components.session_duration);
        setBar('comp-clicks', 'comp-clicks-val', components.click_rate);
        setBar('comp-time', 'comp-time-val', components.time_factor);
        setBar('comp-pause', 'comp-pause-val', components.pause_inverse);
    }

    // ── RL Agent stats ──────────────────────────────

    function updateRLStats(rlData) {
        if (!rlData) return;
        setText('rl-epsilon', rlData.epsilon ?? '0.15');
        setText('rl-updates', rlData.total_updates ?? 0);
        setText('rl-reward', rlData.avg_recent_reward ?? 0);

        const lastHistory = rlData.recent_history;
        if (lastHistory && lastHistory.length > 0) {
            const last = lastHistory[lastHistory.length - 1];
            setText('rl-last-action', last.action || '—');
        }
    }

    // ── Budget summary (called from app.js) ─────────

    function updateBudgetSummary(budget) {
        if (!budget) return;

        const spent = budget.spent_minutes ?? 0;
        const remaining = budget.remaining_minutes ?? 0;
        const limit = budget.daily_limit_minutes ?? 60;
        const mode = budget.goal_mode ?? 'balanced';
        const exhausted = budget.is_exhausted ?? false;

        // Ring progress
        const ringEl = document.getElementById('budget-ring-fill');
        if (ringEl) {
            const circumference = 327; // 2 * PI * 52
            const fraction = limit > 0 ? Math.min(1, spent / limit) : 0;
            const offset = circumference * (1 - fraction);
            ringEl.style.strokeDashoffset = offset;
            // Color: purple normally, red if exhausted
            ringEl.style.stroke = exhausted ? '#ef4444' : '#7c3aed';
        }

        setText('budget-spent-display', Math.round(spent));
        setText('budget-remaining-display', Math.round(remaining));

        // Exhausted notice
        const exhaustedEl = document.getElementById('budget-exhausted-notice');
        if (exhaustedEl) {
            exhaustedEl.classList.toggle('hidden', !exhausted);
        }

        // Sync goal mode selects
        syncGoalModeUI(mode);
    }

    // ── Insights (called from app.js) ───────────────

    function updateInsights(insights) {
        if (!insights) return;

        const contentEl = document.getElementById('insight-content');
        const badgeEl = document.getElementById('insight-status-badge');
        const disclaimerEl = document.getElementById('insight-disclaimer');

        if (contentEl) {
            const pattern = insights.dominant_pattern || 'unknown';
            const recommendation = insights.recommendation || '';
            const icon = pattern === 'normal' ? '🟢' : pattern === 'addictive' ? '🔴' : '🔵';

            contentEl.innerHTML = `
                <span class="insight-icon">${icon}</span>
                <strong>${capitalizeFirst(pattern)} pattern</strong><br>
                ${recommendation}
            `;
        }

        // Show heuristic badge if placeholder
        if (badgeEl) {
            if (insights.status === 'placeholder_heuristic') {
                badgeEl.classList.remove('hidden');
                badgeEl.textContent = 'Heuristic';
            } else if (insights.is_evidence_based) {
                badgeEl.classList.remove('hidden');
                badgeEl.textContent = 'Evidence-based';
                badgeEl.style.background = '#d1fae5';
                badgeEl.style.color = '#059669';
            } else {
                badgeEl.classList.add('hidden');
            }
        }

        // Disclaimer
        if (disclaimerEl && insights.disclaimer) {
            disclaimerEl.textContent = insights.disclaimer;
            disclaimerEl.classList.remove('hidden');
        }
    }

    // ── Live behavior card on dashboard ─────────────

    function updateLiveBehavior(features, isLive) {
        if (!features) return;

        setText('bm-scroll', `${Math.round(features.scroll_speed)} px/s`);

        const dur = features.session_duration || 0;
        const mins = Math.floor(dur / 60);
        setText('bm-duration', mins > 0 ? `${mins} min` : `${Math.round(dur)}s`);

        setText('bm-clicks', Math.round(features.clicks_per_min));
        setText('bm-switch', (features.app_switch_rate ?? 5.0).toFixed(1));
        setText('bm-pause-ratio', ((features.pause_ratio ?? 0) * 100).toFixed(0) + '%');

        // Live badge
        const badge = document.getElementById('live-indicator-badge');
        const badgeText = document.getElementById('live-badge-text');
        if (badge) badge.classList.toggle('active', isLive);
        if (badgeText) badgeText.textContent = isLive ? 'Live' : 'Offline';
    }

    // ── Last intervention display ───────────────────

    function updateLastIntervention(intervention) {
        if (!intervention || intervention.action === 'none') return;

        const contentEl = document.getElementById('last-intervention-content');
        const timeEl = document.getElementById('last-intervention-time');

        if (contentEl) {
            contentEl.innerHTML = `
                <span class="interv-icon">${intervention.icon || '🔔'}</span>
                <div class="interv-info">
                    <span class="interv-name">${intervention.name}</span>
                    <span class="interv-desc">${intervention.description || ''}</span>
                </div>
            `;
        }

        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    // ── Risk history for inline chart ────────────────

    function addRiskReading(score) {
        riskHistory.push(score);
        if (riskHistory.length > MAX_HISTORY) riskHistory.shift();

        Charts.lineChart('chart-risk-history', riskHistory, {
            color: '#6c5ce7',
            zones: [
                { min: 0, max: 30, color: 'rgba(16,185,129,0.06)' },
                { min: 30, max: 70, color: 'rgba(245,158,11,0.06)' },
                { min: 70, max: 100, color: 'rgba(239,68,68,0.06)' },
            ],
        });
    }

    // ── Q-table heatmap ─────────────────────────────

    function renderQTable(qTable) {
        const container = document.getElementById('q-table-display');
        if (!container || !qTable) return;

        const actions = ['grayscale', 'delay', 'awareness_popup', 'blur_screen', 'forced_break', 'opportunity_cost'];
        const shortActions = ['Gray', 'Delay', 'Popup', 'Blur', 'Break', 'OpCost'];

        let html = '<table class="q-table"><thead><tr><th>State</th>';
        shortActions.forEach(a => { html += `<th>${a}</th>`; });
        html += '</tr></thead><tbody>';

        Object.entries(qTable).forEach(([state, data]) => {
            const best = data.best_action;
            html += `<tr><td style="text-align:left; font-weight:600;">${state}</td>`;
            actions.forEach(action => {
                const val = data.all_q?.[action] ?? 0;
                const isBest = action === best;
                html += `<td class="${isBest ? 'best' : ''}">${val.toFixed(2)}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ── History page charts ─────────────────────────

    function updateSessionHistoryChart(history) {
        if (!history || history.length < 2) return;
        const scores = history.map(h => h.risk_score);
        Charts.lineChart('chart-session-history', scores, {
            color: '#a78bfa',
            showDots: scores.length < 25,
            zones: [
                { min: 0, max: 30, color: 'rgba(16,185,129,0.06)' },
                { min: 30, max: 70, color: 'rgba(245,158,11,0.06)' },
                { min: 70, max: 100, color: 'rgba(239,68,68,0.06)' },
            ],
        });
    }

    function updateEffectivenessChart(interventionCounts) {
        if (!interventionCounts) return;
        const labels = Object.keys(interventionCounts);
        const values = Object.values(interventionCounts);
        if (labels.length === 0) return;
        Charts.barChart('chart-effectiveness', labels, values);
    }

    // ── History tables ──────────────────────────────

    function updateHistoryReadings(history) {
        const tbody = document.getElementById('history-readings-body');
        if (!tbody || !history || history.length === 0) return;

        tbody.innerHTML = history.map(h => {
            const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const zoneClass = h.zone === 'HIGH_RISK' ? 'high-risk' : h.zone.toLowerCase();
            return `<tr>
                <td>${time}</td>
                <td><strong>${h.risk_score.toFixed(1)}</strong></td>
                <td><span class="zone-badge ${zoneClass}"><span class="zone-dot"></span>${h.zone.replace('_', ' ')}</span></td>
                <td>${h.state}</td>
                <td>${((h.confidence || 0) * 100).toFixed(0)}%</td>
            </tr>`;
        }).join('');
    }

    function updateHistoryInterventions(interventions) {
        const tbody = document.getElementById('history-interventions-body');
        if (!tbody || !interventions || interventions.length === 0) return;

        tbody.innerHTML = interventions.map(iv => {
            const time = new Date(iv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `<tr>
                <td>${time}</td>
                <td><strong>${capitalizeFirst(iv.type)}</strong></td>
                <td>${iv.risk_score.toFixed(1)}</td>
            </tr>`;
        }).join('');
    }

    // ── Goal mode UI sync ───────────────────────────

    function syncGoalModeUI(mode) {
        // Sync all select elements
        ['setting-goal-mode', 'dashboard-goal-mode'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel && sel.value !== mode) sel.value = mode;
        });

        // Sync goal mode cards
        document.querySelectorAll('.goal-mode-card').forEach(card => {
            card.classList.toggle('active', card.dataset.mode === mode);
        });
    }

    // ── Utilities ───────────────────────────────────

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setBar(barId, valId, value) {
        const bar = document.getElementById(barId);
        const val = document.getElementById(valId);
        const clamped = Math.min(100, Math.max(0, value || 0));
        if (bar) bar.style.width = clamped + '%';
        if (val) val.textContent = Math.round(clamped) + '%';
    }

    function animateNumber(el, from, to, duration) {
        const start = performance.now();
        const diff = to - from;

        function frame(time) {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(from + diff * eased);
            if (progress < 1) requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    }

    function capitalizeFirst(str) {
        if (!str) return '—';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    return {
        updateRiskGauge,
        updateAIState,
        updateStats,
        updateComponents,
        updateRLStats,
        updateBudgetSummary,
        updateInsights,
        updateLiveBehavior,
        updateLastIntervention,
        addRiskReading,
        renderQTable,
        updateSessionHistoryChart,
        updateEffectivenessChart,
        updateHistoryReadings,
        updateHistoryInterventions,
        syncGoalModeUI,
    };
})();
