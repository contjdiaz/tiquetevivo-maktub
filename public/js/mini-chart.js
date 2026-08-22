/**
 * Mini Chart Module
 * Renders inline SVG sparkline charts for the admin dashboard.
 * No external dependencies.
 */
(function () {
  'use strict';

  /**
   * Create an SVG sparkline chart.
   * @param {HTMLElement} container - Target container element
   * @param {number[]} data - Array of numeric values
   * @param {object} [options]
   * @param {number} [options.width=120] - Chart width in px
   * @param {number} [options.height=40] - Chart height in px
   * @param {string} [options.color='#10b981'] - Line/fill color
   * @param {boolean} [options.fill=true] - Whether to show gradient fill
   * @param {number} [options.strokeWidth=2] - Line width
   */
  function sparkline(container, data, options) {
    if (!container || !data || data.length < 2) return;

    options = options || {};
    var width = options.width || 120;
    var height = options.height || 40;
    var color = options.color || '#10b981';
    var fill = options.fill !== false;
    var strokeWidth = options.strokeWidth || 2;
    var padding = 2;

    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var range = max - min || 1;

    // Calculate points
    var points = data.map(function (val, i) {
      var x = padding + (i / (data.length - 1)) * (width - padding * 2);
      var y = height - padding - ((val - min) / range) * (height - padding * 2);
      return { x: x, y: y };
    });

    // Build path
    var pathData = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    // Fill area path (closes to bottom)
    var fillPath = pathData +
      ' L' + points[points.length - 1].x.toFixed(1) + ',' + (height - padding) +
      ' L' + points[0].x.toFixed(1) + ',' + (height - padding) + ' Z';

    var gradientId = 'sparkGrad_' + Math.random().toString(36).slice(2);

    var svg = [
      '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="display:block;">',
      fill ? '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.2"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/></linearGradient></defs>' : '',
      fill ? '<path d="' + fillPath + '" fill="url(#' + gradientId + ')" />' : '',
      '<path d="' + pathData + '" fill="none" stroke="' + color + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round" />',
      '<circle cx="' + points[points.length - 1].x.toFixed(1) + '" cy="' + points[points.length - 1].y.toFixed(1) + '" r="3" fill="' + color + '" />',
      '</svg>'
    ].join('');

    container.innerHTML = svg;
  }

  /**
   * Render a bar chart.
   * @param {HTMLElement} container
   * @param {Array<{label: string, value: number}>} data
   * @param {object} [options]
   * @param {string} [options.color='#6366f1']
   * @param {number} [options.height=60]
   */
  function barChart(container, data, options) {
    if (!container || !data || data.length === 0) return;

    options = options || {};
    var color = options.color || '#6366f1';
    var height = options.height || 60;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;

    var html = '<div style="display:flex; align-items:flex-end; gap:3px; height:' + height + 'px;">';
    data.forEach(function (d) {
      var barHeight = Math.max(4, (d.value / max) * height);
      html += '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;">';
      html += '<div style="width:100%; height:' + barHeight + 'px; background:' + color + '; border-radius:3px 3px 0 0; opacity:0.8; transition:opacity .2s;" title="' + d.label + ': ' + d.value + '"></div>';
      html += '<span style="font-size:9px; color:#94a3b8; font-weight:600;">' + d.label + '</span>';
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  // Expose
  window.MiniChart = {
    sparkline: sparkline,
    barChart: barChart
  };
})();
