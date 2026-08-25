/**
 * Vertical Theming Module
 * Applies vertical-specific accent colors throughout the UI.
 * Colors the sidebar mark, buttons, and accent elements based on the business vertical.
 */
(function () {
  'use strict';

  var VERTICAL_THEMES = {
    'laundry':     { accent: '#10b981', accentDark: '#059669', accentLight: '#ecfdf5' },
    'parking':     { accent: '#3b82f6', accentDark: '#2563eb', accentLight: '#eff6ff' },
    'shoe-repair': { accent: '#92400e', accentDark: '#78350f', accentLight: '#fffbeb' },
    'mechanic':    { accent: '#6b7280', accentDark: '#4b5563', accentLight: '#f9fafb' },
    'bakery':      { accent: '#f59e0b', accentDark: '#d97706', accentLight: '#fffbeb' },
    'tailor':      { accent: '#8b5cf6', accentDark: '#7c3aed', accentLight: '#f5f3ff' },
    'pet-daycare': { accent: '#f97316', accentDark: '#ea580c', accentLight: '#fff7ed' },
    'courier':     { accent: '#06b6d4', accentDark: '#0891b2', accentLight: '#ecfeff' },
    'print-center':{ accent: '#64748b', accentDark: '#475569', accentLight: '#f8fafc' },
    'salon':       { accent: '#ec4899', accentDark: '#db2777', accentLight: '#fdf2f8' },
    'gym-locker':  { accent: '#14b8a6', accentDark: '#0d9488', accentLight: '#f0fdfa' },
    'nursery':     { accent: '#22c55e', accentDark: '#16a34a', accentLight: '#f0fdf4' },
    'domicilios':  { accent: '#84cc16', accentDark: '#65a30d', accentLight: '#f7fee7' }
  };

  /**
   * Apply vertical theme to the page.
   * @param {string} verticalSlug - The vertical slug (e.g. "laundry", "parking")
   */
  function applyTheme(verticalSlug) {
    var theme = VERTICAL_THEMES[verticalSlug];
    if (!theme) return;

    var root = document.documentElement;
    root.style.setProperty('--green', theme.accent);
    root.style.setProperty('--green-dark', theme.accentDark);
    root.style.setProperty('--soft-green', theme.accentLight);

    // Update the sidebar mark gradient
    var mark = document.querySelector('.mark');
    if (mark) {
      mark.style.background = 'linear-gradient(135deg, ' + theme.accent + ', ' + theme.accentDark + ')';
      mark.style.boxShadow = '0 4px 12px ' + theme.accent + '4d';
    }

    // Update FAB
    var fab = document.querySelector('.fab');
    if (fab) {
      fab.style.background = 'linear-gradient(135deg, ' + theme.accent + ', ' + theme.accentDark + ')';
      fab.style.boxShadow = '0 8px 24px ' + theme.accent + '66';
    }

    // Update bottom nav active color
    var style = document.getElementById('verticalThemeStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'verticalThemeStyle';
      document.head.appendChild(style);
    }
    style.textContent = [
      '.bottom-nav-btn.active { color: ' + theme.accent + ' !important; }',
      '.data-status { color: ' + theme.accent + ' !important; background: ' + theme.accent + '14 !important; }',
      '.btn.green { background: ' + theme.accent + ' !important; border-color: ' + theme.accent + ' !important; }',
      '.btn.green:hover { background: ' + theme.accentDark + ' !important; }'
    ].join('\n');
  }

  /**
   * Get theme for a vertical.
   * @param {string} verticalSlug
   * @returns {object|null}
   */
  function getTheme(verticalSlug) {
    return VERTICAL_THEMES[verticalSlug] || null;
  }

  // Expose
  window.VerticalTheming = {
    applyTheme: applyTheme,
    getTheme: getTheme,
    THEMES: VERTICAL_THEMES
  };
})();
