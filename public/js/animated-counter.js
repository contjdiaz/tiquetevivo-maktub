/**
 * Animated Counter Module
 * Animates number transitions in stat elements using requestAnimationFrame.
 */
(function () {
  'use strict';

  var DURATION = 600; // ms
  var activeAnimations = {};

  /**
   * Animate a numeric value from current to target.
   * @param {HTMLElement} element - The target DOM element
   * @param {number} target - Target numeric value
   * @param {object} [options]
   * @param {function} [options.formatter] - Format function (value) => string
   * @param {number} [options.duration] - Animation duration in ms
   */
  function animateValue(element, target, options) {
    if (!element) return;

    options = options || {};
    var duration = options.duration || DURATION;
    var formatter = options.formatter || function (v) { return String(Math.round(v)); };

    // Get current displayed value
    var currentText = element.textContent || '0';
    var current = parseFloat(currentText.replace(/[^0-9.-]/g, '')) || 0;

    // Cancel any existing animation on this element
    var elId = element.id || ('counter_' + Math.random().toString(36).slice(2));
    if (activeAnimations[elId]) {
      cancelAnimationFrame(activeAnimations[elId]);
    }

    if (current === target) {
      element.textContent = formatter(target);
      return;
    }

    var startTime = null;
    var diff = target - current;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);

      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = current + diff * eased;

      element.textContent = formatter(value);

      if (progress < 1) {
        activeAnimations[elId] = requestAnimationFrame(step);
      } else {
        element.textContent = formatter(target);
        delete activeAnimations[elId];
      }
    }

    activeAnimations[elId] = requestAnimationFrame(step);
  }

  /**
   * Animate a money value with COP formatting.
   * @param {HTMLElement} element
   * @param {number} target
   */
  function animateMoney(element, target) {
    var formatter = new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0
    });
    animateValue(element, target, {
      formatter: function (v) { return formatter.format(Math.round(v)); }
    });
  }

  /**
   * Animate an integer count.
   * @param {HTMLElement} element
   * @param {number} target
   */
  function animateCount(element, target) {
    animateValue(element, target, {
      formatter: function (v) { return String(Math.round(v)); }
    });
  }

  // Expose
  window.AnimatedCounter = {
    animateValue: animateValue,
    animateMoney: animateMoney,
    animateCount: animateCount
  };
})();
