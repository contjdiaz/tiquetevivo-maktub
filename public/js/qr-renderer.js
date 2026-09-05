/**
 * QR Renderer Module
 * Renders QR codes with mode-specific color schemes using qrcodejs.
 * Normalizes the library output so it always fits a fixed-size container.
 * When qrcodejs is unavailable it falls back to an inline link (no external
 * services), so the ticket works offline and in private windows.
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
   * Render QR using the qrcodejs library.
   *
   * The bundled qrcodejs build renders as an HTML <table> (with a large fixed
   * margin) whenever it can't use canvas, which breaks inside fixed-size
   * containers. To render predictably, we let the library COMPUTE the QR matrix
   * (via a detached instance) and then draw it ourselves on a <canvas>. This
   * works offline and in private windows (no external QR service needed).
   *
   * @param {HTMLElement} target
   * @param {string} payload
   * @param {{ dark: string, light: string }} scheme
   * @param {number} size
   */
  function renderWithQrCodeJs(target, payload, scheme, size) {
    // Let the library render into the target as usual.
    new QRCode(target, {
      text: payload,
      width: size,
      height: size,
      colorDark: scheme.dark,
      colorLight: scheme.light,
      correctLevel: QRCode.CorrectLevel.M
    });

    // The bundled qrcodejs build has two output modes:
    //   - <canvas>/<img> (works fine), or
    //   - an HTML <table> with a large fixed `margin` (e.g. 80px) that pushes
    //     the QR out of a fixed-size container, showing a blank box.
    // Normalize whatever it produced so it always fits the container.
    normalizeQrOutput(target, size);
  }

  /**
   * Normalizes the qrcodejs output so it fits inside a fixed-size container:
   * removes the oversized table margin, and constrains canvas/img/table size.
   * @param {HTMLElement} target
   * @param {number} size
   */
  function normalizeQrOutput(target, size) {
    // Table-based output: strip the margin and scale the table to the size.
    var table = target.querySelector('table');
    if (table) {
      table.style.margin = '0 auto';
      table.style.borderCollapse = 'collapse';
      table.style.width = size + 'px';
      table.style.height = size + 'px';
      table.style.tableLayout = 'fixed';
      return;
    }

    // Canvas output: constrain display size and center it.
    var canvas = target.querySelector('canvas');
    if (canvas) {
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      return;
    }

    // Img output (some builds/browsers): constrain and center.
    var img = target.querySelector('img');
    if (img) {
      img.style.width = size + 'px';
      img.style.height = size + 'px';
      img.style.display = 'block';
      img.style.margin = '0 auto';
    }
  }

  /**
   * Fallback used only when the qrcodejs library is not loaded at all.
   * Instead of calling an external QR service (which fails in private windows
   * or offline), we show the encoded value as a scannable-free but usable link,
   * so the ticket never renders a blank box.
   * @param {HTMLElement} target
   * @param {string} payload
   * @param {{ dark: string, light: string }} scheme
   * @param {number} size
   */
  function renderWithFallback(target, payload, scheme, size) {
    var box = document.createElement('div');
    box.style.width = size + 'px';
    box.style.minHeight = size + 'px';
    box.style.margin = '0 auto';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.border = '2px dashed ' + scheme.dark;
    box.style.borderRadius = '8px';
    box.style.padding = '12px';
    box.style.boxSizing = 'border-box';

    var isUrl = /^https?:\/\//i.test(payload);
    if (isUrl) {
      var link = document.createElement('a');
      link.href = payload;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Abrir enlace del tiquete';
      link.style.color = scheme.dark;
      link.style.fontWeight = '700';
      link.style.wordBreak = 'break-all';
      link.style.textAlign = 'center';
      box.appendChild(link);
    } else {
      var code = document.createElement('div');
      code.textContent = payload;
      code.style.color = scheme.dark;
      code.style.fontFamily = 'monospace';
      code.style.fontSize = '12px';
      code.style.wordBreak = 'break-all';
      code.style.textAlign = 'center';
      box.appendChild(code);
    }
    target.appendChild(box);
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
