/**
 * Charts Module — Lightweight Canvas-based charts
 * No external dependencies
 */

const Charts = (() => {
    const COLORS = {
        cyan: '#6c5ce7',
        magenta: '#a78bfa',
        green: '#10b981',
        amber: '#f59e0b',
        red: '#ef4444',
        grid: 'rgba(0, 0, 0, 0.05)',
        text: 'rgba(107, 114, 128, 0.7)',
    };

    function getCtx(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);
        return { ctx, w: rect.width, h: rect.height };
    }

    function drawGrid(ctx, w, h, rows = 4) {
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        for (let i = 0; i <= rows; i++) {
            const y = (h / rows) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }

    /**
     * Draw a line chart with gradient fill
     */
    function lineChart(canvasId, data, options = {}) {
        const result = getCtx(canvasId);
        if (!result || data.length < 2) return;
        const { ctx, w, h } = result;

        const {
            color = COLORS.cyan,
            fillAlpha = 0.15,
            lineWidth = 2,
            showDots = false,
            minY = 0,
            maxY = 100,
            zones = null,
        } = options;

        const padding = { top: 10, right: 10, bottom: 25, left: 35 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        // Draw grid
        drawGrid(ctx, w, h);

        // Y-axis labels
        ctx.fillStyle = COLORS.text;
        ctx.font = '10px "Space Mono", monospace';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const val = minY + ((maxY - minY) / 4) * (4 - i);
            const y = padding.top + (chartH / 4) * i;
            ctx.fillText(Math.round(val), padding.left - 5, y + 3);
        }

        // Draw zone backgrounds if provided
        if (zones) {
            zones.forEach(zone => {
                const y1 = padding.top + chartH * (1 - (zone.max - minY) / (maxY - minY));
                const y2 = padding.top + chartH * (1 - (zone.min - minY) / (maxY - minY));
                ctx.fillStyle = zone.color;
                ctx.fillRect(padding.left, y1, chartW, y2 - y1);
            });
        }

        // Map data to coordinates
        const stepX = chartW / (data.length - 1);
        const points = data.map((val, i) => ({
            x: padding.left + i * stepX,
            y: padding.top + chartH * (1 - (val - minY) / (maxY - minY)),
        }));

        // Gradient fill
        const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
        gradient.addColorStop(0, color + Math.round(fillAlpha * 255).toString(16).padStart(2, '0'));
        gradient.addColorStop(1, color + '00');

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const xc = (points[i - 1].x + points[i].x) / 2;
            const yc = (points[i - 1].y + points[i].y) / 2;
            ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(points[points.length - 1].x, h - padding.bottom);
        ctx.lineTo(points[0].x, h - padding.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const xc = (points[i - 1].x + points[i].x) / 2;
            const yc = (points[i - 1].y + points[i].y) / 2;
            ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].x, points[points.length - 1].y);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        // Glow effect
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Dots
        if (showDots && data.length < 30) {
            points.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });
        }

        // Latest value indicator
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    /**
     * Draw a bar chart
     */
    function barChart(canvasId, labels, values, options = {}) {
        const result = getCtx(canvasId);
        if (!result || values.length === 0) return;
        const { ctx, w, h } = result;

        const {
            colors = [COLORS.cyan, COLORS.magenta, COLORS.green, COLORS.amber, COLORS.red],
            maxY = Math.max(...values) * 1.2 || 100,
        } = options;

        const padding = { top: 10, right: 10, bottom: 40, left: 35 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        drawGrid(ctx, w, h);

        const barW = Math.min(40, (chartW / values.length) * 0.6);
        const gap = (chartW - barW * values.length) / (values.length + 1);

        values.forEach((val, i) => {
            const barH = (val / maxY) * chartH;
            const x = padding.left + gap + i * (barW + gap);
            const y = padding.top + chartH - barH;
            const color = colors[i % colors.length];

            // Bar gradient
            const grad = ctx.createLinearGradient(x, y, x, y + barH);
            grad.addColorStop(0, color);
            grad.addColorStop(1, color + '60');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
            ctx.fill();

            // Label
            ctx.fillStyle = COLORS.text;
            ctx.font = '9px "Nunito Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i] || '', x + barW / 2, h - padding.bottom + 14);

            // Value
            ctx.fillStyle = color;
            ctx.font = '10px "Space Mono", monospace';
            ctx.fillText(Math.round(val), x + barW / 2, y - 5);
        });
    }

    /**
     * Draw a sparkline (tiny line chart)
     */
    function sparkline(canvasId, data, color = COLORS.cyan) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || data.length < 2) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const w = rect.width;
        const h = rect.height;
        const pad = 2;

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        const stepX = (w - pad * 2) / (data.length - 1);
        const points = data.map((val, i) => ({
            x: pad + i * stepX,
            y: pad + (h - pad * 2) * (1 - (val - min) / range),
        }));

        // Fill
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, color + '25');
        gradient.addColorStop(1, color + '00');

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, h);
        ctx.lineTo(points[0].x, h);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Latest dot
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    return { lineChart, barChart, sparkline, COLORS };
})();
