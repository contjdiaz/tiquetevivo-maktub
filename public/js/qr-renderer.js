/**
 * QR Renderer Module
 * Renders QR codes with mode-specific color schemes using qrcodejs.
 * Falls back to external QR API (qrserver.com) when qrcodejs is unavailable.
 */
(function () {
  'use strict';

  /**
   * Color schemes per QR mode.
   * Each mode maps to a dark color used for QR foreground.
   */
  var COLOR_SCHEMES = {
    track: { dark: '#1e40af', light: '#ffffff' },
    pickup: { dark: '#065f46', light: '#ffffff' },
    pay: { dark: '#92400e', light: '#ffffff' },
    review: { dark: '#6b21a8', light: '#ffffff' }
  };

  /**
   * Mode label icons rendered below the QR code.
   */
  var MODE_LABELS = {
    track: { icon: '\uD83D\uDCCD', text: 'Rastrear' },
    pickup: { icon: '\uD83C\uDFEA', text: 'Recoger' },
    pay: { icon: '\uD83D\uDCB3', text: 'Pagar' },
    review: { icon: '\u2B50', text: 'Reseña' }
  };

  /**
   * Render a QR code into the given container element with mode-specific colors.
   *
   * @param {HTMLElement} containerEl - DOM element to render into (will be cleared first)
   * @param {string} payload - String data to encode in the QR code
   * @param {"track"|"pickup"|"pay"|"review"} mode - QR mode determining color scheme
   * @param {number} [size=180] - Width/height of the QR code in pixels
   */
  function renderQr(containerEl, payload, mode, size) {
    if (!containerEl) return;

    size = size || 180;
    var scheme = COLOR_SCHEMES[mode] || COLOR_SCHEMES.track;
    var label = MODE_LABELS[mode] || MODE_LABELS.track;

    // Clear the container before rendering
    containerEl.innerHTML = '';

    // Create QR wrapper
    var qrWrapper = document.createElement('div');
    qrWrapper.className = 'qr-renderer-wrapper';
    qrWrapper.style.textAlign = 'center';

    // Create QR target element
    var qrTarget = document.createElement('div');
    qrTarget.className = 'qr-renderer-code';
    qrWrapper.appendChild(qrTarget);

    // Render QR code using qrcodejs or fallback
    if (typeof QRCode !== 'undefined') {
      renderWithQrCodeJs(qrTarget, payload, scheme, size);
    } else {
      renderWithFallback(qrTarget, payload, scheme, size);
    }

    // Create label below QR
    var labelDiv = document.createElement('div');
    labelDiv.className = 'qr-renderer-label';
    labelDiv.style.marginTop = '8px';
    labelDiv.style.fontSize = '14px';
    labelDiv.style.fontWeight = '600';
    labelDiv.style.color = scheme.dark;
    labelDiv.textContent = label.icon + ' ' + label.text;
    qrWrapper.appendChild(labelDiv);

    containerEl.appendChild(qrWrapper);
  }

  /**
   * Render QR using qrcodejs library (primary method).
   * @param {HTMLElement} target
   * @param {string} payload
   * @param {{ dark: string, light: string }} scheme
   * @param {number} size
   */
  function renderWithQrCodeJs(target, payload, scheme, size) {
    new QRCode(target, {
      text: payload,
      width: size,
      height: size,
      colorDark: scheme.dark,
      colorLight: scheme.light,
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  /**
   * Fallback: render QR via external API (qrserver.com) as an <img>.
   * Used when qrcodejs library is not loaded.
   * @param {HTMLElement} target
   * @param {string} payload
   * @param {{ dark: string, light: string }} scheme
   * @param {number} size
   */
  function renderWithFallback(target, payload, scheme, size) {
    var darkHex = scheme.dark.replace('#', '');
    var lightHex = scheme.light.replace('#', '');
    var url = 'https://api.qrserver.com/v1/create-qr-code/'
      + '?size=' + size + 'x' + size
      + '&data=' + encodeURIComponent(payload)
      + '&color=' + darkHex
      + '&bgcolor=' + lightHex;

    var img = document.createElement('img');
    img.src = url;
    img.alt = 'QR Code';
    img.width = size;
    img.height = size;
    img.style.display = 'block';
    img.style.margin = '0 auto';
    target.appendChild(img);
  }

  // Expose on global namespace
  if (typeof window !== 'undefined') {
    window.QrRenderer = window.QrRenderer || {};
    window.QrRenderer.renderQr = renderQr;
    window.QrRenderer.COLOR_SCHEMES = COLOR_SCHEMES;
    window.QrRenderer.MODE_LABELS = MODE_LABELS;
  }

  // Dual-export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderQr: renderQr, COLOR_SCHEMES: COLOR_SCHEMES, MODE_LABELS: MODE_LABELS };
  }
})();
