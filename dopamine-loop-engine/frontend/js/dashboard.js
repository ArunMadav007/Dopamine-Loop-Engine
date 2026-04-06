/**
 * Dashboard Module — Risk gauge, stats, component bars, RL info
 */

const Dashboard = (() => {
    const riskHistory = [];
    const MAX_HISTORY = 60;

    /**
     * Update the main risk score gauge
     */
    function updateRiskGauge(score, zone) {
        // Update number
        const scoreEl = document.getElementById('risk-score-value');
        if (scoreEl) {
            animateNumber(scoreEl, parseFloat(scoreEl.textContent) || 0, score, 600);
            // Update gradient color based on score
            if (score < 30) {
                scoreEl.style.background = 'linear-gradient(135deg, #00ff88, #00f0ff)';
            } else if (score < 70) {
                scoreEl.style.background = 'linear-gradient(135deg, #ffaa00, #ff6600)';
            } else {
                scoreEl.style.background = 'linear-gradient(135deg, #ff0044, #ff0088)';
            }
            scoreEl.style.webkitBackgroundClip = 'text';
            scoreEl.style.webkitTextFillColor = 'transparent';
            scoreEl.style.backgroundClip = 'text';
        }

        // Update arc
        const arc = document.getElementById('risk-arc');
        if (arc) {
            const totalLength = 251; // Approximate arc length
            const offset = totalLength - (score / 100) * totalLength;
            arc.style.strokeDashoffset = offset;
        }

        // Update zone badge
        const badge = document.getElementById('risk-zone-badge');
        const zoneText = document.getElementById('risk-zone-text');
        if (badge && zoneText) {
            badge.className = 'risk-zone-badge';
            const zoneClass = zone === 'HIGH_RISK' ? 'high-risk' : zone.toLowerCase();
            badge.classList.add(zoneClass);
            zoneText.textContent = zone.replace('_', ' ');
        }
    }

    /**
     * Update AI state display
     */
    function updateAIState(prediction) {
        const stateEl = document.getElementById('ai-state-text');
        const confEl = document.getElementById('ai-confidence');

        if (stateEl) {
            stateEl.textContent = prediction.state;
            stateEl.style.color = prediction.state === 'ADDICTIVE' ? '#ff0044' : '#00ff88';
        }
        if (confEl) {
            confEl.textContent = (prediction.confidence * 100).toFixed(1) + '%';
        }
    }

    /**
     * Update stat cards and Hero time wasted tracker
     */
    function updateStats(sessionTime, interventions, readings, responsiveness) {
        const mins = Math.floor(sessionTime / 60);
        const secs = Math.floor(sessionTime % 60);
        setText('stat-session-time', `${mins}m ${secs}s`);
        setText('stat-interventions', interventions);
        setText('stat-readings', readings);
        setText('stat-responsiveness', capitalizeFirst(responsiveness));

        // Update Hero Time Lost Badge
        const heroTimeWrapper = document.getElementById('hero-time-wasted');
        const heroTimeNum = document.getElementById('hero-time-number');
        if (heroTimeWrapper && heroTimeNum) {
            let demoMins = Math.max(0, Math.round(sessionTime / 60)) * 10;
            if (demoMins > 0) {
                heroTimeWrapper.style.display = 'block';
                heroTimeNum.textContent = `${demoMins} MIN`;
            } else {
                heroTimeWrapper.style.display = 'none';
            }
        }
    }

    /**
     * Update risk component bars
     */
    function updateComponents(components) {
        if (!components) return;

        setBar('comp-scroll', 'comp-scroll-val', components.scroll_speed);
        setBar('comp-session', 'comp-session-val', components.session_duration);
        setBar('comp-clicks', 'comp-clicks-val', components.click_rate);
        setBar('comp-time', 'comp-time-val', components.time_factor);
        setBar('comp-pause', 'comp-pause-val', components.pause_inverse);
    }

    /**
     * Update RL agent stats
     */
    function updateRLStats(rlData) {
        if (!rlData) return;
        setText('rl-epsilon', rlData.epsilon || '0.15');
        setText('rl-updates', rlData.total_updates || 0);
        setText('rl-reward', rlData.avg_recent_reward || 0);

        const lastHistory = rlData.recent_history;
        if (lastHistory && lastHistory.length > 0) {
            const last = lastHistory[lastHistory.length - 1];
            setText('rl-last-action', last.action || '—');
        }
    }

    /**
     * Add a risk score reading and update the history chart
     */
    function addRiskReading(score) {
        riskHistory.push(score);
        if (riskHistory.length > MAX_HISTORY) riskHistory.shift();

        Charts.lineChart('chart-risk-history', riskHistory, {
            color: '#00f0ff',
            zones: [
                { min: 0, max: 30, color: 'rgba(0,255,136,0.04)' },
                { min: 30, max: 70, color: 'rgba(255,170,0,0.04)' },
                { min: 70, max: 100, color: 'rgba(255,0,68,0.04)' },
            ],
        });
    }

    /**
     * Render Q-table heatmap
     */
    function renderQTable(qTable) {
        const container = document.getElementById('q-table-display');
        if (!container || !qTable) return;

        const actions = ['grayscale', 'delay', 'awareness_popup', 'blur_screen', 'forced_break'];
        const shortActions = ['Gray', 'Delay', 'Popup', 'Blur', 'Break'];

        let html = '<table class="q-table"><thead><tr><th>State</th>';
        shortActions.forEach(a => { html += `<th>${a}</th>`; });
        html += '</tr></thead><tbody>';

        Object.entries(qTable).forEach(([state, data]) => {
            const best = data.best_action;
            html += `<tr><td style="text-align:left; color: var(--text-primary);">${state}</td>`;
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

    /**
     * Update session history chart (History page)
     */
    function updateSessionHistoryChart(history) {
        if (!history || history.length < 2) return;
        const scores = history.map(h => h.risk_score);
        Charts.lineChart('chart-session-history', scores, {
            color: '#bf00ff',
            showDots: scores.length < 25,
            zones: [
                { min: 0, max: 30, color: 'rgba(0,255,136,0.04)' },
                { min: 30, max: 70, color: 'rgba(255,170,0,0.04)' },
                { min: 70, max: 100, color: 'rgba(255,0,68,0.04)' },
            ],
        });
    }

    /**
     * Update effectiveness chart (History page)
     */
    function updateEffectivenessChart(interventionCounts) {
        if (!interventionCounts) return;
        const labels = Object.keys(interventionCounts);
        const values = Object.values(interventionCounts);
        if (labels.length === 0) return;
        Charts.barChart('chart-effectiveness', labels, values);
    }

    // ── Utilities ──────────────────────────────────────

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
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
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
        addRiskReading,
        renderQTable,
        updateSessionHistoryChart,
        updateEffectivenessChart,
    };
})();
