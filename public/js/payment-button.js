/**
 * Payment Button Module
 *
 * Renders a "Pagar Saldo Pendiente" button on the digital ticket when
 * the order has an outstanding balance. Handles the full payment flow:
 * 1. Click → create payment intent via API → redirect to gateway checkout
 * 2. On return from gateway → display success/pending/failure feedback
 *
 * Requirements: 4
 */
(function () {
  'use strict';

  /**
   * CSS styles injected once into the page for the payment button component.
   */
  var STYLES_INJECTED = false;

  function injectStyles() {
    if (STYLES_INJECTED) return;
    STYLES_INJECTED = true;

    var style = document.createElement('style');
    style.textContent = [
      '.payment-btn-container { margin-top: 4px; }',
      '.payment-btn {',
      '  width: 100%;',
      '  border: none;',
      '  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);',
      '  color: #fff;',
      '  font-weight: 800;',
      '  font-size: 15px;',
      '  padding: 14px 20px;',
      '  border-radius: 10px;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: 8px;',
      '  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);',
      '  transition: opacity 0.2s, transform 0.1s;',
      '}',
      '.payment-btn:hover { opacity: 0.92; transform: translateY(-1px); }',
      '.payment-btn:active { transform: translateY(0); }',
      '.payment-btn:disabled {',
      '  opacity: 0.6;',
      '  cursor: not-allowed;',
      '  transform: none;',
      '}',
      '.payment-btn-hidden { display: none; }',
      '.payment-status-msg {',
      '  padding: 12px 14px;',
      '  border-radius: 10px;',
      '  font-size: 13px;',
      '  font-weight: 700;',
      '  text-align: center;',
      '  margin-top: 8px;',
      '}',
      '.payment-status-success {',
      '  background: #ecfdf5;',
      '  border: 1.5px solid #a7f3d0;',
      '  color: #065f46;',
      '}',
      '.payment-status-pending {',
      '  background: #fffbeb;',
      '  border: 1.5px solid #fde68a;',
      '  color: #92400e;',
      '}',
      '.payment-status-failure {',
      '  background: #fef2f2;',
      '  border: 1.5px solid #fecaca;',
      '  color: #991b1b;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

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
   * Check URL parameters for payment return status.
   * Gateways redirect back with params like ?payment=complete or status indicators.
   *
   * @returns {string|null} 'success', 'pending', 'failure', or null if no return detected
   */
  function detectPaymentReturn() {
    var params = new URLSearchParams(window.location.search);

    // Check for our custom param set in create-payment-intent redirect URL
    var paymentParam = params.get('payment');
    if (!paymentParam) return null;

    // Wompi appends ?id=<transaction_id> to the redirect URL
    // Bold may append status directly
    var status = params.get('status') || params.get('transaction_status') || '';
    status = status.toUpperCase();

    if (paymentParam === 'complete') {
      // If a specific status is provided, use it
      if (status === 'APPROVED' || status === 'APROBADA') return 'success';
      if (status === 'DECLINED' || status === 'RECHAZADA' || status === 'VOIDED' || status === 'ERROR') return 'failure';
      if (status === 'PENDING' || status === 'PENDIENTE') return 'pending';
      // Default: payment=complete without explicit status means pending verification
      return 'pending';
    }

    return null;
  }

  /**
   * Render a payment status message based on the gateway return.
   *
   * @param {HTMLElement} container - The container to render the message into
   * @param {string} status - 'success', 'pending', or 'failure'
   */
  function renderStatusMessage(container, status) {
    var msg = document.createElement('div');
    msg.className = 'payment-status-msg';

    switch (status) {
      case 'success':
        msg.classList.add('payment-status-success');
        msg.textContent = '✅ ¡Pago exitoso! Tu saldo ha sido actualizado.';
        break;
      case 'pending':
        msg.classList.add('payment-status-pending');
        msg.textContent = '⏳ Pago en procesamiento. Tu saldo se actualizará en unos momentos.';
        break;
      case 'failure':
        msg.classList.add('payment-status-failure');
        msg.textContent = '❌ El pago no fue aprobado. Puedes intentarlo de nuevo.';
        break;
      default:
        return;
    }

    container.appendChild(msg);
  }

  /**
   * Create a payment intent by calling the backend API.
   *
   * @param {string} orderId - Order UUID
   * @param {string} gateway - 'WOMPI' or 'BOLD'
   * @returns {Promise<{checkout_url: string, payment_reference: string, amount: number, gateway: string}>}
   */
  async function createPaymentIntent(orderId, gateway) {
    var response = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, gateway: gateway })
    });

    var data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Error al crear el pago');
    }

    return data;
  }

  /**
   * Render the payment button component.
   *
   * @param {HTMLElement} container - DOM element to render into
   * @param {object} options - Configuration options
   * @param {string} options.orderId - Order UUID
   * @param {number} options.balance - Current pending balance (COP)
   * @param {string} [options.gateway] - Payment gateway: 'WOMPI' or 'BOLD' (defaults to env config)
   */
  function render(container, options) {
    if (!container) return;

    var orderId = options.orderId;
    var balance = Number(options.balance || 0);
    var gateway = (options.gateway || '').toUpperCase();

    injectStyles();

    // Clear previous content
    container.innerHTML = '';

    // Check if returning from a payment gateway
    var returnStatus = detectPaymentReturn();
    if (returnStatus) {
      renderStatusMessage(container, returnStatus);
      // If payment was successful, don't show the button
      if (returnStatus === 'success') return;
    }

    // Hide button when balance is 0
    if (balance <= 0) {
      container.innerHTML = '';
      container.classList.add('payment-btn-hidden');
      return;
    }

    container.classList.remove('payment-btn-hidden');

    // Create wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'payment-btn-container';

    // Create payment button
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'payment-btn';
    btn.setAttribute('aria-label', 'Pagar saldo pendiente de ' + formatMoney(balance));
    btn.innerHTML = '💳 Pagar Saldo Pendiente — ' + formatMoney(balance);

    // Click handler: create intent and redirect
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.innerHTML = '⏳ Conectando con pasarela de pago...';

      try {
        var result = await createPaymentIntent(orderId, gateway);

        if (result.checkout_url) {
          // Redirect to gateway checkout page
          window.location.href = result.checkout_url;
        } else {
          throw new Error('No checkout URL received');
        }
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '💳 Pagar Saldo Pendiente — ' + formatMoney(balance);

        // Show error message
        var existingError = wrapper.querySelector('.payment-status-msg');
        if (existingError) existingError.remove();

        var errorMsg = document.createElement('div');
        errorMsg.className = 'payment-status-msg payment-status-failure';
        errorMsg.textContent = '⚠️ ' + (err.message || 'Error al procesar el pago. Intenta de nuevo.');
        wrapper.appendChild(errorMsg);

        // Auto-remove error after 5 seconds
        setTimeout(function () {
          if (errorMsg.parentNode) errorMsg.remove();
        }, 5000);
      }
    });

    wrapper.appendChild(btn);
    container.appendChild(wrapper);
  }

  // Expose on global namespace for browser usage
  if (typeof window !== 'undefined') {
    window.PaymentButton = window.PaymentButton || {};
    window.PaymentButton.render = render;
    window.PaymentButton.detectPaymentReturn = detectPaymentReturn;
  }

  // Export for testing (Node.js / vitest)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      render: render,
      detectPaymentReturn: detectPaymentReturn
    };
  }
})();
