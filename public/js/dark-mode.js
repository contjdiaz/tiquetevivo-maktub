/**
 * Dark Mode Toggle Module
 * Switches CSS variables between light and dark themes.
 * Persists preference in localStorage.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tv_dark_mode';

  var lightVars = {
    '--ink': '#0f172a',
    '--muted': '#64748b',
    '--line': '#e2e8f0',
    '--bg': '#f8fafc',
    '--panel': '#ffffff',
    '--shadow-sm': '0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.06)',
    '--shadow-md': '0 4px 16px rgba(0,0,0,.06)'
  };

  var darkVars = {
    '--ink': '#f1f5f9',
    '--muted': '#94a3b8',
    '--line': '#334155',
    '--bg': '#0f172a',
    '--panel': '#1e293b',
    '--shadow-sm': '0 1px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.2)',
    '--shadow-md': '0 4px 16px rgba(0,0,0,.3)'
  };

  var isDark = false;

  function applyTheme(dark) {
    isDark = dark;
    var vars = dark ? darkVars : lightVars;
    var root = document.documentElement;

    Object.keys(vars).forEach(function (key) {
      root.style.setProperty(key, vars[key]);
    });

    // Update table, form, and other elements that use hardcoded colors
    document.body.classList.toggle('dark-mode', dark);

    // Store preference
    try {
      localStorage.setItem(STORAGE_KEY, dark ? '1' : '0');
    } catch (e) { /* ignore */ }

    // Update toggle button state
    var btn = document.getElementById('darkModeToggle');
    if (btn) {
      btn.textContent = dark ? '☀️' : '🌙';
      btn.title = dark ? 'Modo claro' : 'Modo oscuro';
    }
  }

  function toggle() {
    applyTheme(!isDark);
  }

  function init() {
    // Check stored preference or system preference
    var stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }

    if (stored === '1') {
      applyTheme(true);
    } else if (stored === '0') {
      applyTheme(false);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      applyTheme(true);
    }

    // Listen for system changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (localStorage.getItem(STORAGE_KEY) === null) {
          applyTheme(e.matches);
        }
      });
    }
  }

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose
  window.DarkMode = { toggle: toggle, isDark: function () { return isDark; } };
})();
