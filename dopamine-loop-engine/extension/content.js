// Content script running inside Instagram.com

(function() {
    let sessionStartTime = Date.now();
    let trackingInterval;

    // Scrolling Metrics Variables
    let scrollEvents = [];
    let clickCount = 0;
    
    // Pause Tracking
    let pauseStart = Date.now();
    let totalPauseTime = 0;
    let isScrolling = false;
    let scrollTimeout = null;

    // Monitor Interactions via Wheel/Touch to bypass complex nested divs
    function trackMovement(speed) {
        const now = Date.now();
        
        if (speed > 5) { 
            scrollEvents.push({ speed: speed * 10, time: now }); // Scale up for AI logic
        }

        if (scrollEvents.length > 30) scrollEvents.shift();

        if (!isScrolling) {
            const pauseDuration = now - pauseStart;
            totalPauseTime += pauseDuration;
        }

        isScrolling = true;
        clearTimeout(scrollTimeout);
        
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
            pauseStart = Date.now();
        }, 500);
    }

    function trackWheel(e) { trackMovement(Math.abs(e.deltaY || e.deltaX || 0)); }
    function trackTouch(e) { trackMovement(25); } // flat speed for swipe
    function trackKey(e) { 
        if (['ArrowDown', 'ArrowUp', 'Space', 'PageDown'].includes(e.code)) trackMovement(50);
    }

    function trackClick() {
        clickCount++;
    }

    // Attach listeners
    window.addEventListener('wheel', trackWheel, { passive: true });
    window.addEventListener('touchmove', trackTouch, { passive: true });
    window.addEventListener('keydown', trackKey, { passive: true });
    window.addEventListener('click', trackClick, { passive: true });
    window.addEventListener('touchstart', trackClick, { passive: true });

    // Collate data and send to Background worker every 3 seconds
    function sendTrackingData() {
        const now = Date.now();
        const sessionDuration = (now - sessionStartTime) / 1000;

        // Calculate Average Scroll Speed
        const recentScrolls = scrollEvents.filter(e => (now - e.time) < 10000);
        let avgScrollSpeed = 0;
        if (recentScrolls.length > 0) {
            avgScrollSpeed = recentScrolls.reduce((s, e) => s + e.speed, 0) / recentScrolls.length;
        }

        // Calculate Rate of Interactions
        const clicksPerMin = sessionDuration > 0 ? (clickCount / sessionDuration) * 60 : 0;

        // Pause Ratio calculation
        let currentTotalPause = totalPauseTime;
        if (!isScrolling) {
            currentTotalPause += (now - pauseStart);
        }
        const pauseRatio = Math.min(0.95, currentTotalPause / (sessionDuration * 1000));

        // Format Payload for AI 
        const payload = {
            scroll_speed: avgScrollSpeed,
            session_duration: sessionDuration,
            clicks_per_min: clicksPerMin,
            app_switch_rate: 5, // We cannot track switching between browser tabs effectively for security
            pause_ratio: isNaN(pauseRatio) ? 0.5 : pauseRatio
        };
        
        // Update Persistent UI Timer
        updateTrackerUI(sessionDuration);

        // Send to service worker background bridge
        try {
            chrome.runtime.sendMessage({
                type: 'TRACKING_DATA',
                data: payload
            });
        } catch (err) {
            // Extension context was invalidated (extension reloaded). Stop the loop.
            if (err.message.includes('Extension context invalidated')) {
                clearInterval(trackingInterval);
            }
        }
    }

    // Ping Data Loop
    trackingInterval = setInterval(sendTrackingData, 3000);


    // ==========================================
    // UI INTERVENTION INJECTION
    // ==========================================

    let interventionCooldown = false;

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'TRIGGER_INTERVENTION') {
            const interventionInfo = message.data.intervention;
            
            // Check cooldowns
            if (!interventionCooldown && interventionInfo.action !== 'none') {
                 applyIntervention(interventionInfo, message.data.risk, message.data.features);
            }
        }
    });

    function applyIntervention(intervention, riskData, features) {
        
        interventionCooldown = true;
        setTimeout(() => { interventionCooldown = false; }, 20000); // Wait 20 seconds before spamming UI again
        
        console.log(`[DLDE AI TRIGGER] ${intervention.action}`);

        switch(intervention.action) {
            case 'grayscale':
                document.body.classList.add('dlde-grayscale-mode');
                createOverlayModal("🎨 GRAYSCALE", "Removing colors to break visual dopamine stimulation.", 15);
                setTimeout(() => document.body.classList.remove('dlde-grayscale-mode'), 15000);
                break;
                
            case 'delay':
                createDelayModal(3); 
                break;
                
            case 'blur_screen':
                document.body.classList.add('dlde-blur-mode');
                createOverlayModal("🔕 FOCUS BREAK", "Take a breath. Look away from the screen for 5 seconds.", 5);
                setTimeout(() => document.body.classList.remove('dlde-blur-mode'), 5000);
                break;
                
            case 'awareness_popup':
                createOverlayModal("💬 AWARENESS CHECK", "You've been doom-scrolling continuously. Risk Score: " + Math.round(riskData.score), 0, true);
                break;

            case 'forced_break':
                createOverlayModal("📴 BREAK TIME", "Critically high addiction risk. 30 second cooling off period.", 30);
                break;

            case 'opportunity_cost':
                const rawSeconds = features ? features.session_duration : 60;
                let mins = Math.max(1, Math.round(rawSeconds / 60));
                
                // Hackathon: since demo stretches time scaling, we will inflate the 'mins' by x10 
                // so the user actually gets interesting messages even if they only tested for 1 minute
                mins = mins * 10; 
                
                let alternative = "read an entire chapter of a book";
                if (mins > 30) alternative = "completed a full home workout";
                if (mins > 60) alternative = "cooked a healthy intricate meal from scratch";
                if (mins > 120) alternative = "learned a brand new programming concept";
                
                createOverlayModal("💡 PERSPECTIVE SHIFT", `You've effectively spent ${mins} minutes in the scrolling loop. In that time, you could have ${alternative}.`, 0, true);
                break;
        }
    }

    let activeOverlay = null;
    let activeInterval = null;

    function createOverlayModal(title, text, seconds, isDismissible = false) {
        if (activeInterval) {
            clearInterval(activeInterval);
            activeInterval = null;
        }

        if (activeOverlay) {
            if (activeOverlay.parentNode === document.body) {
                document.body.removeChild(activeOverlay);
            }
            activeOverlay = null;
        }

        const el = document.createElement('div');
        el.id = 'dlde-intervention-overlay';
        activeOverlay = el;
        
        let timerHTML = seconds > 0 ? `<div class="dlde-timer" id="dlde-timer-val">${seconds}</div>` : '';
        let buttonHTML = isDismissible ? `<button class="dlde-btn dlde-btn-primary" id="dlde-close-btn">Dismiss</button>` : '';

        el.innerHTML = `
            <div class="dlde-modal">
                <div class="dlde-title">${title}</div>
                <div class="dlde-desc">${text}</div>
                ${timerHTML}
                ${buttonHTML}
            </div>
        `;

        document.body.appendChild(el);

        // Force browser repaint to trigger CSS animation transition
        setTimeout(() => { if (el) el.classList.add('dlde-active'); }, 50); 

        if (isDismissible) {
            document.getElementById('dlde-close-btn').onclick = () => {
                el.classList.remove('dlde-active');
                setTimeout(() => { if (el.parentNode === document.body) el.remove(); }, 400); 
            };
        }

        if (seconds > 0) {
            let count = seconds;
            let timerEl = document.getElementById('dlde-timer-val');
            activeInterval = setInterval(() => {
                count--;
                if (timerEl) timerEl.innerText = count;
                if (count <= 0) {
                    clearInterval(activeInterval);
                    activeInterval = null;
                    el.classList.remove('dlde-active');
                    setTimeout(() => { if (el.parentNode === document.body) el.remove(); }, 400); 
                }
            }, 1000);
        }
    }

    function createDelayModal(seconds) {
        if (activeInterval) {
            clearInterval(activeInterval);
            activeInterval = null;
        }

        if (activeOverlay) {
            if (activeOverlay.parentNode === document.body) {
                document.body.removeChild(activeOverlay);
            }
            activeOverlay = null;
        }

        const el = document.createElement('div');
        el.id = 'dlde-intervention-overlay';
        activeOverlay = el;

        el.innerHTML = `
            <div class="dlde-modal">
                <div class="dlde-spinner"></div>
                <div class="dlde-desc">Cognitive cooling delay applied...</div>
            </div>
        `;
        document.body.appendChild(el);
        setTimeout(() => { if (el) el.classList.add('dlde-active'); }, 50);

        setTimeout(() => {
            el.classList.remove('dlde-active');
            setTimeout(() => { if (el.parentNode === document.body) el.remove(); }, 400); 
        }, seconds * 1000);
    }
    
    // ═══════════════════════════════════════════
    // PERSISTENT TIME TRACKER
    // ═══════════════════════════════════════════
    
    let timeTrackerEl = null;

    function initTimeTracker() {
        // Inject tracker CSS
        const style = document.createElement('style');
        style.innerHTML = `
            #dlde-time-tracker {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(10, 10, 15, 0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 0, 68, 0.4);
                border-radius: 12px;
                padding: 12px 16px;
                color: white;
                font-family: 'Inter', system-ui, sans-serif;
                z-index: 2147483647;
                display: none;
                box-shadow: 0 8px 32px rgba(255, 0, 68, 0.2);
                pointer-events: none;
                transition: opacity 0.3s;
            }
            .dlde-tracker-title {
                font-weight: 800;
                font-size: 15px;
                color: #ff0044;
                margin-bottom: 4px;
                letter-spacing: -0.5px;
            }
            .dlde-tracker-msg {
                font-size: 12px;
                opacity: 0.9;
                max-width: 200px;
                line-height: 1.3;
            }
        `;
        document.head.appendChild(style);

        // Create tracker element
        const el = document.createElement('div');
        el.id = 'dlde-time-tracker';
        document.body.appendChild(el);
        timeTrackerEl = el;
    }

    function updateTrackerUI(sessionSeconds) {
        if (!timeTrackerEl) return;
        
        let mins = Math.max(0, Math.round(sessionSeconds / 60));
        mins = mins * 10; // Hackathon scaling
        
        if (mins > 0) {
            timeTrackerEl.innerHTML = `
                <div class="dlde-tracker-title">${mins} MINUTES LOST</div>
                <div class="dlde-tracker-msg">Wake up. Close this tab immediately. You are heavily wasting your life simply by scrolling.</div>
            `;
            timeTrackerEl.style.display = 'block';
        } else {
            timeTrackerEl.style.display = 'none';
        }
    }
    
    // Boot Initialization
    initTimeTracker();
})();
