/**
 * Interventions Module — Handles all intervention types
 * Grayscale, Delay, Awareness Popup, Screen Blur, Forced Break
 */

const Interventions = (() => {
    let currentIntervention = null;
    let interventionTimer = null;
    let onFeedbackCallback = null;

    const overlay = document.getElementById('intervention-overlay');
    const content = document.getElementById('intervention-content');

    /**
     * Trigger an intervention based on type
     */
    function trigger(intervention, riskData, sessionStats, onFeedback) {
        if (!intervention || intervention.action === 'none') return;

        currentIntervention = intervention;
        onFeedbackCallback = onFeedback;

        switch (intervention.action) {
            case 'grayscale':
                triggerGrayscale(riskData, sessionStats);
                break;
            case 'delay':
                triggerDelay(riskData);
                break;
            case 'awareness_popup':
                triggerAwareness(riskData, sessionStats);
                break;
            case 'blur_screen':
                triggerBlur(riskData, sessionStats);
                break;
            case 'forced_break':
                triggerForcedBreak(riskData, sessionStats);
                break;
            default:
                break;
        }

        playSound();
    }

    /**
     * 🎨 Grayscale Mode — Desaturate the screen
     */
    function triggerGrayscale(riskData, sessionStats) {
        document.body.classList.add('grayscale-mode');

        showOverlay(`
            <div class="intervention-icon">🎨</div>
            <h2 class="intervention-title">GRAYSCALE ACTIVATED</h2>
            <p class="intervention-desc">
                Screen colors have been removed to reduce visual stimulation and break the dopamine loop.
            </p>
            ${renderStats(riskData, sessionStats)}
            ${renderFeedbackButtons()}
        `);

        // Auto-remove after 15 seconds
        interventionTimer = setTimeout(() => {
            document.body.classList.remove('grayscale-mode');
            if (overlay && !overlay.classList.contains('hidden')) {
                hideOverlay();
            }
        }, 15000);
    }

    /**
     * ⏳ Artificial Delay — Loading spinner before content
     */
    function triggerDelay(riskData) {
        const delayMs = riskData.score > 80 ? 3000 : 2000;

        const delayOverlay = document.createElement('div');
        delayOverlay.className = 'delay-overlay';
        delayOverlay.id = 'delay-overlay';
        delayOverlay.innerHTML = `
            <div class="delay-spinner"></div>
            <span class="delay-text">COGNITIVE COOLING...</span>
        `;
        document.body.appendChild(delayOverlay);

        setTimeout(() => {
            delayOverlay.remove();
            showOverlay(`
                <div class="intervention-icon">⏳</div>
                <h2 class="intervention-title">DELAY APPLIED</h2>
                <p class="intervention-desc">
                    A ${delayMs / 1000}s delay was added to slow the content loop. 
                    This micro-pause helps your brain reset.
                </p>
                ${renderFeedbackButtons()}
            `);
        }, delayMs);
    }

    /**
     * 💬 Awareness Popup — Show usage statistics
     */
    function triggerAwareness(riskData, sessionStats) {
        const mins = Math.floor((sessionStats?.sessionTime || 0) / 60);
        const secs = Math.floor((sessionStats?.sessionTime || 0) % 60);

        showOverlay(`
            <div class="intervention-icon">💬</div>
            <h2 class="intervention-title">AWARENESS CHECK</h2>
            <p class="intervention-desc">
                Hey! You've been scrolling for a while. Here's what your brain activity looks like right now:
            </p>
            <div class="intervention-stats">
                <div class="intervention-stat">
                    <span class="is-value">${mins}m ${secs}s</span>
                    <span class="is-label">Session Time</span>
                </div>
                <div class="intervention-stat">
                    <span class="is-value">${Math.round(riskData.score)}</span>
                    <span class="is-label">Risk Score</span>
                </div>
                <div class="intervention-stat">
                    <span class="is-value">${sessionStats?.totalInterventions || 0}</span>
                    <span class="is-label">Interventions</span>
                </div>
            </div>
            <p class="intervention-desc" style="font-size: 0.9rem; color: var(--amber);">
                ⚠ Consider taking a short break to reset your dopamine levels.
            </p>
            ${renderFeedbackButtons()}
        `);
    }

    /**
     * 🔕 Screen Blur — Blur the entire screen
     */
    function triggerBlur(riskData, sessionStats) {
        document.body.classList.add('blur-mode');

        showOverlay(`
            <div class="intervention-icon">🔕</div>
            <h2 class="intervention-title">FOCUS BREAK</h2>
            <p class="intervention-desc">
                Your screen has been blurred to break the visual fixation loop. 
                Take 3 deep breaths and look away from the screen.
            </p>
            <div class="intervention-timer" id="blur-timer">5</div>
            <p class="intervention-desc" style="font-size: 0.75rem;">
                Screen will clear in a few seconds...
            </p>
            ${renderFeedbackButtons()}
        `);

        // Countdown timer
        let count = 5;
        const timerEl = document.getElementById('blur-timer');
        interventionTimer = setInterval(() => {
            count--;
            if (timerEl) timerEl.textContent = count;
            if (count <= 0) {
                clearInterval(interventionTimer);
                document.body.classList.remove('blur-mode');
            }
        }, 1000);
    }

    /**
     * 📴 Forced Break — Suggest a break with countdown
     */
    function triggerForcedBreak(riskData, sessionStats) {
        let breakTime = 30; // 30 second break

        showOverlay(`
            <div class="intervention-icon">📴</div>
            <h2 class="intervention-title">BREAK TIME</h2>
            <p class="intervention-desc">
                Your addiction risk is critically high. A 30-second break is strongly recommended.
            </p>
            <div class="intervention-timer" id="break-timer">${breakTime}</div>
            <p class="intervention-desc" style="font-size: 0.75rem;">
                Stand up • Stretch • Look at something far away 🌿
            </p>
            ${renderStats(riskData, sessionStats)}
            ${renderFeedbackButtons('Skip Break')}
        `);

        const timerEl = document.getElementById('break-timer');
        interventionTimer = setInterval(() => {
            breakTime--;
            if (timerEl) timerEl.textContent = breakTime;
            if (breakTime <= 0) {
                clearInterval(interventionTimer);
                hideOverlay();
            }
        }, 1000);
    }

    /**
     * Render usage stats section
     */
    function renderStats(riskData, sessionStats) {
        if (!riskData || !sessionStats) return '';
        const mins = Math.floor((sessionStats.sessionTime || 0) / 60);
        return `
            <div class="intervention-stats">
                <div class="intervention-stat">
                    <span class="is-value">${Math.round(riskData.score)}</span>
                    <span class="is-label">Risk Score</span>
                </div>
                <div class="intervention-stat">
                    <span class="is-value">${riskData.zone}</span>
                    <span class="is-label">Zone</span>
                </div>
                <div class="intervention-stat">
                    <span class="is-value">${mins}m+</span>
                    <span class="is-label">Session</span>
                </div>
            </div>
        `;
    }

    /**
     * Render feedback buttons
     */
    function renderFeedbackButtons(noText = 'Dismiss') {
        return `
            <div class="intervention-actions">
                <button class="btn btn-feedback-yes" onclick="Interventions.submitFeedback(true)">
                    ✓ Helpful
                </button>
                <button class="btn btn-feedback-no" onclick="Interventions.submitFeedback(false)">
                    ✗ ${noText}
                </button>
            </div>
        `;
    }

    function showOverlay(html) {
        if (!overlay || !content) return;
        content.innerHTML = html;
        overlay.classList.remove('hidden');
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.classList.add('hidden');
        document.body.classList.remove('grayscale-mode', 'blur-mode');
        if (interventionTimer) {
            clearInterval(interventionTimer);
            clearTimeout(interventionTimer);
            interventionTimer = null;
        }
    }

    /**
     * Submit user feedback on intervention
     */
    function submitFeedback(helpful) {
        hideOverlay();
        if (onFeedbackCallback && currentIntervention) {
            onFeedbackCallback(currentIntervention.action, helpful);
        }
        currentIntervention = null;
    }

    /**
     * Play a subtle notification sound (using Web Audio API)
     */
    function playSound() {
        const soundEnabled = document.getElementById('setting-sound');
        if (soundEnabled && !soundEnabled.checked) return;

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.3);

            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.5);
        } catch (e) {
            // Audio not available, fail silently
        }
    }

    return {
        trigger,
        submitFeedback,
        hideOverlay,
    };
})();
