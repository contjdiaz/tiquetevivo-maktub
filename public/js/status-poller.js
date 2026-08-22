/**
 * Status Poller Module
 *
 * Periodically checks for order status updates and triggers callbacks
 * when changes are detected. Integrates with the Page Visibility API
 * to pause/resume polling and handles network errors with retry logic.
 */
(function () {
  'use strict';

  var POLL_INTERVAL = 30000; // 30 seconds
  var RETRY_INTERVAL = 60000; // 60 seconds on network error
  var TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED'];

  /**
   * Create a status poller instance for a specific order.
   *
   * @param {object} options
   * @param {string|number} options.orderNumber - The order number to poll
   * @param {string} options.slug - The business slug
   * @param {function} options.onUpdate - Called with response data when status changes (compared via updated_at)
   * @param {function} [options.onError] - Called with error object on non-network errors (e.g., 404)
   * @param {function} [options.onOffline] - Called when a network error occurs
   * @param {function} [options.onOnline] - Called when network recovers after being offline
   * @returns {{ start: function, stop: function, forceCheck: function }}
   */
  function createStatusPoller(options) {
    var orderNumber = options.orderNumber;
    var slug = options.slug;
    var onUpdate = options.onUpdate;
    var onError = options.onError || function () {};
    var onOffline = options.onOffline || function () {};
    var onOnline = options.onOnline || function () {};

    var intervalId = null;
    var isRunning = false;
    var isOffline = false;
    var lastUpdatedAt = null;
    var currentInterval = POLL_INTERVAL;

    /**
     * Fetch the current order status from the API.
     * Handles response parsing, change detection, terminal status, and errors.
     */
    function fetchStatus() {
      var url = '/api/order-status?number=' + encodeURIComponent(orderNumber) + '&slug=' + encodeURIComponent(slug);

      fetch(url)
        .then(function (response) {
          if (!response.ok) {
            // Non-network HTTP errors (404, 400, 5xx)
            return response.json().then(function (body) {
              throw { httpStatus: response.status, body: body };
            }).catch(function (parseErr) {
              // If JSON parsing of error response fails
              if (parseErr.httpStatus) throw parseErr;
              throw { httpStatus: response.status, body: { error: 'Unknown error' } };
            });
          }
          return response.json();
        })
        .then(function (data) {
          // Network recovered
          if (isOffline) {
            isOffline = false;
            onOnline();
            // Switch back to normal polling interval
            if (isRunning) {
              clearInterval(intervalId);
              currentInterval = POLL_INTERVAL;
              intervalId = setInterval(fetchStatus, currentInterval);
            }
          }

          // Check for status change by comparing updated_at
          if (data.updated_at && data.updated_at !== lastUpdatedAt) {
            lastUpdatedAt = data.updated_at;
            onUpdate(data);
          }

          // Stop polling on terminal status
          if (TERMINAL_STATUSES.indexOf(data.status) !== -1) {
            stop();
          }
        })
        .catch(function (err) {
          if (err && err.httpStatus) {
            // HTTP error (not a network failure) — call onError, don't go offline
            onError(err);
            // On 404, stop polling — order doesn't exist
            if (err.httpStatus === 404) {
              stop();
            }
            return;
          }

          // Network error — switch to retry mode
          if (!isOffline) {
            isOffline = true;
            onOffline();
          }

          // Switch to retry interval
          if (isRunning) {
            clearInterval(intervalId);
            currentInterval = RETRY_INTERVAL;
            intervalId = setInterval(fetchStatus, currentInterval);
          }
        });
    }

    /**
     * Handle page visibility changes.
     * Pauses polling when tab is hidden, resumes with immediate fetch when visible.
     */
    function handleVisibilityChange() {
      if (!isRunning) return;

      if (document.hidden) {
        // Pause polling
        clearInterval(intervalId);
        intervalId = null;
      } else {
        // Resume: immediate fetch + restart interval
        fetchStatus();
        intervalId = setInterval(fetchStatus, currentInterval);
      }
    }

    /**
     * Start the status poller.
     * Begins polling immediately and sets up the Page Visibility API listener.
     */
    function start() {
      if (isRunning) return;
      isRunning = true;
      currentInterval = POLL_INTERVAL;

      // Initial fetch
      fetchStatus();

      // Set up regular polling
      intervalId = setInterval(fetchStatus, currentInterval);

      // Listen for visibility changes
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    /**
     * Stop the status poller.
     * Clears the polling interval and removes the visibility listener.
     */
    function stop() {
      if (!isRunning) return;
      isRunning = false;

      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }

    /**
     * Force an immediate status check.
     * Useful for manual refresh actions.
     */
    function forceCheck() {
      if (!isRunning) return;
      fetchStatus();
    }

    return {
      start: start,
      stop: stop,
      forceCheck: forceCheck
    };
  }

  // Expose on global namespace for browser usage
  if (typeof window !== 'undefined') {
    window.StatusPoller = window.StatusPoller || {};
    window.StatusPoller.createStatusPoller = createStatusPoller;
  }

  // Dual-export for testing (Node.js / vitest)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createStatusPoller: createStatusPoller
    };
  }
})();
