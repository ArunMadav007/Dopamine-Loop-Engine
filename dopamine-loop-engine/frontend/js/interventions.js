/**
 * Interventions Module — Handles all intervention types
 * Grayscale, Delay, Awareness Popup, Screen Blur, Forced Break, Opportunity Cost
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
            case 'opportunity_cost':
                triggerOpportunityCost(riskData, sessionStats);
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
            <h2 class="intervention-title">Grayscale Activated</h2>
            <p class="intervention-desc">
                Screen colors have been softened to reduce visual stimulation and help break the attention loop.
            </p>
            ${renderStats(riskData, sessionStats)}
            ${renderFeedbackButtons()}
        `);

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
            <span class="delay-text">Taking a moment to pause…</span>
        `;
        document.body.appendChild(delayOverlay);

        setTimeout(() => {
            delayOverlay.remove();
            showOverlay(`
                <div class="intervention-icon">⏳</div>
                <h2 class="intervention-title">Pause Applied</h2>
                <p class="intervention-desc">
                    A ${delayMs / 1000}s pause was added to slow the content loop.
                    This micro-break helps your mind reset.
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
            <h2 class="intervention-title">Awareness Check</h2>
            <p class="intervention-desc">
                Hey! You've been browsing for a while. Here's a snapshot of your current session:
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
            <p class="intervention-desc" style="font-size:0.82rem; color:#d97706;">
                Consider a short break to reset your focus.
            </p>
            ${renderFeedbackButtons()}
        `);
    }

    /**
     * 🌫️ Screen Blur — Blur the entire screen
     */
    function triggerBlur(riskData, sessionStats) {
        document.body.classList.add('blur-mode');

        showOverlay(`
            <div class="intervention-icon">🌫️</div>
            <h2 class="intervention-title">Focus Break</h2>
            <p class="intervention-desc">
                Your screen has been softened to break the visual fixation loop.
                Take 3 deep breaths and look away from the screen.
            </p>
            <div class="intervention-timer" id="blur-timer">5</div>
            <p class="intervention-desc" style="font-size:0.78rem;">
                Screen will clear in a few seconds…
            </p>
            ${renderFeedbackButtons()}
        `);

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
        let breakTime = 30;

        showOverlay(`
            <div class="intervention-icon">📴</div>
            <h2 class="intervention-title">Break Time</h2>
            <p class="intervention-desc">
                Your attention risk is elevated. A 30-second break is recommended to help you refocus.
            </p>
            <div class="intervention-timer" id="break-timer">${breakTime}</div>
            <p class="intervention-desc" style="font-size:0.78rem;">
                Stand up · Stretch · Look at something far away 🌿
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
     * 🔍 Opportunity Cost — Show what you could do instead
     */
    function triggerOpportunityCost(riskData, sessionStats) {
        const mins = Math.floor((sessionStats?.sessionTime || 0) / 60);
        const alternatives = [
            { emoji: '📖', text: 'Read a few pages of a book' },
            { emoji: '🚶', text: 'Try taking a walk doomscroll psycho' },
            { emoji: '🎵', text: 'Listen to your favourite song' },
            { emoji: '💧', text: 'Drink a glass of water' },
            { emoji: '🌱', text: 'Try to touch some grass lil bro' },
            { emoji: '✍️', text: 'Journal one thing you\'re grateful for' },
        ];
        // Pick 3 random alternatives
        const picks = alternatives
            .sort(() => Math.random() - 0.5)
            .slice(0, 3);

        showOverlay(`
            <div class="intervention-icon">🔍</div>
            <h2 class="intervention-title">What Could You Do Instead?</h2>
            <p class="intervention-desc">
                You've been browsing for <strong>${mins} min</strong>. Here are a few things you could do with your next few minutes:
            </p>
            <div style="text-align:left; margin:12px auto; max-width:320px;">
                ${picks.map(p => `<div style="padding:8px 0; border-bottom:1px solid #f3f4f6; font-size:0.88rem;">
                    <span style="margin-right:8px;">${p.emoji}</span> ${p.text}
                </div>`).join('')}
            </div>
            <p class="intervention-desc" style="font-size:0.82rem; color:#6c5ce7;">
                A gentle nudge to reflect on how you'd like to spend your time.
            </p>
            ${renderFeedbackButtons()}
        `);
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
                    <span class="is-value">${riskData.zone.replace('_', ' ')}</span>
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
