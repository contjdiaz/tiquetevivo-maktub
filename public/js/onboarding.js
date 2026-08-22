/**
 * Onboarding Tour Module
 * Shows a guided tooltip tour for first-time users.
 * Steps highlight key UI elements with floating tooltips.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tv_onboarding_done';
  var steps = [];
  var currentStep = -1;
  var overlay = null;
  var tooltip = null;

  var DEFAULT_STEPS = [
    {
      target: '.biz-selector',
      title: '🏪 Selecciona tu Negocio',
      text: 'Aquí puedes cambiar entre tus negocios registrados.',
      position: 'right'
    },
    {
      target: '#orderForm',
      title: '✅ Crea un Tiquete',
      text: 'Llena los datos del cliente y el servicio. El recibo se envía por WhatsApp automáticamente.',
      position: 'left'
    },
    {
      target: '.stats',
      title: '📊 Métricas del Día',
      text: 'Ve tus pedidos, ventas, saldos pendientes y pedidos listos en tiempo real.',
      position: 'bottom'
    },
    {
      target: '#scanQrBtn',
      title: '📸 Escanear QR',
      text: 'Escanea el QR del tiquete para encontrar un pedido al instante y marcarlo como entregado.',
      position: 'bottom'
    },
    {
      target: '#cashReportBtn',
      title: '📊 Cierre de Caja',
      text: 'Genera un reporte diario y compártelo por WhatsApp con tu equipo.',
      position: 'bottom'
    }
  ];

  function injectCSS() {
    if (document.getElementById('onboardingCSS')) return;
    var style = document.createElement('style');
    style.id = 'onboardingCSS';
    style.textContent = [
      '.onboarding-overlay {',
      '  position: fixed; inset: 0; z-index: 10000;',
      '  background: rgba(15,23,42,.5);',
      '  transition: opacity .3s;',
      '}',
      '.onboarding-tooltip {',
      '  position: fixed; z-index: 10001;',
      '  background: #fff; border-radius: 14px;',
      '  padding: 20px 22px; width: min(320px, 90vw);',
      '  box-shadow: 0 20px 60px rgba(0,0,0,.25);',
      '  animation: tooltipIn .3s cubic-bezier(.4,0,.2,1);',
      '}',
      '@keyframes tooltipIn {',
      '  from { opacity:0; transform: translateY(8px); }',
      '  to { opacity:1; transform: translateY(0); }',
      '}',
      '.onboarding-tooltip h3 { margin: 0 0 8px; font-size: 16px; font-weight: 800; }',
      '.onboarding-tooltip p { margin: 0 0 16px; font-size: 13px; color: #64748b; line-height: 1.5; }',
      '.onboarding-actions { display: flex; gap: 8px; justify-content: flex-end; }',
      '.onboarding-btn {',
      '  border: none; border-radius: 8px; padding: 8px 16px;',
      '  font-size: 13px; font-weight: 700; cursor: pointer;',
      '  transition: all .15s;',
      '}',
      '.onboarding-btn.primary { background: #6366f1; color: #fff; }',
      '.onboarding-btn.primary:hover { background: #4f46e5; }',
      '.onboarding-btn.skip { background: #f1f5f9; color: #64748b; }',
      '.onboarding-btn.skip:hover { background: #e2e8f0; }',
      '.onboarding-progress {',
      '  display: flex; gap: 4px; margin-bottom: 12px;',
      '}',
      '.onboarding-dot {',
      '  width: 8px; height: 8px; border-radius: 50%;',
      '  background: #e2e8f0; transition: background .2s;',
      '}',
      '.onboarding-dot.active { background: #6366f1; }',
      '.onboarding-highlight {',
      '  position: relative; z-index: 10001;',
      '  box-shadow: 0 0 0 4px rgba(99,102,241,.3), 0 0 0 9999px rgba(15,23,42,.5);',
      '  border-radius: 12px;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function isDone() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (e) { return true; }
  }

  function markDone() {
    try { localStorage.setItem(STORAGE_KEY, '1'); }
    catch (e) { /* ignore */ }
  }

  function start(customSteps) {
    if (isDone()) return;
    steps = customSteps || DEFAULT_STEPS;
    currentStep = -1;
    injectCSS();
    next();
  }

  function next() {
    currentStep++;
    if (currentStep >= steps.length) {
      finish();
      return;
    }
    showStep(steps[currentStep]);
  }

  function showStep(step) {
    cleanup();

    var targetEl = document.querySelector(step.target);
    if (!targetEl) {
      next();
      return;
    }

    // Add highlight to target
    targetEl.classList.add('onboarding-highlight');

    // Create tooltip
    tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';

    // Progress dots
    var dotsHtml = '<div class="onboarding-progress">';
    for (var i = 0; i < steps.length; i++) {
      dotsHtml += '<div class="onboarding-dot' + (i === currentStep ? ' active' : '') + '"></div>';
    }
    dotsHtml += '</div>';

    tooltip.innerHTML = [
      dotsHtml,
      '<h3>' + step.title + '</h3>',
      '<p>' + step.text + '</p>',
      '<div class="onboarding-actions">',
      '  <button class="onboarding-btn skip" id="obSkip">Saltar</button>',
      '  <button class="onboarding-btn primary" id="obNext">' + (currentStep === steps.length - 1 ? 'Listo ✨' : 'Siguiente →') + '</button>',
      '</div>'
    ].join('');

    document.body.appendChild(tooltip);

    // Position tooltip near target
    positionTooltip(targetEl, step.position);

    document.getElementById('obNext').addEventListener('click', next);
    document.getElementById('obSkip').addEventListener('click', finish);
  }

  function positionTooltip(targetEl, position) {
    var rect = targetEl.getBoundingClientRect();
    var tooltipRect = tooltip.getBoundingClientRect();
    var margin = 12;

    var top, left;

    switch (position) {
      case 'right':
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        left = rect.right + margin;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        left = rect.left - tooltipRect.width - margin;
        break;
      case 'bottom':
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        break;
      default: // top
        top = rect.top - tooltipRect.height - margin;
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    }

    // Keep within viewport
    top = Math.max(10, Math.min(top, window.innerHeight - tooltipRect.height - 10));
    left = Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10));

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function cleanup() {
    // Remove highlight from all elements
    document.querySelectorAll('.onboarding-highlight').forEach(function (el) {
      el.classList.remove('onboarding-highlight');
    });
    // Remove tooltip
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
    }
  }

  function finish() {
    cleanup();
    markDone();
  }

  /**
   * Reset the onboarding so it shows again next time.
   */
  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (e) { /* ignore */ }
  }

  // Expose
  window.Onboarding = {
    start: start,
    reset: reset,
    finish: finish
  };
})();
