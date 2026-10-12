/**
 * Moss — Friendly frog companion character
 *
 * Five visual states:
 *   idle         – relaxed, gentle breathing animation
 *   observing    – attentive, watching fresh telemetry
 *   encouraging  – celebrates a focus goal
 *   intervention – calm suggestion to take a break
 *   resting      – quiet when monitoring is paused
 *
 * Implementation: Pure inline SVG controlled by CSS classes.
 * Respects prefers-reduced-motion.
 */

const Moss = (() => {
    'use strict';

    const MESSAGES = {
        idle: [
            "You got this!",
            "Patience is a virtue !!",
            "Stay mindful, one moment at a time.",
            "I'm here whenever you need me.",
        ],
        observing: [
            "That's okayy....",
            "Hmm, Interestinggg....",
            "Tracking your focus… looking good so far.",
        ],
        encouraging: [
            "Great progress! Your focus is on point!",
            "You're doing great! Keep it up!",
            "Wonderful focus session — be proud!",
            "Nice work staying mindful today!",
        ],
        intervention: [
            "A short break can help you stay focused.",
            "Take a breath — you've earned a pause.",
            "Let's slow down for a moment together.",
            "Ayo bro chill !!",
            "Consider stepping away briefly. I'll be here.",
        ],
        resting: [
            "Resting now. Start monitoring when you're ready.",
            "Taking it easy… connect to begin.",
            "Zzz… wake me up to start tracking.",
        ],
    };

    let currentState = 'idle';
    let containerEl = null;
    let speechEl = null;

    /**
     * Build the Moss SVG markup.
     * Elements are toggled via CSS classes on the container.
     */
    function buildSVG() {
        return `
<svg class="moss-svg" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Moss the frog companion">
  <!-- Body -->
  <ellipse class="moss-body" cx="60" cy="72" rx="46" ry="34" fill="#5ec6b0"/>
  <!-- Eye bumps -->
  <circle cx="38" cy="44" r="20" fill="#5ec6b0"/>
  <circle cx="82" cy="44" r="20" fill="#5ec6b0"/>
  <!-- Eye whites -->
  <circle class="moss-eye-white" cx="38" cy="42" r="15" fill="#fff"/>
  <circle class="moss-eye-white" cx="82" cy="42" r="15" fill="#fff"/>
  <!-- Pupils (shift for observing state via CSS) -->
  <circle class="moss-pupil moss-pupil-l" cx="40" cy="42" r="8" fill="#2d2b3d"/>
  <circle class="moss-pupil moss-pupil-r" cx="84" cy="42" r="8" fill="#2d2b3d"/>
  <!-- Eye shine -->
  <circle cx="44" cy="38" r="3.5" fill="#fff" opacity="0.85"/>
  <circle cx="88" cy="38" r="3.5" fill="#fff" opacity="0.85"/>
  <!-- Blush -->
  <ellipse class="moss-blush" cx="22" cy="64" rx="9" ry="5" fill="#f9a8d4" opacity="0.45"/>
  <ellipse class="moss-blush" cx="98" cy="64" rx="9" ry="5" fill="#f9a8d4" opacity="0.45"/>
  <!-- Smile (open eyes state) -->
  <path class="moss-mouth-open" d="M48 74 Q60 83, 72 74" stroke="#2d2b3d" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <!-- Big smile (encouraging) -->
  <path class="moss-mouth-big" d="M45 72 Q60 86, 75 72" stroke="#2d2b3d" stroke-width="2.5" fill="none" stroke-linecap="round" style="display:none"/>
  <!-- Closed eyes (resting) -->
  <path class="moss-eye-closed" d="M26 42 Q38 50, 50 42" stroke="#2d2b3d" stroke-width="2.5" fill="none" stroke-linecap="round" style="display:none"/>
  <path class="moss-eye-closed" d="M70 42 Q82 50, 94 42" stroke="#2d2b3d" stroke-width="2.5" fill="none" stroke-linecap="round" style="display:none"/>
  <!-- Zzz for resting -->
  <g class="moss-zzz" style="display:none">
    <text x="92" y="22" font-size="13" font-weight="700" fill="#9ca3af" font-family="sans-serif">z</text>
    <text x="100" y="14" font-size="10" font-weight="700" fill="#c4b5fd" font-family="sans-serif">z</text>
    <text x="106" y="8" font-size="8" font-weight="700" fill="#ddd6fe" font-family="sans-serif">z</text>
  </g>
  <!-- Sparkle for encouraging -->
  <g class="moss-sparkle" style="display:none">
    <text x="8" y="18" font-size="12">✨</text>
    <text x="100" y="15" font-size="10">⭐</text>
  </g>
  <!-- Small leaf decoration -->
  <g class="moss-leaf">
    <ellipse cx="14" cy="95" rx="10" ry="4" fill="#86efac" transform="rotate(-25 14 95)" opacity="0.6"/>
    <ellipse cx="106" cy="98" rx="8" ry="3" fill="#86efac" transform="rotate(20 106 98)" opacity="0.5"/>
  </g>
</svg>`;
    }

    /** Initialise Moss in a container element. */
    function init(containerId, speechId) {
        containerEl = document.getElementById(containerId);
        speechEl = speechId ? document.getElementById(speechId) : null;

        if (containerEl) {
            containerEl.innerHTML = buildSVG();
            containerEl.classList.add('moss-companion');
            setState('idle');
        }

        // Also populate the Moss-says avatar if it exists
        const sayAvatar = document.getElementById('moss-says-avatar');
        if (sayAvatar) {
            sayAvatar.innerHTML = buildSVG();
            sayAvatar.classList.add('moss-companion');
        }
    }

    /** Set Moss to one of the five states. */
    function setState(state) {
        if (!containerEl) return;
        const valid = ['idle', 'observing', 'encouraging', 'intervention', 'resting'];
        if (!valid.includes(state)) state = 'idle';

        currentState = state;

        // Update CSS class
        valid.forEach(s => containerEl.classList.remove(`moss-${s}`));
        containerEl.classList.add(`moss-${state}`);

        // Toggle SVG sub-elements
        const svg = containerEl.querySelector('.moss-svg');
        if (svg) toggleSVGState(svg, state);

        // Update speech
        if (speechEl) {
            const msgs = MESSAGES[state] || MESSAGES.idle;
            speechEl.textContent = msgs[Math.floor(Math.random() * msgs.length)];
        }
    }

    function toggleSVGState(svg, state) {
        // Show/hide elements based on state
        const eyesClosed = svg.querySelectorAll('.moss-eye-closed');
        const pupils = svg.querySelectorAll('.moss-pupil');
        const eyeWhites = svg.querySelectorAll('.moss-eye-white');
        const zzz = svg.querySelector('.moss-zzz');
        const sparkle = svg.querySelector('.moss-sparkle');
        const mouthOpen = svg.querySelector('.moss-mouth-open');
        const mouthBig = svg.querySelector('.moss-mouth-big');

        // Reset all
        eyesClosed.forEach(e => e.style.display = 'none');
        pupils.forEach(e => e.style.display = '');
        eyeWhites.forEach(e => e.style.display = '');
        if (zzz) zzz.style.display = 'none';
        if (sparkle) sparkle.style.display = 'none';
        if (mouthOpen) mouthOpen.style.display = '';
        if (mouthBig) mouthBig.style.display = 'none';

        switch (state) {
            case 'resting':
                eyesClosed.forEach(e => e.style.display = '');
                pupils.forEach(e => e.style.display = 'none');
                eyeWhites.forEach(e => e.style.display = 'none');
                if (zzz) zzz.style.display = '';
                break;
            case 'encouraging':
                if (sparkle) sparkle.style.display = '';
                if (mouthOpen) mouthOpen.style.display = 'none';
                if (mouthBig) mouthBig.style.display = '';
                break;
            case 'observing':
                // Pupils shift handled by CSS animation
                break;
            case 'intervention':
                // Calm expression — slightly smaller mouth
                break;
        }
    }

    function getState() { return currentState; }
    function getMessage(state) {
        const msgs = MESSAGES[state || currentState] || MESSAGES.idle;
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    return { init, setState, getState, getMessage, buildSVG };
})();
