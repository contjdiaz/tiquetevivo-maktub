/**
 * Entrega (Delivery Confirmation) Module
 *
 * Handles the simplified delivery confirmation flow:
 * 1. Validate delivery token via GET on page load
 * 2. Display order info (customer, address, amount)
 * 3. Capture photo via camera (file input with capture="environment")
 * 4. Compress photo client-side (800px max, JPEG 0.8)
 * 5. POST confirmation with base64 photo
 *
 * Total: exactly 2 API calls (1 GET validation + 1 POST confirmation)
 *
 * Requirements: 8.1, 8.4, 8.6, 8.8, 8.9, 12.4
 */
(function () {
  'use strict';

  // ─── DOM References ───────────────────────────────────────────────────────
  var stateLoading = document.getElementById('stateLoading');
  var stateExpired = document.getElementById('stateExpired');
  var stateAlreadyDelivered = document.getElementById('stateAlreadyDelivered');
  var stateError = document.getElementById('stateError');
  var stateSuccess = document.getElementById('stateSuccess');
  var deliveryContent = document.getElementById('deliveryContent');
  var errorMessage = document.getElementById('errorMessage');
  var btnRetryLoad = document.getElementById('btnRetryLoad');

  var customerName = document.getElementById('customerName');
  var deliveryAddress = document.getElementById('deliveryAddress');
  var amountCard = document.getElementById('amountCard');
  var amountValue = document.getElementById('amountValue');

  var btnConfirm = document.getElementById('btnConfirm');
  var photoInput = document.getElementById('photoInput');
  var statePhotoError = document.getElementById('statePhotoError');
  var photoErrorMessage = document.getElementById('photoErrorMessage');
  var btnRetryPhoto = document.getElementById('btnRetryPhoto');

  var uploadOverlay = document.getElementById('uploadOverlay');

  // ─── State ────────────────────────────────────────────────────────────────
  var orderId = null;
  var token = null;
  var capturedPhotoBase64 = null; // Keep photo in memory for retry

  // ─── URL Params ───────────────────────────────────────────────────────────
  function getUrlParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      order_id: params.get('order_id') || '',
      token: params.get('token') || ''
    };
  }

  // ─── State Management ─────────────────────────────────────────────────────
  function hideAllStates() {
    stateLoading.classList.remove('visible');
    stateExpired.classList.remove('visible');
    stateAlreadyDelivered.classList.remove('visible');
    stateError.classList.remove('visible');
    stateSuccess.classList.remove('visible');
    deliveryContent.style.display = 'none';
    statePhotoError.classList.remove('visible');
  }

  function showState(state) {
    hideAllStates();
    switch (state) {
      case 'loading':
        stateLoading.classList.add('visible');
        break;
      case 'expired':
        stateExpired.classList.add('visible');
        break;
      case 'already-delivered':
        stateAlreadyDelivered.classList.add('visible');
        break;
      case 'error':
        stateError.classList.add('visible');
        break;
      case 'success':
        stateSuccess.classList.add('visible');
        break;
      case 'valid':
        deliveryContent.style.display = 'block';
        break;
    }
  }

  // ─── Format Money ─────────────────────────────────────────────────────────
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

  // ─── API: Validate Token (GET) ────────────────────────────────────────────
  function validateToken() {
    showState('loading');

    var url = '/.netlify/functions/delivery-confirm?order_id=' +
      encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);

    fetch(url)
      .then(function (response) {
        if (response.status === 403) {
          showState('expired');
          return null;
        }
        if (response.status === 404) {
          errorMessage.textContent = 'Enlace de entrega no válido. Verifica con el operador.';
          showState('error');
          return null;
        }
        if (!response.ok) {
          errorMessage.textContent = 'No se pudo cargar la información. Verifica el enlace e intenta de nuevo.';
          showState('error');
          return null;
        }
        return response.json();
      })
      .then(function (data) {
        if (!data) return;

        // Handle already delivered
        if (data.already_delivered) {
          showState('already-delivered');
          return;
        }

        // Valid — render order info
        renderOrderInfo(data);
        showState('valid');
      })
      .catch(function () {
        errorMessage.textContent = 'Error de conexión. Verifica tu internet e intenta de nuevo.';
        showState('error');
      });
  }

  // ─── Render Order Info ────────────────────────────────────────────────────
  function renderOrderInfo(data) {
    var order = data.order || data;

    customerName.textContent = order.customer_name || '—';
    deliveryAddress.textContent = order.delivery_address || 'Dirección no disponible';

    var balance = Number(order.balance || 0);
    amountValue.textContent = formatMoney(balance);

    // Style the amount card based on balance
    if (balance <= 0) {
      amountCard.classList.add('paid');
      amountCard.querySelector('.amount-label').textContent = 'Sin cobro pendiente';
    }
  }

  // ─── Photo Compression ────────────────────────────────────────────────────
  /**
   * Compress an image file to JPEG with max 800px dimension and 0.8 quality.
   * Returns a base64 data URL string.
   *
   * @param {File} file - The captured image file
   * @returns {Promise<string>} Base64-encoded JPEG data URL
   */
  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onload = function (e) {
        var img = new Image();

        img.onload = function () {
          var maxDim = 800;
          var width = img.width;
          var height = img.height;

          // Calculate new dimensions keeping aspect ratio
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }

          // Draw on canvas and export as JPEG
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(dataUrl);
        };

        img.onerror = function () {
          reject(new Error('No se pudo procesar la imagen.'));
        };

        img.src = e.target.result;
      };

      reader.onerror = function () {
        reject(new Error('No se pudo leer el archivo.'));
      };

      reader.readAsDataURL(file);
    });
  }

  // ─── API: Confirm Delivery (POST) ─────────────────────────────────────────
  function confirmDelivery(photoBase64) {
    // Show upload overlay and disable button
    uploadOverlay.classList.add('visible');
    btnConfirm.disabled = true;

    fetch('/.netlify/functions/delivery-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'confirm',
        order_id: orderId,
        token: token,
        photo: photoBase64
      })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        uploadOverlay.classList.remove('visible');

        if (result.ok && result.data.success) {
          // Success: show ✅, hide all inputs
          showState('success');
          capturedPhotoBase64 = null;
          return;
        }

        // Error: show message, allow retry (keep photo in memory)
        var msg = result.data.detail || result.data.message || 'Error al confirmar la entrega.';
        showPhotoError(msg);
      })
      .catch(function () {
        uploadOverlay.classList.remove('visible');
        showPhotoError('Error de conexión. Intenta de nuevo.');
      });
  }

  // ─── Show Photo Error ─────────────────────────────────────────────────────
  function showPhotoError(message) {
    photoErrorMessage.textContent = message;
    statePhotoError.classList.add('visible');
    btnConfirm.disabled = false;
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  // Confirm button → triggers file input (opens camera)
  btnConfirm.addEventListener('click', function () {
    // If we have a photo from a previous failed attempt, re-submit directly
    if (capturedPhotoBase64) {
      confirmDelivery(capturedPhotoBase64);
      return;
    }
    // Otherwise open camera
    photoInput.click();
  });

  // Photo captured from camera
  photoInput.addEventListener('change', function () {
    var file = photoInput.files && photoInput.files[0];
    if (!file) return;

    // Hide previous photo errors
    statePhotoError.classList.remove('visible');
    btnConfirm.disabled = true;

    compressPhoto(file)
      .then(function (base64) {
        capturedPhotoBase64 = base64;
        confirmDelivery(base64);
      })
      .catch(function (err) {
        showPhotoError(err.message || 'Error al procesar la foto.');
        btnConfirm.disabled = false;
      });

    // Reset input so the same file can be re-selected
    photoInput.value = '';
  });

  // Retry load button
  btnRetryLoad.addEventListener('click', function () {
    validateToken();
  });

  // Retry photo button → open camera again
  btnRetryPhoto.addEventListener('click', function () {
    statePhotoError.classList.remove('visible');
    capturedPhotoBase64 = null;
    photoInput.click();
  });

  // ─── Initialization ───────────────────────────────────────────────────────
  function init() {
    var params = getUrlParams();
    orderId = params.order_id;
    token = params.token;

    if (!orderId || !token) {
      errorMessage.textContent = 'Enlace de entrega incompleto. Faltan parámetros.';
      showState('error');
      return;
    }

    validateToken();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
