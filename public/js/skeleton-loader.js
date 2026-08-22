/**
 * Skeleton Loader Module
 * Shows animated placeholder content while data loads.
 */
(function () {
  'use strict';

  var SKELETON_CSS_INJECTED = false;

  function injectCSS() {
    if (SKELETON_CSS_INJECTED) return;
    SKELETON_CSS_INJECTED = true;

    var style = document.createElement('style');
    style.textContent = [
      '.skeleton { position: relative; overflow: hidden; background: #e2e8f0; border-radius: 6px; }',
      '.skeleton::after {',
      '  content: ""; position: absolute; inset: 0;',
      '  background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent);',
      '  animation: skeletonShimmer 1.5s infinite;',
      '}',
      '@keyframes skeletonShimmer {',
      '  0% { transform: translateX(-100%); }',
      '  100% { transform: translateX(100%); }',
      '}',
      '.dark-mode .skeleton { background: #334155; }',
      '.dark-mode .skeleton::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent); }',
      '.skeleton-row { display: flex; gap: 12px; align-items: center; padding: 14px 16px; }',
      '.skeleton-circle { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }',
      '.skeleton-lines { flex: 1; display: grid; gap: 8px; }',
      '.skeleton-line { height: 12px; border-radius: 4px; }',
      '.skeleton-line.short { width: 60%; }',
      '.skeleton-line.medium { width: 80%; }',
      '.skeleton-stat { display: grid; gap: 8px; padding: 20px; }',
      '.skeleton-stat-label { height: 10px; width: 50%; }',
      '.skeleton-stat-value { height: 28px; width: 40%; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  /**
   * Render skeleton rows inside a table body.
   * @param {HTMLElement} tbody - The target tbody element
   * @param {number} [rows=5] - Number of skeleton rows
   * @param {number} [cols=6] - Number of columns
   */
  function showTableSkeleton(tbody, rows, cols) {
    injectCSS();
    rows = rows || 5;
    cols = cols || 6;
    var html = '';
    for (var i = 0; i < rows; i++) {
      html += '<tr>';
      for (var j = 0; j < cols; j++) {
        var width = j === 0 ? '50%' : j === cols - 1 ? '70%' : '80%';
        html += '<td><div class="skeleton skeleton-line" style="width:' + width + ';"></div></td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  /**
   * Render skeleton cards for mobile view.
   * @param {HTMLElement} container - The target container
   * @param {number} [count=4] - Number of card skeletons
   */
  function showCardsSkeleton(container, count) {
    injectCSS();
    count = count || 4;
    var html = '';
    for (var i = 0; i < count; i++) {
      html += [
        '<div style="background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px;">',
        '  <div class="skeleton-row" style="padding:0;">',
        '    <div class="skeleton skeleton-circle"></div>',
        '    <div class="skeleton-lines">',
        '      <div class="skeleton skeleton-line medium"></div>',
        '      <div class="skeleton skeleton-line short"></div>',
        '    </div>',
        '  </div>',
        '  <div style="margin-top:12px;">',
        '    <div class="skeleton skeleton-line" style="width:90%; height:14px; margin-bottom:8px;"></div>',
        '    <div class="skeleton skeleton-line" style="width:40%; height:20px;"></div>',
        '  </div>',
        '</div>'
      ].join('');
    }
    container.innerHTML = html;
  }

  /**
   * Show skeleton placeholders in the stats section.
   * @param {string[]} ids - Array of stat element IDs
   */
  function showStatsSkeleton(ids) {
    injectCSS();
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<div class="skeleton skeleton-stat-value" style="display:inline-block;"></div>';
      }
    });
  }

  // Expose
  window.SkeletonLoader = {
    showTableSkeleton: showTableSkeleton,
    showCardsSkeleton: showCardsSkeleton,
    showStatsSkeleton: showStatsSkeleton
  };
})();
