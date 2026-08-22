/**
 * QR Mode Selector Module
 *
 * Determines the appropriate QR mode based on order status and balance.
 * Manages mode transitions and user override tracking.
 */
(function () {
  'use strict';

  /**
   * Private flag tracking whether the user has manually selected a QR mode.
   * When true, automatic mode switching is suppressed.
   */
  var userHasOverridden = false;

  /**
   * Lifecycle phase mapping.
   * Groups order statuses into broader lifecycle phases for override reset logic.
   */
  var PHASE_MAP = {
    RECEIVED: 'processing',
    IN_PROGRESS: 'processing',
    READY: 'ready',
    DELIVERED: 'done',
    CANCELLED: 'cancelled'
  };

  /**
   * Select the default QR mode based on order status.
   *
   * @param {string} status - Order status: RECEIVED, IN_PROGRESS, READY, DELIVERED, CANCELLED
   * @param {number} balance - Current order balance (unused in default mode selection, reserved for future use)
   * @returns {string} The default QR mode: "track", "pickup", or "review"
   */
  function selectDefaultMode(status, balance) {
    switch (status) {
      case 'RECEIVED':
      case 'IN_PROGRESS':
        return 'track';
      case 'READY':
        return 'pickup';
      case 'DELIVERED':
        return 'review';
      case 'CANCELLED':
      default:
        return 'track';
    }
  }

  /**
   * Get the ordered array of available QR modes based on order status and balance.
   *
   * The default mode is always the first element. Additional modes are appended
   * based on the current order state:
   * - "pay" is included when balance > 0 and status is not DELIVERED
   * - When status is READY, "track" is included as an additional mode
   *
   * @param {string} status - Order status: RECEIVED, IN_PROGRESS, READY, DELIVERED, CANCELLED
   * @param {number} balance - Current order balance
   * @returns {string[]} Ordered array of available QR modes
   */
  function getAvailableModes(status, balance) {
    var defaultMode = selectDefaultMode(status, balance);
    var modes = [defaultMode];

    // Include "pay" when balance > 0 and status is not DELIVERED
    if (balance > 0 && status !== 'DELIVERED') {
      if (modes.indexOf('pay') === -1) {
        modes.push('pay');
      }
    }

    // When status is READY, ensure "track" is also available
    if (status === 'READY') {
      if (modes.indexOf('track') === -1) {
        modes.push('track');
      }
    }

    return modes;
  }

  /**
   * Set the user override flag.
   * Call with `true` when user manually selects a QR mode tab.
   * Call with `false` to allow automatic mode switching again.
   *
   * @param {boolean} flag - Whether the user has manually overridden the mode
   */
  function setUserOverride(flag) {
    userHasOverridden = !!flag;
  }

  /**
   * Determine whether the QR engine should auto-switch modes on status change.
   * Returns true when the user has NOT manually selected a mode.
   *
   * @returns {boolean} true if auto-switching is allowed, false if user has overridden
   */
  function shouldAutoSwitch() {
    return !userHasOverridden;
  }

  /**
   * Get the lifecycle phase for a given order status.
   *
   * @param {string} status - Order status
   * @returns {string|undefined} The lifecycle phase, or undefined for unknown statuses
   */
  function getPhase(status) {
    return PHASE_MAP[status];
  }

  /**
   * Reset the user override flag when the order transitions to a different lifecycle phase.
   *
   * Lifecycle phases:
   * - "processing": RECEIVED, IN_PROGRESS
   * - "ready": READY
   * - "done": DELIVERED
   * - "cancelled": CANCELLED
   *
   * If oldStatus and newStatus belong to the same phase (e.g., RECEIVED → IN_PROGRESS),
   * the override is preserved. If they belong to different phases (e.g., IN_PROGRESS → READY),
   * the override is reset to false to allow automatic mode switching.
   *
   * @param {string} oldStatus - Previous order status
   * @param {string} newStatus - New order status
   */
  function resetOverrideOnPhaseChange(oldStatus, newStatus) {
    var oldPhase = getPhase(oldStatus);
    var newPhase = getPhase(newStatus);

    if (oldPhase !== newPhase) {
      userHasOverridden = false;
    }
  }

  // Expose on global namespace for browser usage
  if (typeof window !== 'undefined') {
    window.QrModeSelector = window.QrModeSelector || {};
    window.QrModeSelector.selectDefaultMode = selectDefaultMode;
    window.QrModeSelector.getAvailableModes = getAvailableModes;
    window.QrModeSelector.setUserOverride = setUserOverride;
    window.QrModeSelector.shouldAutoSwitch = shouldAutoSwitch;
    window.QrModeSelector.resetOverrideOnPhaseChange = resetOverrideOnPhaseChange;
    window.QrModeSelector.getPhase = getPhase;
  }

  // Export for testing (Node.js / vitest)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      selectDefaultMode,
      getAvailableModes,
      setUserOverride,
      shouldAutoSwitch,
      resetOverrideOnPhaseChange,
      getPhase
    };
  }
})();
