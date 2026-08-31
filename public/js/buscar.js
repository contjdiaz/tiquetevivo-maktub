/**
 * Buscar Module — Ticket Recovery Client
 *
 * Handles phone-based ticket recovery flow:
 * 1. Client-side phone validation (7-15 digits after stripping)
 * 2. Request OTP via POST /api/ticket-recovery (action: "request-otp")
 * 3. Verify OTP via POST /api/ticket-recovery (action: "verify-otp")
 * 4. Display recovered order cards with links to tiquete.html
 *
 * Requirements: 1.6, 3.1, 3.2, 3.5, 3.6, 12.1, 12.6
 */
(function () {
  'use strict';

  // ─── DOM References ───────────────────────────────────────────────────

  var phoneInput = document.getElementById('phoneInput');
  var phoneError = document.getElementById('phoneError');
  var slugInput = document.getElementById('slugInput');
  var searchBtn = document.getElementById('searchBtn');
  var searchSection = document.getElementById('searchSection');
  var otpSection = document.getElementById('otpSection');
  var otpInput = document.getElementById('otpInput');
  var otpError = document.getElementById('otpError');
  var verifyBtn = document.getElementById('verifyBtn');
  var resendLink = document.getElementById('resendLink');
  var loadingSpinner = document.getElementById('loadingSpinner');
  var resultsSection = document.getElementById('resultsSection');
  var ordersList = document.getElementById('ordersList');
  var globalError = document.getElementById('globalError');

  // ─── State ────────────────────────────────────────────────────────────

  var currentPhone = '';
  var currentSlug = '';
  var resendCooldown = false;

  // ─── Init — Pre-fill slug from URL param ──────────────────────────────

  function init() {
    var params = new URLSearchParams(window.location.search);
    var slugParam = params.get('slug');
    if (slugParam && slugInput) {
      slugInput.value = slugParam.trim();
    }

    // Attach event listeners
    searchBtn.addEventListener('click', handleSearch);
    verifyBtn.addEventListener('click', handleVerify);
    resendLink.addEventListener('click', handleResend);

    // Allow Enter key on inputs
    phoneInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleSearch();
    });
    otpInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleVerify();
    });

    // Clear phone error on input
    phoneInput.addEventListener('input', function () {
      clearPhoneError();
    });
  }

  // ─── Phone Validation ─────────────────────────────────────────────────

  /**
   * Strips non-digit characters (spaces, dashes, +, parens) and validates
   * that the result has between 7 and 15 digits.
   *
   * @param {string} raw - Raw phone input
   * @returns {{ valid: boolean, digits: string }}
   */
  function validatePhone(raw) {
    if (!raw) return { valid: false, digits: '' };

    // Strip +, spaces, dashes, parentheses, dots
    var digits = raw.replace(/[\s\-\+\(\)\.]/g, '');

    // Must be only digits after stripping
    if (!/^\d+$/.test(digits)) {
      return { valid: false, digits: digits };
    }

    // Must be between 7 and 15 digits
    if (digits.length < 7 || digits.length > 15) {
      return { valid: false, digits: digits };
    }

    return { valid: true, digits: digits };
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────

  function showLoading() {
    loadingSpinner.classList.add('visible');
  }

  function hideLoading() {
    loadingSpinner.classList.remove('visible');
  }

  function showPhoneError(msg) {
    phoneError.textContent = msg || 'Formato inválido. Ingresa entre 7 y 15 dígitos.';
    phoneError.classList.add('visible');
    phoneInput.classList.add('error');
  }

  function clearPhoneError() {
    phoneError.classList.remove('visible');
    phoneInput.classList.remove('error');
  }

  function showOtpError(msg) {
    otpError.textContent = msg;
    otpError.classList.add('visible');
    otpInput.classList.add('error');
  }

  function clearOtpError() {
    otpError.classList.remove('visible');
    otpInput.classList.remove('error');
  }

  function showGlobalError(msg) {
    globalError.textContent = msg;
    globalError.classList.add('visible');
  }

  function hideGlobalError() {
    globalError.classList.remove('visible');
    globalError.textContent = '';
  }

  function showSection(section) {
    section.classList.remove('section-hidden');
  }

  function hideSection(section) {
    section.classList.add('section-hidden');
  }

  function setButtonLoading(btn, loading, originalText) {
    if (loading) {
      btn.disabled = true;
      btn.textContent = '⏳ Procesando...';
    } else {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ─── API Calls ────────────────────────────────────────────────────────

  /**
   * Calls POST /api/ticket-recovery with the given body.
   *
   * @param {object} body - Request payload
   * @returns {Promise<{ ok: boolean, status: number, data: object }>}
   */
  async function callTicketRecovery(body) {
    try {
      var response = await fetch('/api/ticket-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      var data = await response.json();
      return { ok: response.ok, status: response.status, data: data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: 'network_error' } };
    }
  }

  // ─── Search Handler (Request OTP) ─────────────────────────────────────

  async function handleSearch() {
    hideGlobalError();
    clearPhoneError();

    var rawPhone = (phoneInput.value || '').trim();
    var slug = (slugInput.value || '').trim();

    // Client-side phone validation (Req 1.6, 12.1, 12.6)
    var validation = validatePhone(rawPhone);
    if (!validation.valid) {
      showPhoneError();
      return;
    }

    if (!slug) {
      showGlobalError('Ingresa el nombre del negocio.');
      return;
    }

    currentPhone = validation.digits;
    currentSlug = slug;

    setButtonLoading(searchBtn, true, '🔍 Buscar mi pedido');
    showLoading();

    var result = await callTicketRecovery({
      action: 'request-otp',
      phone: currentPhone,
      slug: currentSlug
    });

    hideLoading();
    setButtonLoading(searchBtn, false, '🔍 Buscar mi pedido');

    if (result.status === 429) {
      // Rate limit exceeded
      showGlobalError('Has solicitado demasiados códigos. Espera unos minutos e intenta de nuevo.');
      return;
    }

    if (!result.ok && result.data.error === 'verification_failed') {
      showGlobalError('No se pudo enviar el código de verificación. Intenta de nuevo.');
      return;
    }

    if (!result.ok && result.status !== 200) {
      showGlobalError('Ocurrió un error. Intenta de nuevo.');
      return;
    }

    // Success: show OTP section
    showSection(otpSection);
    hideSection(resultsSection);
    otpInput.value = '';
    clearOtpError();
    otpInput.focus();
    startResendCooldown();
  }

  // ─── Verify Handler (Verify OTP) ─────────────────────────────────────

  async function handleVerify() {
    hideGlobalError();
    clearOtpError();

    var code = (otpInput.value || '').trim();

    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      showOtpError('Ingresa el código de 6 dígitos.');
      return;
    }

    setButtonLoading(verifyBtn, true, '✅ Verificar');
    showLoading();

    var result = await callTicketRecovery({
      action: 'verify-otp',
      phone: currentPhone,
      slug: currentSlug,
      code: code
    });

    hideLoading();
    setButtonLoading(verifyBtn, false, '✅ Verificar');

    if (result.ok && result.data.orders) {
      // Success — display orders (Req 3.1, 3.2)
      displayOrders(result.data.orders);
      return;
    }

    // Handle error codes
    var error = result.data.error || '';

    if (error === 'invalid_code') {
      var remaining = result.data.remaining_attempts;
      var msg = 'Código incorrecto.';
      if (typeof remaining === 'number') {
        msg += ' Te quedan ' + remaining + ' intento' + (remaining !== 1 ? 's' : '') + '.';
      }
      showOtpError(msg);
      otpInput.value = '';
      otpInput.focus();
      return;
    }

    if (error === 'code_locked') {
      showOtpError('Código bloqueado. Solicita un nuevo código.');
      otpInput.value = '';
      return;
    }

    if (error === 'code_expired') {
      showOtpError('El código ha expirado. Solicita uno nuevo.');
      otpInput.value = '';
      return;
    }

    // Generic error
    showGlobalError('No se pudo verificar el código. Intenta de nuevo.');
  }

  // ─── Resend Handler ───────────────────────────────────────────────────

  async function handleResend() {
    if (resendCooldown) return;

    hideGlobalError();
    clearOtpError();

    resendLink.disabled = true;
    resendLink.textContent = '⏳ Reenviando...';

    var result = await callTicketRecovery({
      action: 'request-otp',
      phone: currentPhone,
      slug: currentSlug
    });

    if (result.status === 429) {
      showGlobalError('Has solicitado demasiados códigos. Espera unos minutos.');
      resendLink.disabled = false;
      resendLink.textContent = 'Reenviar código';
      return;
    }

    if (!result.ok && result.data.error === 'verification_failed') {
      showGlobalError('No se pudo reenviar el código. Intenta de nuevo.');
      resendLink.disabled = false;
      resendLink.textContent = 'Reenviar código';
      return;
    }

    // Success — restart cooldown
    otpInput.value = '';
    clearOtpError();
    otpInput.focus();
    startResendCooldown();
  }

  // ─── Resend Cooldown (30s) ────────────────────────────────────────────

  function startResendCooldown() {
    resendCooldown = true;
    resendLink.disabled = true;
    var remaining = 30;

    resendLink.textContent = 'Reenviar código (' + remaining + 's)';

    var interval = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        resendCooldown = false;
        resendLink.disabled = false;
        resendLink.textContent = 'Reenviar código';
      } else {
        resendLink.textContent = 'Reenviar código (' + remaining + 's)';
      }
    }, 1000);
  }

  // ─── Display Orders ───────────────────────────────────────────────────

  /**
   * Renders order cards in the results section.
   * Each card links to tiquete.html via ticket_token.
   *
   * @param {Array} orders - Array of order objects from the API
   */
  function displayOrders(orders) {
    hideSection(otpSection);
    showSection(resultsSection);
    ordersList.innerHTML = '';

    // Handle empty results (Req 3.5)
    if (!orders || orders.length === 0) {
      ordersList.innerHTML = '<div class="empty-state">No se encontraron pedidos activos para este número.</div>';
      return;
    }

    orders.forEach(function (order) {
      var card = createOrderCard(order);
      ordersList.appendChild(card);
    });
  }

  /**
   * Creates an order card element with link to tiquete.html.
   *
   * @param {object} order - Order data
   * @returns {HTMLElement}
   */
  function createOrderCard(order) {
    var ticketToken = order.ticket_token || order.ticketToken || '';
    var href = '/tiquete.html?ticket_token=' + encodeURIComponent(ticketToken);

    var card = document.createElement('a');
    card.className = 'order-card';
    card.href = href;

    var total = Number(order.total || 0);
    var paid = Number(order.paid || 0);
    var balance = Math.max(0, total - paid);

    // Status display mapping
    var statusText = formatStatus(order.status);
    var statusClass = getStatusClass(order.status);

    card.innerHTML = [
      '<div class="order-card-header">',
      '  <span class="order-card-number">#' + escapeHtml(order.order_number || '') + '</span>',
      '  <span class="order-card-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>',
      '</div>',
      '<div class="order-card-items">' + escapeHtml(order.items_text || 'Sin detalle') + '</div>',
      '<div class="order-card-footer">',
      '  <span class="order-card-total">Total: ' + formatMoney(total) + '</span>',
      '  <span class="order-card-balance ' + (balance === 0 ? 'paid' : '') + '">' +
           (balance === 0 ? '✅ Pagado' : 'Saldo: ' + formatMoney(balance)) +
      '  </span>',
      '</div>'
    ].join('\n');

    return card;
  }

  // ─── Utility Functions ────────────────────────────────────────────────

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
   * Maps internal status codes to user-friendly Spanish labels.
   * @param {string} status
   * @returns {string}
   */
  function formatStatus(status) {
    var map = {
      'RECEIVED': 'Recibido',
      'RECIBIDO': 'Recibido',
      'IN_PROGRESS': 'En proceso',
      'EN_PROCESO': 'En proceso',
      'READY': 'Listo',
      'LISTO': 'Listo',
      'WASHING': 'Lavando',
      'LAVANDO': 'Lavando',
      'DRYING': 'Secando',
      'SECANDO': 'Secando',
      'IRONING': 'Planchando',
      'PLANCHANDO': 'Planchando',
      'PENDING_PICKUP': 'Listo para recoger',
      'LISTO_PARA_RECOGER': 'Listo para recoger'
    };
    return map[status] || status || 'Desconocido';
  }

  /**
   * Returns a CSS class based on order status for styling the badge.
   * @param {string} status
   * @returns {string}
   */
  function getStatusClass(status) {
    var s = (status || '').toUpperCase();
    if (s === 'RECEIVED' || s === 'RECIBIDO') return 'received';
    if (s === 'READY' || s === 'LISTO' || s === 'PENDING_PICKUP' || s === 'LISTO_PARA_RECOGER') return 'ready';
    return 'in-progress';
  }

  /**
   * Escape HTML special characters to prevent XSS.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Initialize on DOM Ready ──────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for testing (Node.js / vitest)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      validatePhone: validatePhone,
      formatMoney: formatMoney,
      formatStatus: formatStatus,
      getStatusClass: getStatusClass,
      escapeHtml: escapeHtml
    };
  }
})();
