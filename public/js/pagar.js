/**
 * Pagar Page Module
 *
 * Handles the validated dynamic payment page flow:
 * 1. Reads order_id + token from URL params
 * 2. Validates the order via GET /api/validate-payment
 * 3. Caches validation result for 30 seconds (Requirement 12.2)
 * 4. Renders appropriate state (loading/valid/cancelled/paid/error)
 * 5. Handles payment button click → create-intent → redirect
 *
 * Requirements: 5.2, 5.3, 5.4, 12.2, 12.3
 */
(function () {
  'use strict';

  // --- Constants ---
  var CACHE_TTL_MS = 30000; // 30 seconds (Requirement 12.2)
  var VALIDATE_ENDPOINT = '/api/validate-payment';

  // --- DOM references ---
  var loadingState = document.getElementById('loadingState');
  var invalidLinkState = document.getElementById('invalidLinkState');
  var paidState = document.getElementById('paidState');
  var cancelledState = document.getElementById('cancelledState');
  var orderInfo = document.getElementById('orderInfo');
  var errorBox = document.getElementById('errorBox');
  var payBtn = document.getElementById('payBtn');
  var orderTitle = document.getElementById('orderTitle');
  var bizName = document.getElementById('bizName');
  var orderNumber = document.getElementById('orderNumber');
  var itemsText = document.getElementById('itemsText');
  var totalAmount = document.getElementById('totalAmount');
  var paidAmount = document.getElementById('paidAmount');
  var balanceAmount = document.getElementById('balanceAmount');

  // --- Cache ---
  var validationCache = {
    data: null,
    timestamp: 0,
    orderId: null,
    token: null
  };

  // --- Utility ---

  /**
   * Format a COP amount for display.
   * @param {number} amount - Amount in COP
   * @returns {string} Formatted currency string
   */
  function formatMoney(amount) {
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
      }).format(amount);
    }
    return '$' + Math.round(amount).toLocaleString('es-CO');
  }

  /**
   * Read URL parameters from the current page.
   * @returns {{ order_id: string|null, token: string|null }}
   */
  function getUrlParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      order_id: params.get('order_id') || null,
      token: params.get('token') || null
    };
  }

  /**
   * Show a specific state and hide all others.
   * @param {'loading'|'invalid'|'paid'|'cancelled'|'order'|'none'} state
   */
  function showState(state) {
    loadingState.classList.toggle('hidden', state !== 'loading');
    invalidLinkState.style.display = state === 'invalid' ? 'block' : 'none';
    paidState.style.display = state === 'paid' ? 'block' : 'none';
    cancelledState.style.display = state === 'cancelled' ? 'block' : 'none';
    orderInfo.classList.toggle('hidden', state !== 'order');
  }

  /**
   * Show an error message in the error box.
   * @param {string} message
   */
  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  /**
   * Hide the error box.
   */
  function hideError() {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  /**
   * Check if the cached validation result is still fresh.
   * @param {string} orderId
   * @param {string} token
   * @returns {boolean}
   */
  function isCacheValid(orderId, token) {
    if (!validationCache.data) return false;
    if (validationCache.orderId !== orderId || validationCache.token !== token) return false;
    return (Date.now() - validationCache.timestamp) < CACHE_TTL_MS;
  }

  /**
   * Store validation result in cache.
   * @param {object} data - API response
   * @param {string} orderId
   * @param {string} token
   */
  function setCacheData(data, orderId, token) {
    validationCache.data = data;
    validationCache.timestamp = Date.now();
    validationCache.orderId = orderId;
    validationCache.token = token;
  }

  /**
   * Invalidate the cache (Requirement 12.3: discard when payment action triggers).
   */
  function invalidateCache() {
    validationCache.data = null;
    validationCache.timestamp = 0;
  }

  // --- API calls ---

  /**
   * Validate the order via GET endpoint.
   * Uses cache if result is less than 30 seconds old (Requirement 12.2).
   *
   * @param {string} orderId
   * @param {string} token
   * @returns {Promise<object>} API response data
   */
  async function validateOrder(orderId, token) {
    // Check cache first (Requirement 12.2)
    if (isCacheValid(orderId, token)) {
      return validationCache.data;
    }

    var url = VALIDATE_ENDPOINT + '?order_id=' + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);

    var response = await fetch(url);
    var data = await response.json();

    if (!response.ok) {
      var error = new Error(data.error || 'validation_failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    // Cache the successful result
    setCacheData(data, orderId, token);
    return data;
  }

  /**
   * Create a payment intent via POST endpoint.
   * Invalidates cache before calling (Requirement 12.3).
   *
   * @param {string} orderId
   * @param {string} token
   * @returns {Promise<{ checkout_url: string, payment_reference: string, amount: number, gateway: string }>}
   */
  async function createPaymentIntent(orderId, token) {
    // Discard cache on payment action (Requirement 12.3)
    invalidateCache();

    var response = await fetch(VALIDATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create-intent',
        order_id: orderId,
        token: token
      })
    });

    var data = await response.json();

    if (!response.ok) {
      var error = new Error(data.error || 'payment_failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  // --- Render ---

  /**
   * Render the order data into the page.
   * Determines the appropriate state (paid/cancelled/valid with balance).
   *
   * @param {object} data - Validated order data from the API
   */
  function renderOrderData(data) {
    var order = data.order || data;

    // Update header
    orderTitle.textContent = 'Pedido #' + (order.order_number || '---');
    bizName.textContent = order.business_name || '';

    // Check for cancelled state
    if (data.cancelled || order.status === 'CANCELLED') {
      showState('cancelled');
      return;
    }

    // Check for fully paid state
    if (data.paid_in_full || (order.balance !== undefined && order.balance <= 0)) {
      showState('paid');
      return;
    }

    // Valid order with pending balance — show order info + pay button
    showState('order');

    orderNumber.textContent = '#' + (order.order_number || '---');
    itemsText.textContent = order.items_text || '—';
    totalAmount.textContent = formatMoney(order.total || 0);
    paidAmount.textContent = formatMoney(order.paid || 0);
    balanceAmount.textContent = formatMoney(order.balance || 0);

    // Update pay button text with amount
    payBtn.disabled = false;
    payBtn.innerHTML = 'Pagar ' + formatMoney(order.balance || 0);
  }

  // --- Payment flow ---

  /**
   * Handle the "Pagar" button click.
   * Disables button, shows loading, creates payment intent, redirects on success.
   * (Requirements 5.2, 5.3, 5.4)
   */
  async function handlePayClick() {
    var params = getUrlParams();
    if (!params.order_id || !params.token) return;

    // Disable button and show loading (Requirement 5.2)
    payBtn.disabled = true;
    payBtn.innerHTML = '<span class="spinner"></span> Procesando...';
    hideError();

    try {
      var result = await createPaymentIntent(params.order_id, params.token);

      if (result.checkout_url) {
        // Redirect to gateway checkout (Requirement 5.3)
        window.location.href = result.checkout_url;
      } else {
        throw new Error('No se recibió URL de pago');
      }
    } catch (err) {
      // Show error and re-enable button on failure (Requirement 5.4)
      payBtn.disabled = false;

      // Restore button text with balance
      var cachedBalance = validationCache.data && validationCache.data.order
        ? validationCache.data.order.balance
        : null;
      if (cachedBalance != null) {
        payBtn.innerHTML = 'Pagar ' + formatMoney(cachedBalance);
      } else {
        payBtn.innerHTML = 'Pagar';
      }

      var errorMessage = 'No se pudo iniciar el pago. Intenta de nuevo.';
      if (err.data && err.data.error === 'no_balance') {
        errorMessage = 'Este pedido ya no tiene saldo pendiente.';
      } else if (err.data && err.data.error === 'gateway_unavailable') {
        errorMessage = 'La pasarela de pago no está disponible en este momento.';
      } else if (err.message && err.message !== 'payment_failed') {
        errorMessage = err.message;
      }

      showError(errorMessage);
    }
  }

  // --- Initialization ---

  /**
   * Initialize the payment page.
   * Reads URL params, validates, and renders the appropriate state.
   */
  async function init() {
    var params = getUrlParams();

    // Check for missing params (Requirement 4.7)
    if (!params.order_id || !params.token) {
      showState('invalid');
      orderTitle.textContent = 'Error';
      return;
    }

    // Show loading state
    showState('loading');
    hideError();

    try {
      var data = await validateOrder(params.order_id, params.token);
      renderOrderData(data);
    } catch (err) {
      showState('none');
      // Hide all state cards on error
      loadingState.classList.add('hidden');

      if (err.status === 404) {
        showState('invalid');
        orderTitle.textContent = 'No encontrado';
      } else {
        orderTitle.textContent = 'Error';
        showError('No se pudo verificar el pedido. Intenta de nuevo más tarde.');
      }
    }
  }

  // --- Event binding ---

  if (payBtn) {
    payBtn.addEventListener('click', handlePayClick);
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for testing
  if (typeof window !== 'undefined') {
    window.PagarPage = {
      init: init,
      validateOrder: validateOrder,
      createPaymentIntent: createPaymentIntent,
      invalidateCache: invalidateCache,
      formatMoney: formatMoney
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      init: init,
      validateOrder: validateOrder,
      createPaymentIntent: createPaymentIntent,
      invalidateCache: invalidateCache,
      formatMoney: formatMoney
    };
  }
})();
