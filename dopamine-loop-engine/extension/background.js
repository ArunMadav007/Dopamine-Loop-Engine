// Background service worker for Chrome Extension Bridge

let socket = null;
let isConnected = false;

// Attempt to connect to the local FastAPI WebSocket
function connectWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    try {
        socket = new WebSocket('ws://127.0.0.1:8000/ws/monitor');

        socket.onopen = () => {
            console.log('[DLDE] Connected to AI Backend.');
            isConnected = true;
        };

        socket.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                
                // If it's an analysis response indicating an intervention
                if (response.type === 'analysis' && response.intervention && response.intervention.action !== 'none') {
                    // Send intervention command to the active tab
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0] && tabs[0].url && tabs[0].url.includes("instagram.com")) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type: 'TRIGGER_INTERVENTION',
                                data: response
                            });
                        }
                    });
                }
            } catch (err) {
                console.error('[DLDE] Parse Error:', err);
            }
        };

        socket.onclose = () => {
            console.log('[DLDE] Socket disconnected. Reconnecting in 5s...');
            isConnected = false;
            setTimeout(connectWebSocket, 5000);
        };
        
        socket.onerror = (error) => {
            console.log('[DLDE] Socket Error');
            isConnected = false;
        };

    } catch (e) {
        console.log('[DLDE] WebSocket initialization failed.', e);
    }
}

// Keep connection alive
connectWebSocket();

// Listen for tracking data from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRACKING_DATA') {
        if (isConnected && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message.data));
        }
    }
});
