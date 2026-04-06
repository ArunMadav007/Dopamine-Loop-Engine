/**
 * Monitor Module — Real-time behavior monitoring
 * Supports Simulation mode and Real Tracking mode
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

    // Simulation state
    let simPhase = 0; // 0=normal, 1=escalating, 2=addictive, 3=cooldown
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
    };
    const SPARK_MAX = 30;

    /**
     * Start monitoring
     */
    function start() {
        if (isRunning) return;
        isRunning = true;
        sessionStartTime = Date.now();
        simTick = 0;
        simPhase = 0;
        totalInterventions = 0;

        // Connect WebSocket
        connectWebSocket();

        // Update UI
        updateLiveUI(true);

        // Start data collection interval
        const interval = parseInt(document.getElementById('setting-interval')?.value || 3000);
        monitorInterval = setInterval(() => {
            const data = mode === 'simulate' ? generateSimulatedData() : collectRealData();
            sendData(data);
        }, interval);

        // Setup real tracking if needed
        if (mode === 'real') {
            setupRealTracking();
            document.getElementById('sim-feed-container')?.classList.remove('hidden');
            generateFeedContent();
        } else {
            document.getElementById('sim-feed-container')?.classList.add('hidden');
        }
    }

    /**
     * Stop monitoring
     */
    function stop() {
        isRunning = false;

        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }

        if (ws) {
            ws.close();
            ws = null;
        }

        teardownRealTracking();
        updateLiveUI(false);
    }

    /**
     * Set monitoring mode
     */
    function setMode(newMode) {
        const wasRunning = isRunning;
        if (wasRunning) stop();

        mode = newMode;

        // Update UI buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        if (wasRunning) start();
    }

    /**
     * Connect to WebSocket
     */
    function connectWebSocket() {
        const host = window.location.host || 'localhost:8000';
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${host}/ws/monitor`;

        try {
            ws = new WebSocket(url);

            ws.onopen = () => {
                console.log('[WS] Connected');
                setConnectionStatus(true);
            };

            ws.onmessage = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    handleResponse(response);
                } catch (e) {
                    console.error('[WS] Parse error:', e);
                }
            };

            ws.onclose = () => {
                console.log('[WS] Disconnected');
                setConnectionStatus(false);
                // Attempt reconnect if still running
                if (isRunning) {
                    setTimeout(connectWebSocket, 3000);
                }
            };

            ws.onerror = (err) => {
                console.error('[WS] Error:', err);
                setConnectionStatus(false);
            };
        } catch (e) {
            console.error('[WS] Connection failed:', e);
            setConnectionStatus(false);
        }
    }

    /**
     * Send behavioral data via WebSocket
     */
    function sendData(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * Handle response from backend
     */
    function handleResponse(response) {
        if (response.type !== 'analysis') return;

        const { prediction, risk, features, intervention, session_stats } = response;

        lastRiskScore = risk.score;

        // Update dashboard
        Dashboard.updateRiskGauge(risk.score, risk.zone);
        Dashboard.updateAIState(prediction);
        Dashboard.addRiskReading(risk.score);
        Dashboard.updateComponents(risk.components);

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

        // Check if intervention should be displayed
        const threshold = parseInt(document.getElementById('setting-threshold')?.value || 50);
        if (intervention && intervention.action !== 'none' && risk.score >= threshold && !interventionCooldown) {
            totalInterventions++;
            addLogEntry(intervention, risk.score, risk.zone);

            // Show intervention with delay so user sees the risk build up
            setTimeout(() => {
                Interventions.trigger(
                    intervention,
                    risk,
                    {
                        sessionTime,
                        totalInterventions,
                    },
                    (actionType, helpful) => handleFeedback(actionType, helpful, risk.score)
                );
            }, 500);

            // Cooldown to prevent spam
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

    /**
     * Handle user feedback on intervention
     */
    async function handleFeedback(actionType, helpful, riskBefore) {
        try {
            const resp = await fetch('/api/feedback', {
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
                // If user found it helpful, nudge simulation toward recovery
                if (helpful && mode === 'simulate') {
                    simPhase = 3; // cooldown
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

        // Phase transitions
        if (simPhase === 0 && simTick > 5) {
            simPhase = 1; // Start escalating
        }
        if (simPhase === 1 && simTick > 15) {
            simPhase = 2; // Full addictive
        }
        if (simPhase === 3 && simTick % 10 === 0) {
            simPhase = 0; // Reset after cooldown
            simTick = 0;
        }

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

            case 1: // Escalating
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

            case 3: // Cooldown (after intervention accepted)
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
            scrollEvents: [],
            clickCount: 0,
            lastScrollY: 0,
            lastScrollTime: Date.now(),
            pauseStart: Date.now(),
            totalPauseTime: 0,
            isScrolling: false,
        };

        const feed = document.getElementById('sim-feed');
        if (feed) {
            feed.addEventListener('scroll', onRealScroll);
        }
        document.addEventListener('click', onRealClick);
        document.addEventListener('touchstart', onRealClick);
    }

    function teardownRealTracking() {
        const feed = document.getElementById('sim-feed');
        if (feed) {
            feed.removeEventListener('scroll', onRealScroll);
        }
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
        // Keep last 20 events
        if (realTracker.scrollEvents.length > 20) realTracker.scrollEvents.shift();

        realTracker.lastScrollY = scrollY;
        realTracker.lastScrollTime = now;

        // Track pauses
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

    function onRealClick() {
        realTracker.clickCount++;
    }

    function collectRealData() {
        const now = Date.now();
        const sessionDuration = (now - sessionStartTime) / 1000;
        const nowDate = new Date();
        const hour = nowDate.getHours() + nowDate.getMinutes() / 60;

        // Average scroll speed
        const recentScrolls = realTracker.scrollEvents.filter(e => now - e.time < 10000);
        const avgScrollSpeed = recentScrolls.length > 0
            ? recentScrolls.reduce((s, e) => s + e.speed, 0) / recentScrolls.length
            : 100;

        // Clicks per minute
        const clicksPerMin = sessionDuration > 0
            ? (realTracker.clickCount / sessionDuration) * 60
            : 0;

        // Pause ratio
        const totalTime = sessionDuration * 1000;
        const pauseRatio = totalTime > 0
            ? Math.min(0.95, realTracker.totalPauseTime / totalTime)
            : 0.5;

        return {
            scroll_speed: Math.max(50, avgScrollSpeed),
            session_duration: sessionDuration,
            clicks_per_min: Math.max(1, clicksPerMin),
            app_switch_rate: 5, // Can't track this in browser, use baseline
            hour_of_day: hour,
            pause_ratio: pauseRatio,
        };
    }

    /**
     * Generate fake feed content for real tracking mode
     */
    function generateFeedContent() {
        const feed = document.getElementById('sim-feed');
        if (!feed) return;

        const topics = [
            { title: '🔥 10 Mind-Blowing AI Facts', text: 'You won\'t believe #7! AI is reshaping how we think about technology and the future of humanity...' },
            { title: '🎮 New Game Release Drops Today', text: 'The most anticipated game of 2026 is finally here. Early reviews are incredible...' },
            { title: '😂 Try Not To Laugh Challenge', text: 'We compiled the funniest fails of the week. Can you make it through without cracking up?' },
            { title: '🍕 The Perfect Pizza Recipe', text: 'After testing 47 different dough recipes, we found the ultimate combination...' },
            { title: '🌍 Breaking: Major Discovery', text: 'Scientists have discovered something unprecedented deep beneath the ocean floor...' },
            { title: '💰 This Stock Just Exploded 400%', text: 'Investors are scrambling after this unexpected surge. Here\'s what happened...' },
            { title: '🎵 This Song is Going Viral', text: 'Everyone is talking about this new track. It already has 50M views in 24 hours...' },
            { title: '🐱 Cat Does the Impossible', text: 'This cat learned to open doors, use the toilet, and apparently order food online...' },
            { title: '📱 Phone Hack That Changes Everything', text: 'This hidden feature has been in your phone all along. 99% of users don\'t know about it...' },
            { title: '⚡ Elon Musk Makes Announcement', text: 'The tech mogul took to social media with a cryptic message that sent markets wild...' },
            { title: '🏋️ 5-Minute Workout That Actually Works', text: 'Fitness experts say this short routine is more effective than an hour at the gym...' },
            { title: '🎬 Movie Trailer Breaks Internet', text: 'The first trailer for the most awaited sequel just dropped and fans are losing it...' },
            { title: '🧠 Your Brain on Social Media', text: 'New research reveals exactly what happens to your neural pathways during scrolling...' },
            { title: '🚀 Space Tourism Opens to Public', text: 'For the first time ever, regular people can book a trip to orbit. Prices start at...' },
            { title: '🎤 Celebrity Drama Escalates', text: 'The feud between two A-listers just took an unexpected turn that nobody saw coming...' },
        ];

        feed.innerHTML = '';
        // Generate 30 items for scrolling
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
        const dot = document.getElementById('live-dot');
        const label = document.getElementById('live-label');

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
                btn.className = 'btn btn-primary btn-glow';
            }
        }

        if (dot) dot.classList.toggle('active', running);
        if (label) {
            label.textContent = running ? 'LIVE' : 'STOPPED';
            label.classList.toggle('active', running);
        }
    }

    function updateLiveScore(score, zone, state) {
        const scoreEl = document.getElementById('live-score');
        const ringEl = document.getElementById('live-ring');
        const zoneEl = document.getElementById('live-zone');
        const stateEl = document.getElementById('live-state');

        if (scoreEl) {
            scoreEl.textContent = Math.round(score);
            if (score < 30) scoreEl.style.color = '#00ff88';
            else if (score < 70) scoreEl.style.color = '#ffaa00';
            else scoreEl.style.color = '#ff0044';
        }

        if (ringEl) {
            const circumference = 327; // 2 * PI * 52
            const offset = circumference * (1 - score / 100);
            ringEl.style.strokeDashoffset = offset;
            if (score < 30) ringEl.style.stroke = '#00ff88';
            else if (score < 70) ringEl.style.stroke = '#ffaa00';
            else ringEl.style.stroke = '#ff0044';
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
        setText('metric-session', `${Math.round(features.session_duration)}s`);
        setText('metric-pause', `${Math.round((features.pause_ratio || 0) * 100)}%`);

        // Update sparklines
        pushSpark('scroll', features.scroll_speed);
        pushSpark('clicks', features.clicks_per_min);
        pushSpark('session', features.session_duration);
        pushSpark('pause', (features.pause_ratio || 0) * 100);

        Charts.sparkline('spark-scroll', sparkData.scroll, '#00f0ff');
        Charts.sparkline('spark-clicks', sparkData.clicks, '#bf00ff');
        Charts.sparkline('spark-session', sparkData.session, '#00ff88');
        Charts.sparkline('spark-pause', sparkData.pause, '#ffaa00');
    }

    function pushSpark(key, value) {
        sparkData[key].push(value);
        if (sparkData[key].length > SPARK_MAX) sparkData[key].shift();
    }

    function addLogEntry(intervention, score, zone) {
        const log = document.getElementById('intervention-log');
        if (!log) return;

        // Remove "empty" message
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

        // Keep max 20 entries
        while (log.children.length > 20) {
            log.removeChild(log.lastChild);
        }
    }

    function setConnectionStatus(connected) {
        const dot = document.getElementById('connection-status');
        if (dot) {
            dot.className = `connection-dot ${connected ? 'connected' : 'disconnected'}`;
            dot.title = connected ? 'Connected' : 'Disconnected';
        }
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    return {
        start,
        stop,
        setMode,
        isRunning: () => isRunning,
    };
})();
