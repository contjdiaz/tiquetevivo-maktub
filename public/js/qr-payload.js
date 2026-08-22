/**
 * QR Payload Builder Module
 * Generates QR data strings for each mode (track, pickup, pay, review).
 */
(function () {
  'use strict';

  /**
   * Build the Track QR payload — a full ticket URL for status tracking.
   * @param {{ order_number: string|number, slug: string }} order
   * @param {string} origin - The site origin, e.g. "https://tiquetevivo.netlify.app"
   * @returns {string} Full ticket URL
   */
  function buildTrackPayload(order, origin) {
    var orderNumber = order.order_number || order.orderNumber || '';
    var slug = order.slug || '';
    return origin + '/tiquete.html?number=' + encodeURIComponent(orderNumber) + '&slug=' + encodeURIComponent(slug);
  }

  /**
   * Build the Review QR payload — same ticket URL used as an archival receipt link.
   * @param {{ order_number: string|number, slug: string }} order
   * @param {string} origin - The site origin, e.g. "https://tiquetevivo.netlify.app"
   * @returns {string} Full ticket URL (archival)
   */
  function buildReviewPayload(order, origin) {
    return buildTrackPayload(order, origin);
  }

  /**
   * Build the Pickup QR payload — a structured string for operator scanning.
   * Format: TIQUETEVIVO:PICKUP|ID:{uuid}|NUM:{order_number}|SLUG:{slug}
   * @param {{ id: string, order_number: string|number, slug: string }} order
   * @returns {string} Structured pickup payload
   */
  function buildPickupPayload(order) {
    var id = order.id || '';
    var orderNumber = order.order_number || order.orderNumber || '';
    var slug = order.slug || '';
    return 'TIQUETEVIVO:PICKUP|ID:' + id + '|NUM:' + orderNumber + '|SLUG:' + slug;
  }

  /**
   * Build the Pay QR payload — a payment string with current balance, account, and reference.
   * Format: PAGO:{balance}|NEQUI:3102688991|REF:TiqueteVivo-{order_number}|NOMBRE:Majesty Lavanderia
   * @param {{ balance?: number, total?: number, paid?: number, order_number: string|number }} order
   * @returns {string} Structured payment payload
   */
  function buildPayPayload(order) {
    var balance = typeof order.balance === 'number'
      ? order.balance
      : Math.max(0, (order.total || 0) - (order.paid || 0));
    var orderNumber = order.order_number || order.orderNumber || '';
    return 'PAGO:' + balance + '|NEQUI:3102688991|REF:TiqueteVivo-' + orderNumber + '|NOMBRE:Majesty Lavanderia';
  }

  /**
   * Parse a structured pickup payload string back into its component parts.
   * @param {string} raw - The raw QR payload string to parse
   * @returns {{ id: string, orderNumber: string, slug: string } | null} Parsed payload or null if invalid
   */
  function parsePickupPayload(raw) {
    if (!raw || typeof raw !== 'string') return null;

    var prefix = 'TIQUETEVIVO:PICKUP|';
    if (raw.indexOf(prefix) !== 0) return null;

    var body = raw.slice(prefix.length);
    var segments = body.split('|');

    var id = null;
    var orderNumber = null;
    var slug = null;

    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (segment.indexOf('ID:') === 0) {
        id = segment.slice(3);
      } else if (segment.indexOf('NUM:') === 0) {
        orderNumber = segment.slice(4);
      } else if (segment.indexOf('SLUG:') === 0) {
        slug = segment.slice(5);
      }
    }

    if (!id || !orderNumber || !slug) return null;

    return { id: id, orderNumber: orderNumber, slug: slug };
  }

  // Expose on global namespace
  if (typeof window !== 'undefined') {
    window.QrPayload = window.QrPayload || {};
    window.QrPayload.buildTrackPayload = buildTrackPayload;
    window.QrPayload.buildReviewPayload = buildReviewPayload;
    window.QrPayload.buildPickupPayload = buildPickupPayload;
    window.QrPayload.parsePickupPayload = parsePickupPayload;
    window.QrPayload.buildPayPayload = buildPayPayload;
  }

  // Dual-export for vitest testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildTrackPayload, buildReviewPayload, buildPickupPayload, parsePickupPayload, buildPayPayload };
  }
})();
