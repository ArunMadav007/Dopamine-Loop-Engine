/**
 * Monitor Module — Real-time behavior monitoring
 * Supports Simulation mode and Real Tracking mode
 * Uses Config module for URLs and session identity.
 */

const Monitor = (() => {
    let ws = null;
    let isRunning = false;
    let monitorInterval = null;
    let mode = 'simulate'; // 'simulate' or 'real'
    let sessionStartTime = null;
    let totalInterventions = 0;
    let lastRiskScore = 0;
    let interventionCooldown = false;

    // Reconnection state
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    const MAX_RECONNECT_DELAY = 30000;

    // Monitor-page risk history (separate from dashboard)
    const monitorRiskHistory = [];
    const MONITOR_MAX = 60;

    // Simulation state
    let simPhase = 0;
    let simTick = 0;

    // Real tracking state
    let realTracker = {
        scrollEvents: [],
        clickCount: 0,
        lastScrollY: 0,
        lastScrollTime: 0,
        pauseStart: 0,
        totalPauseTime: 0,
        isScrolling: false,
    };

    // Sparkline data buffers
    const sparkData = {
        scroll: [],
        clicks: [],
        session: [],
        pause: [],
        switchRate: [],
    };
    const SPARK_MAX = 30;

    // ═══════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════

    function start() {
        if (isRunning) return;
        isRunning = true;
        sessionStartTime = Date.now();
        simTick = 0;
        simPhase = 0;
        totalInterventions = 0;
        reconnectAttempts = 0;

        connectWebSocket();
        updateLiveUI(true);

        const interval = parseInt(document.getElementById('setting-interval')?.value || 3000);
        monitorInterval = setInterval(() => {
            const data = mode === 'simulate' ? generateSimulatedData() : collectRealData();
            sendData(data);
        }, interval);

        if (mode === 'real') {
            setupRealTracking();
            document.getElementById('sim-feed-container')?.classList.remove('hidden');
            generateFeedContent();
        } else {
            document.getElementById('sim-feed-container')?.classList.add('hidden');
        }
    }

    function stop() {
        isRunning = false;

        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (ws) {
            ws.close();
            ws = null;
        }

        teardownRealTracking();
        updateLiveUI(false);
    }

    function setMode(newMode) {
        const wasRunning = isRunning;
        if (wasRunning) stop();
        mode = newMode;

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        if (wasRunning) start();
    }

    // ═══════════════════════════════════════════
    // WEBSOCKET
    // ═══════════════════════════════════════════

    function connectWebSocket() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return; // Already connected or connecting
        }

        const url = Config.wsUrl('/ws/monitor');

        try {
            ws = new WebSocket(url);

            ws.onopen = () => {
                console.log('[WS] Connected to', url);
                reconnectAttempts = 0;
                setConnectionStatus('connected');
            };

            ws.onmessage = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    if (response.type === 'error') {
                        console.warn('[WS] Server error:', response.message);
                        return;
                    }
                    handleResponse(response);
                } catch (e) {
                    console.error('[WS] Parse error:', e);
                }
            };

            ws.onclose = (event) => {
                console.log('[WS] Disconnected, code:', event.code);
                setConnectionStatus('disconnected');
                ws = null;
                // Reconnect with exponential backoff
                if (isRunning) {
                    scheduleReconnect();
                }
            };

            ws.onerror = () => {
                // onerror always fires before onclose; let onclose handle reconnect
                setConnectionStatus('disconnected');
            };
        } catch (e) {
            console.error('[WS] Connection failed:', e);
            setConnectionStatus('disconnected');
            if (isRunning) scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return; // Already scheduled
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setConnectionStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (isRunning) connectWebSocket();
        }, delay);
    }

    function sendData(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    // ═══════════════════════════════════════════
    // RESPONSE HANDLER
    // ═══════════════════════════════════════════

    function handleResponse(response) {
        if (response.type !== 'analysis') return;

        const { prediction, risk, features, intervention, session_stats, budget } = response;
        lastRiskScore = risk.score;

        // Update dashboard
        Dashboard.updateRiskGauge(risk.score, risk.zone);
        Dashboard.updateAIState(prediction);
        Dashboard.addRiskReading(risk.score);
        Dashboard.updateComponents(risk.components);
        Dashboard.updateLiveBehavior(features, true);

        if (intervention) {
            Dashboard.updateLastIntervention(intervention);
        }

        if (budget) {
            Dashboard.updateBudgetSummary(budget);
        }

        // Update Moss state based on risk
        if (typeof Moss !== 'undefined') {
            if (risk.score < 30) {
                Moss.setState(intervention && intervention.action !== 'none' ? 'encouraging' : 'idle');
            } else if (risk.score < 70) {
                Moss.setState('observing');
            } else {
                Moss.setState('intervention');
            }
        }

        const sessionTime = (Date.now() - (sessionStartTime || Date.now())) / 1000;
        Dashboard.updateStats(
            sessionTime,
            totalInterventions,
            session_stats?.total_readings || 0,
            session_stats?.responsiveness || 'neutral'
        );

        // Update monitor live display
        updateLiveScore(risk.score, risk.zone, prediction.state);
        updateMetrics(features);
        updateMonitorRiskChart(risk.score);

        // Update session time on monitor page
        setText('live-session-time', formatDuration(sessionTime));

        // Intervention logic
        const threshold = parseInt(document.getElementById('setting-threshold')?.value || 50);
        if (intervention && intervention.action !== 'none' && risk.score >= threshold && !interventionCooldown) {
            totalInterventions++;
            addLogEntry(intervention, risk.score, risk.zone);

            setTimeout(() => {
                Interventions.trigger(
                    intervention,
                    risk,
                    { sessionTime, totalInterventions },
                    (actionType, helpful) => handleFeedback(actionType, helpful, risk.score)
                );
            }, 500);

            interventionCooldown = true;
            setTimeout(() => { interventionCooldown = false; }, 15000);
        }

        // Update live intervention label
        if (intervention && intervention.action !== 'none') {
            setText('live-intervention', `${intervention.icon} ${intervention.name}`);
        } else {
            setText('live-intervention', 'None');
        }
    }

    async function handleFeedback(actionType, helpful, riskBefore) {
        try {
            const resp = await fetch(Config.apiUrl('/api/feedback'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    intervention_type: actionType,
                    helpful: helpful,
                    risk_score_before: riskBefore,
                    risk_score_after: lastRiskScore,
                }),
            });

            if (resp.ok) {
                const data = await resp.json();
                console.log('[FEEDBACK]', data);
                if (helpful && mode === 'simulate') {
                    simPhase = 3;
                }
            }
        } catch (e) {
            console.error('[FEEDBACK] Error:', e);
        }
    }

    // ═══════════════════════════════════════════
    // SIMULATION MODE
    // ═══════════════════════════════════════════

    function generateSimulatedData() {
        simTick++;
        const intensity = document.getElementById('setting-sim-intensity')?.value || 'normal';
        const escalationRate = intensity === 'fast' ? 0.08 : intensity === 'slow' ? 0.02 : 0.04;

        if (simPhase === 0 && simTick > 5) simPhase = 1;
        if (simPhase === 1 && simTick > 15) simPhase = 2;
        if (simPhase === 3 && simTick % 10 === 0) { simPhase = 0; simTick = 0; }

        const now = new Date();
        const hour = now.getHours() + now.getMinutes() / 60;
        const noise = () => (Math.random() - 0.5) * 0.2;
        let data;

        switch (simPhase) {
            case 0: // Normal
                data = {
                    scroll_speed: 300 + Math.random() * 200 + noise() * 100,
                    session_duration: (Date.now() - sessionStartTime) / 1000,
                    clicks_per_min: 8 + Math.random() * 8,
                    app_switch_rate: 5 + Math.random() * 5,
                    hour_of_day: hour,
                    pause_ratio: 0.5 + Math.random() * 0.3,
                };
                break;
            case 1: { // Escalating
                const escalation = Math.min(1, (simTick - 5) * escalationRate);
                data = {
                    scroll_speed: 400 + escalation * 1000 + Math.random() * 200,
                    session_duration: (Date.now() - sessionStartTime) / 1000,
                    clicks_per_min: 12 + escalation * 30 + Math.random() * 5,
                    app_switch_rate: 4 + Math.random() * 3,
                    hour_of_day: hour,
                    pause_ratio: 0.5 - escalation * 0.35 + noise() * 0.1,
                };
                break;
            }
            case 2: // Addictive
                data = {
                    scroll_speed: 1200 + Math.random() * 600 + Math.sin(simTick * 0.5) * 200,
                    session_duration: (Date.now() - sessionStartTime) / 1000,
                    clicks_per_min: 35 + Math.random() * 20,
                    app_switch_rate: 2 + Math.random() * 3,
                    hour_of_day: hour,
                    pause_ratio: 0.05 + Math.random() * 0.12,
                };
                break;
            case 3: // Cooldown
                data = {
                    scroll_speed: 200 + Math.random() * 150,
                    session_duration: (Date.now() - sessionStartTime) / 1000,
                    clicks_per_min: 5 + Math.random() * 5,
                    app_switch_rate: 8 + Math.random() * 5,
                    hour_of_day: hour,
                    pause_ratio: 0.6 + Math.random() * 0.3,
                };
                break;
        }
        return data;
    }

    // ═══════════════════════════════════════════
    // REAL TRACKING MODE
    // ═══════════════════════════════════════════

    function setupRealTracking() {
        realTracker = {
            scrollEvents: [], clickCount: 0, lastScrollY: 0,
            lastScrollTime: Date.now(), pauseStart: Date.now(),
            totalPauseTime: 0, isScrolling: false,
        };
        const feed = document.getElementById('sim-feed');
        if (feed) feed.addEventListener('scroll', onRealScroll);
        document.addEventListener('click', onRealClick);
        document.addEventListener('touchstart', onRealClick);
    }

    function teardownRealTracking() {
        const feed = document.getElementById('sim-feed');
        if (feed) feed.removeEventListener('scroll', onRealScroll);
        document.removeEventListener('click', onRealClick);
        document.removeEventListener('touchstart', onRealClick);
    }

    function onRealScroll(e) {
        const now = Date.now();
        const feed = e.target;
        const scrollY = feed.scrollTop;
        const delta = Math.abs(scrollY - realTracker.lastScrollY);
        const dt = (now - realTracker.lastScrollTime) / 1000 || 0.1;
        const speed = delta / dt;

        realTracker.scrollEvents.push({ speed, time: now });
        if (realTracker.scrollEvents.length > 20) realTracker.scrollEvents.shift();

        realTracker.lastScrollY = scrollY;
        realTracker.lastScrollTime = now;

        if (!realTracker.isScrolling) {
            const pauseDuration = now - realTracker.pauseStart;
            realTracker.totalPauseTime += pauseDuration;
        }
        realTracker.isScrolling = true;

        clearTimeout(realTracker.scrollTimeout);
        realTracker.scrollTimeout = setTimeout(() => {
            realTracker.isScrolling = false;
            realTracker.pauseStart = Date.now();
        }, 1000);
    }

    function onRealClick() { realTracker.clickCount++; }

    function collectRealData() {
        const now = Date.now();
        const sessionDuration = (now - sessionStartTime) / 1000;
        const nowDate = new Date();
        const hour = nowDate.getHours() + nowDate.getMinutes() / 60;

        const recentScrolls = realTracker.scrollEvents.filter(e => now - e.time < 10000);
        const avgScrollSpeed = recentScrolls.length > 0
            ? recentScrolls.reduce((s, e) => s + e.speed, 0) / recentScrolls.length
            : 100;

        const clicksPerMin = sessionDuration > 0
            ? (realTracker.clickCount / sessionDuration) * 60 : 0;

        const totalTime = sessionDuration * 1000;
        const pauseRatio = totalTime > 0
            ? Math.min(0.95, realTracker.totalPauseTime / totalTime) : 0.5;

        return {
            scroll_speed: Math.max(50, avgScrollSpeed),
            session_duration: sessionDuration,
            clicks_per_min: Math.max(1, clicksPerMin),
            app_switch_rate: 5, // Cannot track in browser
            hour_of_day: hour,
            pause_ratio: pauseRatio,
        };
    }

    function generateFeedContent() {
        const feed = document.getElementById('sim-feed');
        if (!feed) return;

        const topics = [
            { title: '🔥 10 Mind-Blowing AI Facts', text: 'You won\'t believe #7! AI is reshaping how we think about technology...' },
            { title: '🎮 New Game Release Drops Today', text: 'The most anticipated game of 2026 is finally here...' },
            { title: '😂 Try Not To Laugh Challenge', text: 'We compiled the funniest fails of the week...' },
            { title: '🍕 The Perfect Pizza Recipe', text: 'After testing 47 different dough recipes...' },
            { title: '🌍 Breaking: Major Discovery', text: 'Scientists have discovered something unprecedented...' },
            { title: '💰 This Stock Just Exploded 400%', text: 'Investors are scrambling after this unexpected surge...' },
            { title: '🎵 This Song is Going Viral', text: 'Everyone is talking about this new track...' },
            { title: '🐱 Cat Does the Impossible', text: 'This cat learned to open doors and apparently order food online...' },
            { title: '📱 Phone Hack That Changes Everything', text: 'This hidden feature has been in your phone all along...' },
            { title: '🧠 Your Brain on Social Media', text: 'New research reveals exactly what happens during scrolling...' },
        ];

        feed.innerHTML = '';
        for (let i = 0; i < 30; i++) {
            const topic = topics[i % topics.length];
            const item = document.createElement('div');
            item.className = 'feed-item';
            item.innerHTML = `
                <h4>${topic.title}</h4>
                <p>${topic.text}</p>
                <div class="feed-meta">
                    <span>❤️ ${Math.floor(Math.random() * 50000)}</span>
                    <span>💬 ${Math.floor(Math.random() * 5000)}</span>
                    <span>🔄 ${Math.floor(Math.random() * 10000)}</span>
                </div>
            `;
            feed.appendChild(item);
        }
    }

    // ═══════════════════════════════════════════
    // UI UPDATES
    // ═══════════════════════════════════════════

    function updateLiveUI(running) {
        const btn = document.getElementById('btn-start-monitor');

        if (btn) {
            if (running) {
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    Stop Monitoring
                `;
                btn.className = 'btn btn-danger';
            } else {
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Start Monitoring
                `;
                btn.className = 'btn btn-primary';
            }
        }

        // Set Moss to resting when stopped
        if (typeof Moss !== 'undefined') {
            Moss.setState(running ? 'idle' : 'resting');
        }
    }

    function updateLiveScore(score, zone, state) {
        const scoreEl = document.getElementById('live-score');
        const ringEl = document.getElementById('live-ring');
        const zoneEl = document.getElementById('live-zone');
        const stateEl = document.getElementById('live-state');

        if (scoreEl) {
            scoreEl.textContent = Math.round(score);
            scoreEl.style.color = score < 30 ? '#10b981' : score < 70 ? '#f59e0b' : '#ef4444';
        }

        if (ringEl) {
            const circumference = 327;
            const offset = circumference * (1 - score / 100);
            ringEl.style.strokeDashoffset = offset;
            ringEl.style.stroke = score < 30 ? '#10b981' : score < 70 ? '#f59e0b' : '#ef4444';
        }

        // Zone badge on monitor page
        const zoneBadge = document.getElementById('live-zone-badge');
        if (zoneBadge) {
            zoneBadge.className = 'zone-badge';
            const zoneClass = zone === 'HIGH_RISK' ? 'high-risk' : zone.toLowerCase();
            zoneBadge.classList.add(zoneClass);
        }

        if (zoneEl) zoneEl.textContent = zone?.replace('_', ' ') || 'SAFE';
        if (stateEl) {
            stateEl.textContent = state;
            stateEl.className = `meta-value state-${state?.toLowerCase() || 'normal'}`;
        }
    }

    function updateMetrics(features) {
        if (!features) return;

        setText('metric-scroll', `${Math.round(features.scroll_speed)} `);
        setText('metric-clicks', Math.round(features.clicks_per_min));
        setText('metric-session', formatDuration(features.session_duration || 0));
        setText('metric-switch', (features.app_switch_rate ?? 5.0).toFixed(1));
        setText('metric-pause', `${Math.round((features.pause_ratio || 0) * 100)}%`);

        pushSpark('scroll', features.scroll_speed);
        pushSpark('clicks', features.clicks_per_min);
        pushSpark('session', features.session_duration);
        pushSpark('switchRate', features.app_switch_rate || 5);
        pushSpark('pause', (features.pause_ratio || 0) * 100);

        Charts.sparkline('spark-scroll', sparkData.scroll, '#6c5ce7');
        Charts.sparkline('spark-clicks', sparkData.clicks, '#a78bfa');
        Charts.sparkline('spark-session', sparkData.session, '#10b981');
        Charts.sparkline('spark-switch', sparkData.switchRate, '#f59e0b');
        Charts.sparkline('spark-pause', sparkData.pause, '#ef4444');
    }

    function updateMonitorRiskChart(score) {
        monitorRiskHistory.push(score);
        if (monitorRiskHistory.length > MONITOR_MAX) monitorRiskHistory.shift();

        Charts.lineChart('chart-monitor-risk', monitorRiskHistory, {
            color: '#6c5ce7',
            zones: [
                { min: 0, max: 30, color: 'rgba(16,185,129,0.06)' },
                { min: 30, max: 70, color: 'rgba(245,158,11,0.06)' },
                { min: 70, max: 100, color: 'rgba(239,68,68,0.06)' },
            ],
        });
    }

    function pushSpark(key, value) {
        sparkData[key].push(value);
        if (sparkData[key].length > SPARK_MAX) sparkData[key].shift();
    }

    function addLogEntry(intervention, score, zone) {
        const log = document.getElementById('intervention-log');
        if (!log) return;

        const empty = log.querySelector('.log-empty');
        if (empty) empty.remove();

        const time = new Date().toLocaleTimeString();
        const zoneClass = zone === 'HIGH_RISK' ? 'high-risk' : zone?.toLowerCase() || 'safe';

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-icon">${intervention.icon}</span>
            <div class="log-info">
                <span class="log-name">${intervention.name}</span>
                <span class="log-time">${time}</span>
            </div>
            <span class="log-score ${zoneClass}">${Math.round(score)}</span>
        `;

        log.insertBefore(entry, log.firstChild);
        while (log.children.length > 20) log.removeChild(log.lastChild);
    }

    function setConnectionStatus(status) {
        const dot = document.getElementById('connection-status');
        const text = document.getElementById('connection-text');

        if (dot) {
            dot.className = 'connection-dot ' + status;
            dot.title = capitalizeFirst(status);
        }
        if (text) {
            switch (status) {
                case 'connected':
                    text.textContent = `Backend Connected · ${Config.WS_BASE}`;
                    break;
                case 'reconnecting':
                    text.textContent = 'Reconnecting…';
                    break;
                default:
                    text.textContent = 'Disconnected';
            }
        }
    }

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    return {
        start,
        stop,
        setMode,
        isRunning: () => isRunning,
    };
})();
