/**
 * Loyalty Widget Module
 * Renders a visual stamp grid showing customer loyalty progress.
 * Shows reward banner with confetti when rewards are available.
 * Requires: confetti.js (window.Confetti.fire)
 */
(function () {
  'use strict';

  var CSS_INJECTED = false;

  function injectCSS() {
    if (CSS_INJECTED) return;
    CSS_INJECTED = true;

    var style = document.createElement('style');
    style.textContent = [
      '.loyalty-widget { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; }',
      '.loyalty-widget__title { font-size: 13px; font-weight: 800; color: #475569; margin: 0 0 12px; display: flex; align-items: center; gap: 6px; }',
      '.loyalty-widget__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(40px, 1fr)); gap: 8px; justify-items: center; }',
      '@media (min-width: 320px) and (max-width: 360px) { .loyalty-widget__grid { grid-template-columns: repeat(auto-fit, minmax(36px, 1fr)); gap: 6px; } }',
      '.loyalty-widget__stamp { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: 18px; border: 2px solid #e2e8f0; background: #fff; transition: all 0.3s ease; }',
      '.loyalty-widget__stamp--filled { background: #ecfdf5; border-color: #10b981; }',
      '.loyalty-widget__stamp--filled::after { content: "✓"; font-size: 16px; font-weight: 900; color: #10b981; }',
      '.loyalty-widget__stamp--empty { background: #f9fafb; border-color: #d1d5db; }',
      '.loyalty-widget__stamp--empty::after { content: ""; }',
      '.loyalty-widget__progress { margin-top: 10px; font-size: 12px; font-weight: 700; color: #64748b; text-align: center; }',
      '.loyalty-widget__reward-banner { margin-top: 12px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1.5px solid #f59e0b; border-radius: 10px; padding: 12px 14px; text-align: center; animation: loyaltyPulse 2s ease-in-out infinite; }',
      '.loyalty-widget__reward-banner strong { display: block; font-size: 14px; color: #92400e; margin-bottom: 4px; }',
      '.loyalty-widget__reward-banner span { font-size: 12px; color: #a16207; }',
      '@keyframes loyaltyPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.01); } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  /**
   * Render the loyalty stamp widget inside a container.
   * @param {HTMLElement} container - The DOM element to render into
   * @param {object} data - Loyalty data
   * @param {number} data.stamps_count - Current stamps earned
   * @param {number} data.stamps_target - Total stamps needed for reward
   * @param {number} data.reward_available - Number of rewards available to redeem
   */
  function render(container, data) {
    if (!container) return;

    var stampsCount = data.stamps_count || 0;
    var stampsTarget = data.stamps_target || 5;
    var rewardAvailable = data.reward_available || 0;

    // Clamp stamps to target for display
    var displayStamps = Math.min(stampsCount, stampsTarget);

    injectCSS();

    var html = '';
    html += '<div class="loyalty-widget">';
    html += '  <p class="loyalty-widget__title">🎟️ Tu Tarjeta de Fidelidad</p>';
    html += '  <div class="loyalty-widget__grid" role="group" aria-label="Sellos de fidelidad: ' + displayStamps + ' de ' + stampsTarget + '">';

    for (var i = 1; i <= stampsTarget; i++) {
      var isFilled = i <= displayStamps;
      var stampClass = isFilled ? 'loyalty-widget__stamp loyalty-widget__stamp--filled' : 'loyalty-widget__stamp loyalty-widget__stamp--empty';
      var ariaLabel = 'Sello ' + i + ' de ' + stampsTarget;
      if (isFilled) {
        ariaLabel += ' - obtenido';
      } else {
        ariaLabel += ' - pendiente';
      }
      html += '    <div class="' + stampClass + '" role="img" aria-label="' + ariaLabel + '"></div>';
    }

    html += '  </div>';
    html += '  <div class="loyalty-widget__progress">' + displayStamps + ' de ' + stampsTarget + ' sellos</div>';

    // Reward banner
    if (rewardAvailable > 0) {
      html += '  <div class="loyalty-widget__reward-banner" role="alert">';
      html += '    <strong>🎉 ¡Tienes ' + (rewardAvailable === 1 ? 'una recompensa' : rewardAvailable + ' recompensas') + ' disponible' + (rewardAvailable > 1 ? 's' : '') + '!</strong>';
      html += '    <span>Reclámala en tu próxima visita</span>';
      html += '  </div>';
    }

    html += '</div>';

    container.innerHTML = html;

    // Fire confetti when reward is available
    if (rewardAvailable > 0 && window.Confetti && typeof window.Confetti.fire === 'function') {
      // Small delay for visual effect after render
      setTimeout(function () {
        window.Confetti.fire();
      }, 400);
    }
  }

  // Expose on global namespace for browser usage
  if (typeof window !== 'undefined') {
    window.LoyaltyWidget = {
      render: render
    };
  }

  // Export for testing (Node.js / vitest)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { render };
  }
})();
