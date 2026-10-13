/**
 * Moss — Digital Wellbeing Focus Companion Mascot
 *
 * Single layered inline SVG character with animated CSS/JS facial parts.
 * Driven by live, smoothed risk scores (0..100 scaled to 0..1) with hysteresis.
 * Reacts with one-shot hop and speech only on genuine intervention events.
 * Respects prefers-reduced-motion.
 */

const Moss = (() => {
    'use strict';

    const ROOT_ID = 'moss-container';
    const VALID_STATES = new Set(['idle', 'low', 'moderate', 'high']);
    const CLASS_PREFIX = 'moss--';
    const HYSTERESIS = 0.04;
    const HOP_CLASS = 'moss--intervening';
    const BLINK_CLASS = 'moss--blinking';

    let root = null;
    let speechEl = null;
    let sayAvatarEl = null;
    let currentState = 'idle';
    let lastFiniteRisk = null;
    let hopTimeoutId = null;
    let blinkTimeoutId = null;
    let disposed = false;
    let initialized = false;

    // Trusted literal mouth path definitions (no dynamic string construction)
    const MOUTH_PATHS = Object.freeze({
        idle: 'M105 148 Q120 151 135 148',
        low: 'M99 143 Q120 159 141 143',
        moderate: 'M101 148 Q120 151 139 148',
        high: 'M102 151 Q120 137 138 151',
    });

    const MESSAGES = {
        idle: [
            "I'm here whenever you need me.",
            "Stay mindful, one moment at a time.",
            "Patience is a virtue !!",
            "You got this!",
        ],
        low: [
            "Great focus! You're in a calm, steady rhythm.",
            "Looking good! Keep this mindful pace.",
            "Smooth sailing — mindful attention maintained.",
        ],
        moderate: [
            "Attention risk is drifting slightly. Stay aware.",
            "Noticed a little loop building — check in with yourself.",
            "Keeping an eye on things… take a steady breath.",
        ],
        high: [
            "Focus loop detected. Consider taking a pause.",
            "Your attention risk is elevated. Let's slow down.",
            "Time for a gentle reset — look away from the screen.",
        ],
    };

    /**
     * Build the layered inline SVG character.
     * All facial features (brows, eyelids, pupils, mouth, sprout) are separate animatable layers.
     */
    function buildSVG() {
        return `
<svg class="moss__svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Moss, your focus companion" focusable="false">
  <defs>
    <linearGradient id="moss-skin-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a8f0c6"/>
      <stop offset="100%" stop-color="#55c995"/>
    </linearGradient>
    <linearGradient id="moss-belly-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4d8"/>
      <stop offset="100%" stop-color="#eadfbe"/>
    </linearGradient>
  </defs>

  <!-- Soft ground shadow -->
  <ellipse class="moss__shadow" cx="120" cy="211" rx="58" ry="9" fill="#000" opacity=".18"/>

  <!-- Sprout layer on head -->
  <g class="moss__sprout" transform="translate(120 35)">
    <path d="M0 10 C-2 -2 -11 -8 -20 -6 C-17 4 -9 11 0 10Z" fill="#7de6a8"/>
    <path d="M0 10 C3 -4 13 -10 21 -5 C18 5 9 12 0 10Z" fill="#4dbb82"/>
    <path d="M0 9 L0 18" stroke="#328b61" stroke-width="3" stroke-linecap="round"/>
  </g>

  <!-- Body silhouette -->
  <path class="moss__body"
    d="M47 106 C43 77 60 58 83 58
       C95 43 107 39 120 39
       C133 39 145 43 157 58
       C180 58 197 77 193 106
       C204 132 199 171 180 190
       C164 207 145 211 120 211
       C95 211 76 207 60 190
       C41 171 36 132 47 106Z"
    fill="url(#moss-skin-gradient)"/>

  <!-- Left eye -->
  <g class="moss__eye moss__eye--left" transform="translate(83 91)">
    <ellipse class="moss__eye-white" cx="0" cy="0" rx="24" ry="28" fill="#fffdf8"/>
    <g class="moss__pupil">
      <ellipse cx="3" cy="4" rx="10" ry="14" fill="#20332e"/>
      <circle cx="6" cy="-2" r="4" fill="#fff"/>
    </g>
    <path class="moss__eyelid"
      d="M -24 0 Q 0 28 24 0 L 24 -28 L -24 -28 Z"
      fill="#55c995" opacity="0"/>
  </g>

  <!-- Right eye -->
  <g class="moss__eye moss__eye--right" transform="translate(157 91)">
    <ellipse class="moss__eye-white" cx="0" cy="0" rx="24" ry="28" fill="#fffdf8"/>
    <g class="moss__pupil">
      <ellipse cx="-3" cy="4" rx="10" ry="14" fill="#20332e"/>
      <circle cx="0" cy="-2" r="4" fill="#fff"/>
    </g>
    <path class="moss__eyelid"
      d="M -24 0 Q 0 28 24 0 L 24 -28 L -24 -28 Z"
      fill="#55c995" opacity="0"/>
  </g>

  <!-- Eyebrows (independent angle/translation) -->
  <path class="moss__brow moss__brow--left"
    d="M61 56 Q82 44 101 57"
    fill="none" stroke="#328b61" stroke-width="6"
    stroke-linecap="round"/>
  <path class="moss__brow moss__brow--right"
    d="M139 57 Q158 44 179 56"
    fill="none" stroke="#328b61" stroke-width="6"
    stroke-linecap="round"/>

  <!-- Cheeks -->
  <ellipse class="moss__cheek moss__cheek--left"
    cx="61" cy="130" rx="12" ry="7" fill="#f4a9ad" opacity=".38"/>
  <ellipse class="moss__cheek moss__cheek--right"
    cx="179" cy="130" rx="12" ry="7" fill="#f4a9ad" opacity=".38"/>

  <!-- Belly -->
  <path class="moss__belly"
    d="M79 145 C82 129 99 124 120 124
       C141 124 158 129 161 145
       C164 171 146 190 120 190
       C94 190 76 171 79 145Z"
    fill="url(#moss-belly-gradient)"/>

  <!-- Mouth -->
  <path class="moss__mouth"
    d="${MOUTH_PATHS.idle}"
    fill="none" stroke="#285a46" stroke-width="5"
    stroke-linecap="round"/>
</svg>`;
    }

    function getRoot() {
        if (!root || !root.isConnected) {
            root = document.getElementById(ROOT_ID);
        }
        return root;
    }

    /**
     * Normalize incoming risk score to 0.00..1.00.
     * Handles both raw 0..100 backend scale and pre-normalized 0..1 values safely.
     */
    function normalizeRisk(rawRisk) {
        if (rawRisk === null || rawRisk === undefined || rawRisk === '' || typeof rawRisk === 'boolean') {
            return null;
        }
        const value = Number(rawRisk);
        if (!Number.isFinite(value)) return null;
        if (value < 0 || value > 100) return null;

        // If backend returns 0..100, scale to 0..1
        const normalized = value > 1.0 ? value / 100.0 : value;
        return Math.min(1.0, Math.max(0.0, normalized));
    }

    /**
     * Compute next expression state with hysteresis margin to prevent flicker.
     */
    function nextStateForRisk(risk, previousState) {
        if (risk === null) return 'idle';

        // Hysteresis boundary checks
        if (previousState === 'low' && risk < 0.33 + HYSTERESIS) return 'low';
        if (previousState === 'moderate' &&
            risk >= 0.33 - HYSTERESIS &&
            risk <= 0.66 + HYSTERESIS) return 'moderate';
        if (previousState === 'high' && risk > 0.66 - HYSTERESIS) return 'high';

        if (risk <= 0.33) return 'low';
        if (risk <= 0.66) return 'moderate';
        return 'high';
    }

    /**
     * Apply expression state to target element.
     */
    function applyStateToElement(el, state) {
        if (!el) return;

        for (const name of VALID_STATES) {
            el.classList.remove(CLASS_PREFIX + name);
        }
        el.classList.add(CLASS_PREFIX + state);
        el.dataset.expression = state;
        el.setAttribute(
            'aria-label',
            state === 'idle'
                ? 'Moss is waiting for monitoring data'
                : `Moss expression: ${state} attention risk`
        );

        const mouth = el.querySelector('.moss__mouth');
        if (mouth && MOUTH_PATHS[state]) {
            mouth.setAttribute('d', MOUTH_PATHS[state]);
        }
    }

    /**
     * Apply expression state to root and companion avatars.
     */
    function applyState(state) {
        if (!VALID_STATES.has(state)) return;
        const element = getRoot();
        if (disposed) return;

        if (element) {
            applyStateToElement(element, state);
        }

        if (sayAvatarEl && sayAvatarEl.isConnected) {
            applyStateToElement(sayAvatarEl, state);
        }

        currentState = state;
    }

    /**
     * Set live risk score (0..100 from backend).
     * Normalizes and maps to low/moderate/high with hysteresis.
     */
    function setRisk(rawRisk) {
        const normalized = normalizeRisk(rawRisk);
        if (normalized === null) {
            lastFiniteRisk = null;
            applyState('idle');
            return;
        }

        lastFiniteRisk = normalized;
        const targetState = nextStateForRisk(normalized, currentState);
        applyState(targetState);
    }

    /**
     * Reset character to resting idle state.
     */
    function setIdle() {
        lastFiniteRisk = null;
        applyState('idle');
    }

    /**
     * One-shot hop animation triggered strictly on genuine new intervention events.
     */
    function hop() {
        const element = getRoot();
        if (!element || disposed) return;

        // Honor prefers-reduced-motion
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        element.classList.remove(HOP_CLASS);
        // Force reflow to restart CSS animation
        void element.offsetWidth;
        element.classList.add(HOP_CLASS);

        if (hopTimeoutId !== null) clearTimeout(hopTimeoutId);
        hopTimeoutId = setTimeout(() => {
            const current = getRoot();
            if (current) current.classList.remove(HOP_CLASS);
            hopTimeoutId = null;
        }, 600);
    }

    /**
     * Brief eye blink.
     */
    function blinkOnce() {
        const element = getRoot();
        if (!element || disposed || document.hidden) return;

        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        element.classList.add(BLINK_CLASS);
        setTimeout(() => {
            const current = getRoot();
            if (current) current.classList.remove(BLINK_CLASS);
        }, 160);
    }

    /**
     * Single lifecycle-managed timer for blinking.
     * Prevents timer proliferation on rapid state updates.
     */
    function scheduleBlink() {
        if (disposed) return;
        if (blinkTimeoutId !== null) {
            clearTimeout(blinkTimeoutId);
            blinkTimeoutId = null;
        }

        const delay = 3500 + Math.floor(Math.random() * 2500);
        blinkTimeoutId = setTimeout(() => {
            blinkTimeoutId = null;
            if (!document.hidden) blinkOnce();
            scheduleBlink();
        }, delay);
    }

    /**
     * Update companion speech text safely without innerHTML.
     */
    function speak(message, state) {
        if (disposed) return;

        const targetSpeech = speechEl ||
            document.getElementById('moss-speech-text') ||
            document.getElementById('moss-says-avatar');

        if (targetSpeech && typeof message === 'string') {
            targetSpeech.textContent = message;
            targetSpeech.hidden = false;
        }

        if (state) {
            const mapped = mapLegacyState(state);
            applyState(mapped);
        }
    }

    /**
     * Map legacy state names for backward compatibility.
     */
    function mapLegacyState(state) {
        if (VALID_STATES.has(state)) return state;
        const legacyMap = {
            resting: 'idle',
            observing: 'moderate',
            encouraging: 'low',
            intervention: 'high',
        };
        return legacyMap[state] || 'idle';
    }

    /**
     * Legacy setState adapter for existing callers.
     */
    function setState(state) {
        const mapped = mapLegacyState(state);
        applyState(mapped);
    }

    function onVisibilityChange() {
        if (document.hidden && blinkTimeoutId !== null) {
            clearTimeout(blinkTimeoutId);
            blinkTimeoutId = null;
        } else if (!document.hidden && blinkTimeoutId === null) {
            scheduleBlink();
        }
    }

    /**
     * Initialize Moss companion.
     * Idempotent: ensures no duplicate listeners or timer proliferation.
     */
    function init(containerId = ROOT_ID, speechId = 'moss-speech-text') {
        if (disposed) disposed = false;

        const container = document.getElementById(containerId);
        if (container) {
            root = container;
            if (!container.querySelector('.moss__svg')) {
                container.innerHTML = buildSVG();
            }
            container.classList.add('moss');
            applyState('idle');
        }

        speechEl = speechId ? document.getElementById(speechId) : null;
        sayAvatarEl = document.getElementById('moss-says-avatar');
        if (sayAvatarEl && !sayAvatarEl.querySelector('.moss__svg')) {
            sayAvatarEl.innerHTML = buildSVG();
            sayAvatarEl.classList.add('moss');
        }

        if (!initialized) {
            scheduleBlink();
            document.addEventListener('visibilitychange', onVisibilityChange);
            initialized = true;
        }
    }

    /**
     * Dispose timers and event listeners cleanly.
     */
    function dispose() {
        disposed = true;
        initialized = false;
        if (hopTimeoutId !== null) clearTimeout(hopTimeoutId);
        if (blinkTimeoutId !== null) clearTimeout(blinkTimeoutId);
        hopTimeoutId = null;
        blinkTimeoutId = null;
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    function getState() {
        return currentState;
    }

    function getLastFiniteRisk() {
        return lastFiniteRisk;
    }

    function getMessage(state) {
        const key = VALID_STATES.has(state) ? state : currentState;
        const list = MESSAGES[key] || MESSAGES.idle;
        return list[Math.floor(Math.random() * list.length)];
    }

    return {
        init,
        setRisk,
        setIdle,
        hop,
        speak,
        dispose,
        getState,
        getLastFiniteRisk,
        setState,
        getMessage,
        buildSVG,
    };
})();

if (typeof window !== 'undefined') {
    window.Moss = Moss;
}
