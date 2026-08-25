/**
 * Kanban Board Module for TiqueteVivo
 * Drag-and-drop board view for order status management.
 *
 * Design constraints (aligned with backend `_validators.js::validateStatusTransition`):
 * - Transitions are strictly sequential forward: only the NEXT step in the
 *   business `status_flow_config` is a valid target, plus the CANCELLED zone.
 * - Cards in the final (delivered) status can only be dragged to CANCELLED.
 * - Cards already CANCELLED are not draggable.
 *
 * The drop action delegates to the existing global `changeOrderStatus()`
 * pipeline (JWT auth, delivery photo modal, WhatsApp notifications, demo mode).
 * On API failure, app.js calls `KanbanBoard.onStatusChangeFailed()` which
 * re-renders the board from authoritative data (optimistic revert).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tv_kanban_view';
  var DEFAULT_FLOW = [
    { status_key: 'RECEIVED', display_label: 'Recibido' },
    { status_key: 'IN_PROGRESS', display_label: 'En proceso' },
    { status_key: 'READY', display_label: 'Listo' },
    { status_key: 'DELIVERED', display_label: 'Entregado' }
  ];
  var CANCELLED = 'CANCELLED';

  var viewMode = 'table';
  var isDragging = false;
  var boardBuilt = false;
  var builtFlowSignature = '';
  var currentFlow = [];
  var money = null;

  function flowSignature(flow) {
    return flow.map(function (e) { return e.status_key; }).join('|');
  }

  /* ────────────────────────────────────────────────────────────────
   * Pure logic — exported for vitest (no DOM access)
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Returns a sanitized status flow, falling back to the default laundry flow.
   * @param {Array<{status_key:string, display_label:string}>} [flow]
   * @returns {Array<{status_key:string, display_label:string}>}
   */
  function normalizeFlow(flow) {
    if (!Array.isArray(flow)) return DEFAULT_FLOW.slice();
    var clean = flow.filter(function (e) {
      return e && typeof e.status_key === 'string' && e.status_key.length > 0;
    });
    return clean.length > 0 ? clean : DEFAULT_FLOW.slice();
  }

  function flowIndexOf(statusKey, flow) {
    for (var i = 0; i < flow.length; i++) {
      if (flow[i].status_key === statusKey) return i;
    }
    return -1;
  }

  /**
   * Groups orders by their status key. Every flow key plus CANCELLED always
   * exist in the result (empty arrays included). Unknown statuses get their
   * own bucket so no order is ever dropped from the board.
   * @param {Array<Object>} orders
   * @param {Array<{status_key:string}>} [flow]
   * @returns {Object<string, Array<Object>>}
   */
  function groupOrdersByStatus(orders, flow) {
    var f = normalizeFlow(flow);
    var groups = {};
    f.forEach(function (entry) { groups[entry.status_key] = []; });
    groups[CANCELLED] = [];
    (orders || []).forEach(function (o) {
      var key = o && o.status ? o.status : f[0].status_key;
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    return groups;
  }

  /**
   * Valid drop targets for a card currently in `currentStatus`:
   * the next sequential step plus CANCELLED (always allowed by backend).
   * Terminal and CANCELLED cards have no targets.
   * @param {string} currentStatus
   * @param {Array<{status_key:string}>} [flow]
   * @returns {string[]}
   */
  function getValidDropTargets(currentStatus, flow) {
    var f = normalizeFlow(flow);
    if (!currentStatus || currentStatus === CANCELLED) return [];
    var idx = flowIndexOf(currentStatus, f);
    if (idx === -1) return [CANCELLED];
    var targets = [CANCELLED];
    if (idx < f.length - 1) targets.unshift(f[idx + 1].status_key);
    return targets;
  }

  /**
   * Whether a drag from `currentStatus` to `targetStatus` is allowed.
   */
  function canDropTo(currentStatus, targetStatus, flow) {
    return getValidDropTargets(currentStatus, flow).indexOf(targetStatus) !== -1;
  }

  /**
   * True when the status is the last step of the flow or CANCELLED.
   */
  function isTerminalStatus(statusKey, flow) {
    var f = normalizeFlow(flow);
    if (statusKey === CANCELLED) return true;
    var idx = flowIndexOf(statusKey, f);
    return idx !== -1 && idx === f.length - 1;
  }

  /* ────────────────────────────────────────────────────────────────
   * UI helpers
   * ──────────────────────────────────────────────────────────────── */

  function getConfig() {
    return (typeof businessConfig !== 'undefined' && businessConfig) || null;
  }

  function getFlow() {
    var cfg = getConfig();
    return normalizeFlow(cfg && cfg.status_flow_config);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getMoney() {
    if (!money) {
      money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    }
    return money;
  }

  function buildCardHtml(o) {
    var balance = Number(o.balance || 0);
    var balanceClass = balance > 0 ? 'pending' : 'zero';
    var service = o.custom_fields && o.custom_fields.service_type;
    var rack = o.custom_fields && o.custom_fields.rack_location;
    var isDemo = String(o.id || '').indexOf('demo-') === 0;

    return [
      '<div class="kanban-card' + (o.status === CANCELLED ? ' kanban-card-cancelled' : '') + '"',
      '     data-id="' + esc(o.id) + '"',
      '     data-status="' + esc(o.status) + '"',
      (o.status === CANCELLED ? '     data-nodrag="1"' : ''),
      '     title="#' + esc(o.order_number) + ' — ' + esc(o.customer_name) + '">',
      '  <div class="kanban-card-top">',
      '    <span class="kanban-card-num">#' + esc(o.order_number) + (isDemo ? ' ·demo' : '') + '</span>',
      '    <span class="kanban-card-balance ' + balanceClass + '">' + getMoney().format(balance) + '</span>',
      '  </div>',
      '  <div class="kanban-card-name">' + esc(o.customer_name) + '</div>',
      '  <div class="kanban-card-items">' + esc(o.items_text || '') + '</div>',
      (service ? '  <div class="kanban-card-chip">🧺 ' + esc(service) + '</div>' : ''),
      (rack ? '   <div class="kanban-card-chip kanban-card-rack">📍 ' + esc(rack) + '</div>' : ''),
      '</div>'
    ].filter(Boolean).join('');
  }

  function buildBoard() {
    var container = document.getElementById('kanbanBoard');
    if (!container) return;

    currentFlow = getFlow();
    var signature = flowSignature(currentFlow);
    if (boardBuilt && signature === builtFlowSignature) return; // already up to date

    var html = ['<div class="kanban-track">'];
    currentFlow.forEach(function (entry, idx) {
      var isLast = idx === currentFlow.length - 1;
      html.push(
        '<div class="kanban-column" data-status="' + esc(entry.status_key) + '">',
        '  <div class="kanban-column-header">',
        '    <span class="kanban-column-title">' + esc(entry.display_label || entry.status_key) + '</span>',
        '    <span class="kanban-column-count" id="kanbanCount-' + esc(entry.status_key) + '">0</span>',
        '  </div>',
        '  <div class="kanban-cards" data-status="' + esc(entry.status_key) + '"></div>',
        (isLast ? '  <div class="kanban-column-hint">Estado final</div>' : ''),
        '</div>'
      );
    });
    html.push(
      '<div class="kanban-column kanban-cancel-zone" data-status="' + CANCELLED + '">',
      '  <div class="kanban-column-header">',
      '    <span class="kanban-column-title">✕ Cancelar</span>',
      '    <span class="kanban-column-count" id="kanbanCount-' + CANCELLED + '">0</span>',
      '  </div>',
      '  <div class="kanban-cards" data-status="' + CANCELLED + '"></div>',
      '  <div class="kanban-column-hint">Suelta aquí para cancelar la orden</div>',
      '</div>',
      '</div>'
    );
    container.innerHTML = html.join('');
    boardBuilt = true;
    builtFlowSignature = signature;
    initSortables();
  }

  function initSortables() {
    if (typeof Sortable === 'undefined') return; // graceful degradation: static board

    document.querySelectorAll('#kanbanBoard .kanban-cards').forEach(function (list) {
      new Sortable(list, {
        group: 'orders-kanban',
        animation: 180,
        ghostClass: 'kanban-ghost',
        dragClass: 'kanban-dragging',
        chosenClass: 'kanban-chosen',
        filter: '[data-nodrag="1"]',
        onStart: function (evt) {
          isDragging = true;
          markTargets(evt.item.dataset.status, true);
        },
        onEnd: function () {
          isDragging = false;
          markTargets(null, false);
        },
        onMove: function (evt) {
          var from = evt.from.dataset.status;
          var to = evt.to.dataset.status;
          if (from === to) return true; // dropping back into own column = no-op
          return canDropTo(from, to, currentFlow);
        },
        onAdd: function (evt) {
          handleDrop(evt);
        }
      });
    });
  }

  function markTargets(sourceStatus, active) {
    document.querySelectorAll('#kanbanBoard .kanban-cards').forEach(function (list) {
      list.classList.remove('kanban-valid-target', 'kanban-invalid-target');
      if (!active || !sourceStatus) return;
      if (list.dataset.status === sourceStatus) return;
      var valid = canDropTo(sourceStatus, list.dataset.status, currentFlow);
      list.classList.add(valid ? 'kanban-valid-target' : 'kanban-invalid-target');
    });
  }

  function handleDrop(evt) {
    var orderId = evt.item.dataset.id;
    var newStatus = evt.to.dataset.status;

    // Delegate to existing pipeline (auth, photo modal, WhatsApp, demo mode).
    changeOrderStatus(orderId, newStatus);

    // Success path: doChangeOrderStatus() calls render(), which re-renders
    // this board from authoritative data. Failure path: app.js catch block
    // calls KanbanBoard.onStatusChangeFailed() which also re-renders,
    // restoring the card to its original column.
  }

  /**
   * Revert hook called by app.js when doChangeOrderStatus fails:
   * repaints the board from the untouched `orders` array.
   */
  function onStatusChangeFailed() {
    render();
  }

  /* ────────────────────────────────────────────────────────────────
   * Render & view mode
   * ──────────────────────────────────────────────────────────────── */

  function render() {
    if (isDragging) return;               // never rebuild mid-drag
    if (typeof orders === 'undefined') return;
    var container = document.getElementById('kanbanBoard');
    if (!container) return;

    var visible = orders.map(normalize).filter(function (o) {
      var q = document.getElementById('search') ? document.getElementById('search').value.toLowerCase() : '';
      var f = document.getElementById('statusFilter') ? document.getElementById('statusFilter').value : '';
      return (!f || o.status === f) &&
        ('' + o.order_number + ' ' + o.customer_name + ' ' + o.items_text + ' ' +
          (o.custom_fields && o.custom_fields.rack_location ? o.custom_fields.rack_location : ''))
          .toLowerCase().indexOf(q) !== -1;
    });

    buildBoard();
    if (!boardBuilt) return;

    currentFlow = getFlow();
    var groups = groupOrdersByStatus(visible, currentFlow);
    Object.keys(groups).forEach(function (statusKey) {
      var list = container.querySelector('.kanban-cards[data-status="' + statusKey + '"]');
      if (!list) return;
      list.innerHTML = groups[statusKey].map(buildCardHtml).join('');
      var count = document.getElementById('kanbanCount-' + statusKey);
      if (count) count.textContent = groups[statusKey].length;
    });

    // Re-init sortables for freshly created DOM nodes
    initSortables();

    if (typeof Sortable === 'undefined') {
      showFallbackNotice(container);
    }
  }

  function showFallbackNotice(container) {
    if (container.querySelector('.kanban-fallback')) return;
    var notice = document.createElement('div');
    notice.className = 'kanban-fallback';
    notice.textContent = 'Vista estática: arrastrar no disponible sin conexión al CDN.';
    container.prepend(notice);
  }

  function applyViewMode(mode) {
    viewMode = mode === 'kanban' ? 'kanban' : 'table';
    document.body.classList.toggle('kanban-active', viewMode === 'kanban');

    var btn = document.getElementById('viewToggle');
    if (btn) {
      btn.textContent = viewMode === 'kanban' ? '📋 Ver tabla' : '🗂️ Ver tablero';
      btn.title = viewMode === 'kanban' ? 'Volver a la vista de tabla' : 'Cambiar a tablero Kanban';
    }

    try {
      localStorage.setItem(STORAGE_KEY, viewMode === 'kanban' ? '1' : '0');
    } catch (e) { /* ignore */ }

    if (viewMode === 'kanban') render();
  }

  function toggleView() {
    applyViewMode(viewMode === 'kanban' ? 'table' : 'kanban');
  }

  function getViewMode() { return viewMode; }

  function init() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    var btn = document.getElementById('viewToggle');
    if (btn) btn.addEventListener('click', toggleView);

    // Own listeners: app.js binds the ORIGINAL render reference at parse time,
    // so the patched wrapper never fires on search/filter events.
    var search = document.getElementById('search');
    if (search) search.addEventListener('input', render);
    var filter = document.getElementById('statusFilter');
    if (filter) filter.addEventListener('change', render);

    applyViewMode(stored === '1' ? 'kanban' : 'table');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  /* ── Expose ── */
  var api = {
    normalizeFlow: normalizeFlow,
    groupOrdersByStatus: groupOrdersByStatus,
    getValidDropTargets: getValidDropTargets,
    canDropTo: canDropTo,
    isTerminalStatus: isTerminalStatus,
    render: render,
    toggleView: toggleView,
    applyViewMode: applyViewMode,
    onStatusChangeFailed: onStatusChangeFailed,
    getViewMode: getViewMode
  };

  if (typeof window !== 'undefined') {
    window.KanbanBoard = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
