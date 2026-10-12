/**
 * Config Module — Centralised URL configuration & session identity
 *
 * Resolution order:
 *   1. window.__ENV__.API_BASE_URL / WS_BASE_URL  (set by hosting template)
 *   2. <meta name="api-base-url" content="…">     (set in HTML)
 *   3. Auto-detection from window.location
 *
 * No NEXT_PUBLIC_* variables — this is a static HTML frontend.
 */

const Config = (() => {
    'use strict';

    function resolve(envKey, metaName, fallbackFn) {
        if (window.__ENV__ && window.__ENV__[envKey]) return window.__ENV__[envKey];
        const meta = document.querySelector(`meta[name="${metaName}"]`);
        if (meta && meta.content) return meta.content;
        return fallbackFn();
    }

    function autoApi() {
        const loc = window.location;
        if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
            return `${loc.protocol}//${loc.hostname}:8000`;
        }
        return loc.origin;
    }

    function autoWs() {
        const loc = window.location;
        const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
            return `${proto}//${loc.hostname}:8000`;
        }
        return `${proto}//${loc.host}`;
    }

    const API_BASE = resolve('API_BASE_URL', 'api-base-url', autoApi).replace(/\/+$/, '');
    const WS_BASE  = resolve('WS_BASE_URL',  'ws-base-url',  autoWs).replace(/\/+$/, '');

    /** Stable per-tab session ID stored in sessionStorage. */
    function getSessionId() {
        let sid = sessionStorage.getItem('dlde_session_id');
        if (!sid) {
            sid = 'dash_' + Date.now().toString(36) + '_' +
                  Math.random().toString(36).substring(2, 8);
            sessionStorage.setItem('dlde_session_id', sid);
        }
        return sid;
    }

    /** Build a full REST URL with optional session_id query param. */
    function apiUrl(path, includeSession = true) {
        const url = new URL(path, API_BASE + '/');
        // new URL may resolve relative — ensure we keep API_BASE
        const full = API_BASE + path;
        if (includeSession) {
            const sep = full.includes('?') ? '&' : '?';
            return full + sep + 'session_id=' + encodeURIComponent(getSessionId());
        }
        return full;
    }

    /** Build a WebSocket URL with session_id. */
    function wsUrl(path) {
        return `${WS_BASE}${path}?session_id=${encodeURIComponent(getSessionId())}`;
    }

    return { API_BASE, WS_BASE, getSessionId, apiUrl, wsUrl };
})();
