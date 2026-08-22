/**
 * Scanner Module — Operator QR Scanner for Order Identification
 * Uses html5-qrcode library for camera-based QR decoding.
 * Integrates with QrPayload.parsePickupPayload and global orders array.
 */
(function () {
  'use strict';

  var scanner = null;
  var isScanning = false;
  var audioCtx = null;

  // ─── Modal HTML Injection ────────────────────────────────────────────

  function createScannerModal() {
    if (document.getElementById('scannerModal')) return;

    var modal = document.createElement('div');
    modal.id = 'scannerModal';
    modal.className = 'modal';
    modal.onclick = function (e) {
      if (e.target === modal) closeScannerModal();
    };

    modal.innerHTML = [
      '<div class="modal-card" style="width:min(480px, 95%); max-height:90vh; overflow-y:auto; text-align:left;">',
      '  <div style="display:flex; justify-content:space-between; align-items:center;">',
      '    <strong style="font-size:18px;">📸 Escanear QR de Entrega</strong>',
      '    <button class="btn light" id="scannerCloseBtn" type="button" style="min-height:32px; padding:0 10px; font-size:18px;">✕</button>',
      '  </div>',
      '  <div id="scannerFeed" style="width:100%; min-height:280px; border-radius:12px; overflow:hidden; background:#1a1a2e; position:relative;"></div>',
      '  <div id="scannerControls" style="display:flex; gap:8px; justify-content:center;">',
      '    <button class="btn green" id="scannerStartBtn" type="button">▶ Iniciar Cámara</button>',
      '    <button class="btn light" id="scannerStopBtn" type="button" style="display:none;">⏹ Detener</button>',
      '  </div>',
      '  <div id="scannerResult" style="display:none;"></div>',
      '  <div id="scannerError" style="display:none; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:12px; color:#991b1b; font-size:13px; font-weight:600; text-align:center;"></div>',
      '  <div id="scannerFallback" style="display:none; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:14px; text-align:center;">',
      '    <p style="margin:0 0 8px; font-weight:800; color:#92400e;">⚠️ Cámara no disponible</p>',
      '    <p style="margin:0; font-size:13px; color:#78350f;">No se pudo acceder a la cámara. Busca el pedido manualmente por número de tiquete en la barra de búsqueda.</p>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);

    document.getElementById('scannerCloseBtn').addEventListener('click', closeScannerModal);
    document.getElementById('scannerStartBtn').addEventListener('click', startScanning);
    document.getElementById('scannerStopBtn').addEventListener('click', stopScanning);
  }

  // ─── Modal Open / Close ──────────────────────────────────────────────

  function openScannerModal() {
    createScannerModal();
    resetScannerUI();
    document.getElementById('scannerModal').classList.add('show');
    // Auto-start scanning
    startScanning();
  }

  function closeScannerModal() {
    stopScanning();
    document.getElementById('scannerModal').classList.remove('show');
  }

  function resetScannerUI() {
    var result = document.getElementById('scannerResult');
    var error = document.getElementById('scannerError');
    var fallback = document.getElementById('scannerFallback');
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
    if (error) { error.style.display = 'none'; error.textContent = ''; }
    if (fallback) { fallback.style.display = 'none'; }
  }

  // ─── Camera Scanning ─────────────────────────────────────────────────

  function startScanning() {
    if (isScanning) return;
    if (typeof Html5Qrcode === 'undefined') {
      showFallback();
      return;
    }

    resetScannerUI();
    document.getElementById('scannerStartBtn').style.display = 'none';
    document.getElementById('scannerStopBtn').style.display = 'inline-flex';

    scanner = new Html5Qrcode('scannerFeed');
    isScanning = true;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      function () { /* ignore scan failures (no QR in frame) */ }
    ).catch(function (err) {
      isScanning = false;
      document.getElementById('scannerStartBtn').style.display = 'inline-flex';
      document.getElementById('scannerStopBtn').style.display = 'none';

      if (err && (String(err).indexOf('NotAllowedError') !== -1 || String(err).indexOf('Permission') !== -1)) {
        showFallback();
      } else if (err && String(err).indexOf('NotFoundError') !== -1) {
        showFallback();
      } else {
        showError('No se pudo iniciar la cámara: ' + (err.message || err));
      }
    });
  }

  function stopScanning() {
    if (scanner && isScanning) {
      scanner.stop().then(function () {
        scanner.clear();
        isScanning = false;
      }).catch(function () {
        isScanning = false;
      });
    }
    document.getElementById('scannerStartBtn').style.display = 'inline-flex';
    document.getElementById('scannerStopBtn').style.display = 'none';
  }

  // ─── QR Decode Handler ───────────────────────────────────────────────

  function onScanSuccess(decodedText) {
    // Stop scanning after successful read
    stopScanning();

    // Parse pickup payload
    var parsed = null;
    if (window.QrPayload && window.QrPayload.parsePickupPayload) {
      parsed = window.QrPayload.parsePickupPayload(decodedText);
    }

    if (!parsed) {
      showError('Código QR inválido. Este QR no corresponde a un tiquete de entrega.');
      return;
    }

    // Lookup order in global orders array
    var order = findOrder(parsed);

    if (!order) {
      showError('Pedido no encontrado. Tiquete #' + parsed.orderNumber + ' no existe en el sistema.');
      return;
    }

    // Success: play feedback and show result
    playSuccessBeep();
    triggerHaptic();
    showOrderResult(order);
  }

  function findOrder(parsed) {
    // Access the global orders array from app.js
    var ordersArray = window.orders || [];
    if (typeof orders !== 'undefined') {
      ordersArray = orders;
    }

    for (var i = 0; i < ordersArray.length; i++) {
      var o = ordersArray[i];
      if (parsed.id && o.id === parsed.id) return o;
      if (parsed.orderNumber && String(o.order_number) === String(parsed.orderNumber)) return o;
    }
    return null;
  }

  // ─── Result Card ─────────────────────────────────────────────────────

  function showOrderResult(order) {
    var result = document.getElementById('scannerResult');
    var error = document.getElementById('scannerError');
    if (error) error.style.display = 'none';

    var money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    var balance = typeof order.balance === 'number' ? order.balance : Math.max(0, (order.total || 0) - (order.paid || 0));

    result.innerHTML = [
      '<div style="background:#ecfdf3; border:1px solid #a7f3d0; border-radius:12px; padding:16px; display:grid; gap:10px;">',
      '  <div style="display:flex; justify-content:space-between; align-items:center;">',
      '    <strong style="font-size:16px; color:#065f46;">✅ Pedido Encontrado</strong>',
      '    <span style="background:#d1fae5; color:#065f46; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:800;">#' + (order.order_number || '') + '</span>',
      '  </div>',
      '  <div style="display:grid; gap:6px; font-size:13px;">',
      '    <div><strong>👤 Cliente:</strong> ' + (order.customer_name || 'N/A') + '</div>',
      '    <div><strong>🧺 Detalle:</strong> ' + (order.items_text || 'N/A') + '</div>',
      '    <div><strong>📍 Ubicación:</strong> ' + (order.rack_location || 'No asignada') + '</div>',
      '    <div><strong>💰 Saldo:</strong> <span style="font-weight:900; color:' + (balance > 0 ? '#d92d20' : '#065f46') + ';">' + money.format(balance) + '</span></div>',
      '  </div>',
      '  <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">',
      '    <button class="btn green" id="scannerDeliverBtn" type="button">🚀 Marcar como Entregado</button>',
      '    <button class="btn light" id="scannerRescanBtn" type="button">🔄 Escanear Otro</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    result.style.display = 'block';

    document.getElementById('scannerDeliverBtn').addEventListener('click', function () {
      if (window.changeOrderStatus) {
        window.changeOrderStatus(order.id, 'DELIVERED');
        // Update result UI to show delivered
        this.disabled = true;
        this.textContent = '✅ Entregado';
        this.style.opacity = '0.7';
      }
    });

    document.getElementById('scannerRescanBtn').addEventListener('click', function () {
      resetScannerUI();
      startScanning();
    });
  }

  // ─── Error / Fallback UI ─────────────────────────────────────────────

  function showError(msg) {
    var error = document.getElementById('scannerError');
    var result = document.getElementById('scannerResult');
    if (result) result.style.display = 'none';
    error.textContent = msg;
    error.style.display = 'block';
  }

  function showFallback() {
    var fallback = document.getElementById('scannerFallback');
    fallback.style.display = 'block';
    document.getElementById('scannerStartBtn').style.display = 'none';
    document.getElementById('scannerStopBtn').style.display = 'none';
  }

  // ─── Audio / Haptic Feedback ─────────────────────────────────────────

  function playSuccessBeep() {
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioCtx) audioCtx = new AudioContext();

      var oscillator = audioCtx.createOscillator();
      var gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      // Audio not available — fail silently
    }
  }

  function triggerHaptic() {
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }
  }

  // ─── Expose on global namespace ──────────────────────────────────────

  window.Scanner = {
    open: openScannerModal,
    close: closeScannerModal
  };

})();
