// TiqueteVivo App — Panel Administrativo
// Extracted from app.html for maintainability, caching, and CSP compliance.

const urlParams = new URLSearchParams(window.location.search);
let BUSINESS_SLUG = urlParams.get("slug") || "majesty";
const HAS_SLUG_PARAM = urlParams.has("slug");

// Single-business mode: when accessed with a slug in the URL, hide the business selector
// and show only that business. This is the default experience for laundry customers.
if (HAS_SLUG_PARAM) {
  document.body.classList.add("single-business-mode");
}

// ─── Authentication ──────────────────────────────────────────────────
// Stores the Supabase Auth access token for protected API calls.
// The login overlay is shown when no token is available.

let authToken = localStorage.getItem("tiquete_auth_token") || null;
let currentUser = null;

function isLoggedIn() {
  return Boolean(authToken);
}

/**
 * Wrapper around fetch that adds the Authorization header when a token exists.
 */
async function authFetch(url, options = {}) {
  const opts = { ...options };
  if (authToken) {
    opts.headers = {
      ...opts.headers,
      Authorization: `Bearer ${authToken}`
    };
  }
  return fetch(url, opts);
}

/**
 * Shows or hides the login overlay.
 */
function setLoginVisible(visible) {
  const overlay = document.getElementById("loginOverlay");
  if (overlay) {
    overlay.classList.toggle("hidden", !visible);
  }
}

/**
 * Renders the current user pill in the sidebar.
 */
function renderUserPill() {
  const pill = document.getElementById("userPill");
  const logoutBtn = document.getElementById("logoutBtn");
  if (!pill || !logoutBtn) return;

  if (currentUser && currentUser.email) {
    pill.style.display = "flex";
    pill.textContent = `👤 ${currentUser.email}`;
    logoutBtn.style.display = "flex";
  } else {
    pill.style.display = "none";
    logoutBtn.style.display = "none";
  }
}

/**
 * Handles the login form submission.
 */
async function handleLogin(event) {
  event.preventDefault();
  const btn = document.getElementById("loginBtn");
  const errorEl = document.getElementById("loginError");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  btn.disabled = true;
  btn.textContent = "Verificando...";
  errorEl.textContent = "";

  try {
    const res = await fetch("/api/auth-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Credenciales inválidas");
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("tiquete_auth_token", authToken);
    setLoginVisible(false);
    renderUserPill();
    // Reload data now that we are authenticated
    await fetchBusinessConfig();
    await sync();
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo iniciar sesión";
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar";
  }
}

function handleLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem("tiquete_auth_token");
  setLoginVisible(true);
  renderUserPill();
}

/**
 * Initializes authentication UI and state.
 */
function initAuth() {
  const loginForm = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logoutBtn");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  if (!isLoggedIn()) {
    setLoginVisible(true);
  } else {
    renderUserPill();
  }
}

// ─── Business Config (fetched dynamically on init) ───────────────────
// Module-level variable storing the business vertical configuration.
// Populated by fetchBusinessConfig() on app load.
let businessConfig = {
  business_id: "",
  business_name: "Cargando...",
  business_slug: BUSINESS_SLUG,
  plan: "free",
  vertical_emoji: "",
  vertical_name: "",
  services_config: [],
  custom_fields_config: [],
  status_flow_config: [],
  whatsapp_templates_config: {}
};

/**
 * Returns true when the loaded business has a paid plan.
 */
function isPaidPlan() {
  return businessConfig && businessConfig.plan === "paid";
}

// Fallback defaults used when config fetch fails (preserves legacy laundry behavior)
const FALLBACK_CONFIG = {
  business_id: "",
  business_name: "Majesty Lavanderia",
  business_slug: BUSINESS_SLUG,
  plan: "free",
  vertical_emoji: "🧺",
  vertical_name: "Lavandería",
  services_config: [
    { name: "Lavado estándar", description: "Lavado con detergente premium", default_price: 12000, duration: 180, unit: "per_kg", active: true },
    { name: "Planchado", description: "Planchado profesional", default_price: 8000, duration: 60, unit: "per_item", active: true },
    { name: "Tintorería", description: "Lavado en seco profesional", default_price: 25000, duration: 240, unit: "per_item", active: true },
    { name: "Lavado en seco", description: "Tratamiento especial para prendas delicadas", default_price: 20000, duration: 180, unit: "per_item", active: true }
  ],
  custom_fields_config: [
    { field_key: "is_delicate", display_label: "Prenda Delicada", field_type: "boolean", required: false, default_value: false },
    { field_key: "rack_location", display_label: "Ubicación / Estante", field_type: "text", required: false, default_value: null }
  ],
  status_flow_config: [
    { status_key: "RECEIVED", display_label: "Recibido" },
    { status_key: "IN_PROGRESS", display_label: "En proceso" },
    { status_key: "READY", display_label: "Listo" },
    { status_key: "DELIVERED", display_label: "Entregado" }
  ],
  whatsapp_templates_config: {}
};

/**
 * Fetches business configuration from the server.
 * Stores result in the module-level businessConfig variable.
 * Falls back to FALLBACK_CONFIG on failure.
 * Requirements: 10.1
 */
async function fetchBusinessConfig() {
  try {
    const response = await authFetch(`/api/get-business-config?slug=${BUSINESS_SLUG}`);
    if (!response.ok) throw new Error("Config fetch failed");
    const config = await response.json();
    businessConfig = config;
  } catch (error) {
    console.warn("Could not fetch business config, using fallback:", error.message);
    businessConfig = { ...FALLBACK_CONFIG };
  }
  // Update UI elements that depend on config
  applyConfigToUI();
}

/**
 * Applies loaded business config to UI elements.
 * Updates business name display, status filters, and service options.
 * Requirements: 10.3, 10.4
 */
function applyConfigToUI() {
  // Update business name in header
  const subElement = document.querySelector(".topbar .sub");
  if (subElement) {
    const emoji = businessConfig.vertical_emoji ? `${businessConfig.vertical_emoji} ` : "";
    subElement.textContent = `${emoji}${businessConfig.business_name || FALLBACK_CONFIG.business_name}`;
  }

  // In single-business mode, replace the global brand with the business name
  if (HAS_SLUG_PARAM) {
    const brandElement = document.querySelector(".brand");
    if (brandElement && businessConfig.business_name) {
      brandElement.innerHTML = `<span class="mark">${businessConfig.vertical_emoji || "TV"}</span>${businessConfig.business_name}`;
    }
  }

  // Render status filter options dynamically from status_flow_config
  renderStatusFilter();

  // Render service type options dynamically from services_config
  renderServiceOptions();

  // Render status options in the order form
  renderFormStatusOptions();

  // Render dynamic custom field inputs in the order form
  const customFieldsContainer = document.getElementById("customFieldsContainer");
  renderCustomFieldInputs(customFieldsContainer, businessConfig.custom_fields_config);

  // Trigger initial service selection behavior (show/hide kilos, auto-fill price)
  triggerInitialServiceSelection();

  // Apply plan-based feature gating (photos, digital confirmations)
  applyPlanGating();
}

/**
 * Hides or shows premium UI elements based on the current business plan.
 * Free plans disable photo evidence and digital confirmation inputs.
 */
function applyPlanGating() {
  const paid = isPaidPlan();

  const intakeWrap = document.getElementById("intakePhotoWrap");
  if (intakeWrap) {
    intakeWrap.style.display = paid ? "" : "none";
  }

  // Upsell notice for free plans
  let upsell = document.getElementById("planUpsell");
  if (!paid) {
    if (!upsell) {
      upsell = document.createElement("small");
      upsell.id = "planUpsell";
      upsell.style.cssText = "display:block; color:#b45309; font-size:12px; font-weight:700; margin-top:8px;";
      upsell.textContent = "⭐ Actualiza al plan pago para activar evidencia fotográfica y confirmaciones digitales.";
    }
    if (intakeWrap && upsell.parentElement !== intakeWrap.parentElement) {
      intakeWrap.parentElement.appendChild(upsell);
    }
  } else if (upsell) {
    upsell.remove();
  }
}

/**
 * Triggers the initial service selection logic after services are rendered.
 * Ensures the kilos box visibility, price auto-fill, and description display
 * are correct for the initially selected service.
 */
function triggerInitialServiceSelection() {
  const serviceSelect = document.getElementById("serviceTypeSelect");
  if (!serviceSelect || serviceSelect.options.length === 0) return;
  // Dispatch a change event to trigger the event listener logic
  serviceSelect.dispatchEvent(new Event("change"));
}

/**
 * Builds status labels map from status_flow_config.
 * Returns an object mapping status_key → display_label.
 */
function getStatusLabels() {
  const labels = {};
  const flow = businessConfig.status_flow_config || [];
  for (const entry of flow) {
    labels[entry.status_key] = entry.display_label;
  }
  // Always include CANCELLED as a universal status
  if (!labels.CANCELLED) {
    labels.CANCELLED = "Cancelado";
  }
  return labels;
}

/**
 * Renders status filter dropdown from business status_flow_config.
 * Replaces hardcoded RECEIVED/IN_PROGRESS/READY/DELIVERED options.
 * Requirements: 10.4
 */
function renderStatusFilter() {
  const statusFilter = document.getElementById("statusFilter");
  if (!statusFilter) return;

  const currentValue = statusFilter.value;
  const flow = businessConfig.status_flow_config || [];

  statusFilter.innerHTML = '<option value="">Todos</option>';
  for (const entry of flow) {
    const option = document.createElement("option");
    option.value = entry.status_key;
    option.textContent = entry.display_label;
    statusFilter.appendChild(option);
  }
  // Add CANCELLED option
  const cancelledOption = document.createElement("option");
  cancelledOption.value = "CANCELLED";
  cancelledOption.textContent = "Cancelado";
  statusFilter.appendChild(cancelledOption);

  // Restore previous selection if still valid
  if (currentValue) {
    statusFilter.value = currentValue;
  }
}

/**
 * Renders service type options in the order form from services_config.
 * Filters out inactive services and displays name, price, unit for each.
 * Shows description as accessible helper text below the select.
 * Replaces hardcoded PRENDA/KILOS options.
 * Requirements: 4.1, 10.3
 */
function renderServiceOptions() {
  const serviceSelect = document.getElementById("serviceTypeSelect");
  if (!serviceSelect) return;

  const services = (businessConfig.services_config || []).filter(s => s.active !== false);

  if (services.length === 0) return; // Keep existing HTML if no config available

  serviceSelect.innerHTML = "";
  for (const service of services) {
    const option = document.createElement("option");
    option.value = service.name;
    const unitLabel = getUnitLabel(service.unit);
    const priceLabel = service.default_price ? ` - ${money.format(service.default_price)}${unitLabel}` : "";
    option.textContent = `${service.name}${priceLabel}`;
    option.dataset.price = service.default_price || 0;
    option.dataset.unit = service.unit || "";
    option.dataset.description = service.description || "";
    option.title = service.description || service.name;
    serviceSelect.appendChild(option);
  }

  // Ensure service description helper element exists
  ensureServiceDescriptionElement(serviceSelect);
  // Show description for the initially selected service
  updateServiceDescription();
}

/**
 * Creates or retrieves the service description helper element below the select.
 * This provides accessible context about the selected service.
 * Requirements: 4.1
 */
function ensureServiceDescriptionElement(serviceSelect) {
  const parentLabel = serviceSelect.closest("label");
  if (!parentLabel) return;

  let descEl = document.getElementById("serviceDescription");
  if (!descEl) {
    descEl = document.createElement("small");
    descEl.id = "serviceDescription";
    descEl.setAttribute("role", "status");
    descEl.setAttribute("aria-live", "polite");
    descEl.style.cssText = "display:block; color:var(--muted); font-size:11px; font-weight:600; margin-top:4px; min-height:16px;";
    parentLabel.appendChild(descEl);
    // Link the description to the select for accessibility
    serviceSelect.setAttribute("aria-describedby", "serviceDescription");
  }
}

/**
 * Updates the service description helper text based on the currently selected service.
 */
function updateServiceDescription() {
  const serviceSelect = document.getElementById("serviceTypeSelect");
  const descEl = document.getElementById("serviceDescription");
  if (!serviceSelect || !descEl) return;

  const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
  const description = selectedOption?.dataset?.description || "";
  descEl.textContent = description ? `ℹ️ ${description}` : "";
}

/**
 * Renders status options in the order creation form from status_flow_config.
 * Replaces hardcoded status select in the form.
 * Requirements: 10.4
 */
function renderFormStatusOptions() {
  const statusSelect = document.querySelector('#orderForm select[name="status"]');
  if (!statusSelect) return;

  const flow = businessConfig.status_flow_config || [];
  if (flow.length === 0) return;

  statusSelect.innerHTML = "";
  for (const entry of flow) {
    const option = document.createElement("option");
    option.value = entry.status_key;
    option.textContent = entry.display_label;
    statusSelect.appendChild(option);
  }
}

/**
 * Returns a human-readable unit label suffix.
 */
function getUnitLabel(unit) {
  switch (unit) {
    case "per_kg": return "/kg";
    case "per_item": return "/und";
    case "per_hour": return "/hr";
    case "flat_rate": return " (tarifa fija)";
    default: return "";
  }
}

// ─── Demo Data ───────────────────────────────────────────────────────

const demoOrders = [
  { id: "demo-1", order_number: "8707", customer_name: "Richard Diaz", customer_phone: "+573001234567", items_text: "2 tenis Vans, 1 Converse blanco", total: 390000, paid: 200000, balance: 190000, status: "READY" },
  { id: "demo-2", order_number: "8708", customer_name: "Maria Restrepo", customer_phone: "+573011112222", items_text: "Chaqueta impermeable, lavado seco", total: 85000, paid: 85000, balance: 0, status: "IN_PROGRESS" },
  { id: "demo-3", order_number: "8709", customer_name: "Juan Gomez", customer_phone: "+573022223333", items_text: "Botas cuero, limpieza y tintura", total: 130000, paid: 60000, balance: 70000, status: "RECEIVED" }
];

let orders = JSON.parse(localStorage.getItem("tiquete_orders") || "null") || demoOrders;
let lastMessage = "";
let currentIntakePhoto = null;
let pendingDeliveryUpdate = null; // { orderId, newStatus }
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

// ─── Helpers ─────────────────────────────────────────────────────────

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.style.display = "block";
  setTimeout(() => node.style.display = "none", 2800);
}

function setDataStatus(message) {
  document.getElementById("dataStatus").textContent = message;
}

function digitsOnly(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalize(order) {
  // Build custom_fields, merging legacy top-level fields (is_delicate, rack_location) into it
  const customFields = { ...(order.custom_fields || {}) };
  // Legacy field mapping: if top-level is_delicate/rack_location exist, map into custom_fields
  if ((order.is_delicate || order.isDelicate) && !customFields.is_delicate) {
    customFields.is_delicate = Boolean(order.is_delicate || order.isDelicate);
  }
  if ((order.rack_location || order.rackLocation) && !customFields.rack_location) {
    customFields.rack_location = order.rack_location || order.rackLocation || "";
  }

  return {
    id: order.id || "",
    order_number: order.order_number || order.orderNumber || order.orderId,
    customer_name: order.customer_name || order.customerName,
    customer_phone: order.customer_phone || order.customerPhone,
    items_text: order.items_text || order.itemsText,
    total: Number(order.total || 0),
    paid: Number(order.paid || 0),
    balance: Number(order.balance ?? Math.max(0, Number(order.total || 0) - Number(order.paid || 0))),
    status: order.status || (businessConfig.status_flow_config[0]?.status_key || "RECEIVED"),
    due_date: order.due_date || order.dueDate || "",
    custom_fields: customFields,
    intake_photo_url: order.intake_photo_url || null,
    intake_photo_taken_at: order.intake_photo_taken_at || null,
    delivery_photo_url: order.delivery_photo_url || null,
    delivery_photo_taken_at: order.delivery_photo_taken_at || null,
    intake_confirmed_at: order.intake_confirmed_at || null,
    intake_confirmed_ip: order.intake_confirmed_ip || null,
    delivery_confirmed_at: order.delivery_confirmed_at || null,
    delivery_confirmed_ip: order.delivery_confirmed_ip || null
  };
}

// ─── Photo Evidence Helpers ──────────────────────────────────────────

/**
 * Compresses an image file to a JPEG of max ~800px width/height.
 * Returns a base64 data URL (image/jpeg).
 */
function compressImage(file, maxDimension = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("El archivo no es una imagen"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round(height * maxDimension / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round(width * maxDimension / height);
            height = maxDimension;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

/**
 * Wires a file input + preview + remove button for photo evidence.
 */
function wirePhotoInput({ inputId, previewId, imgId, removeId, wrapId, onChange }) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const img = document.getElementById(imgId);
  const remove = document.getElementById(removeId);
  const wrap = document.getElementById(wrapId);
  if (!input || !preview || !img || !remove || !wrap) return;

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      img.src = dataUrl;
      preview.classList.add("show");
      wrap.classList.add("has-photo");
      if (onChange) onChange(dataUrl);
    } catch (err) {
      console.error(`[wirePhotoInput:${inputId}] error:`, err);
      toast(err.message || "Error al procesar la imagen");
      input.value = "";
    }
  });

  remove.addEventListener("click", () => {
    input.value = "";
    img.src = "";
    preview.classList.remove("show");
    wrap.classList.remove("has-photo");
    if (onChange) onChange(null);
  });
}

// ─── QR Generation (local, no external API dependency) ───────────────

function buildTicketUrl(orderNumber, slug) {
  return `${window.location.origin}/tiquete.html?number=${orderNumber}&slug=${slug || BUSINESS_SLUG}`;
}

function generateQR(targetElement, data, size) {
  targetElement.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(targetElement, {
      text: data,
      width: size || 180,
      height: size || 180,
      colorDark: "#101828",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    // Fallback: use external API if library failed to load
    const img = document.createElement("img");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size || 180}x${size || 180}&data=${encodeURIComponent(data)}`;
    img.alt = "QR Tiquete Digital";
    img.style.width = `${size || 180}px`;
    img.style.height = `${size || 180}px`;
    img.style.display = "block";
    img.style.margin = "auto";
    targetElement.appendChild(img);
  }
}

// ─── WhatsApp Message Templates ──────────────────────────────────────

function buildWhatsAppMessage(order, templateName) {
  const o = normalize(order);
  const template = templateName || order.templateName || "default";
  const ticketUrl = buildTicketUrl(o.order_number);
  const name = o.customer_name || "Cliente";
  const businessName = businessConfig.business_name || "TiqueteVivo";
  const address = o.customerAddress || "";

  switch (template) {
    case "maktub_recogida":
      return [
        `🐧 *${businessName.toUpperCase()}*`,
        `🚚 *Confirmación de Recogida a Domicilio*`,
        ``,
        `Hola *${name}* 👋`,
        `Estamos programando la recogida de tus prendas.`,
        ``,
        `📍 *Dirección de recogida:*`,
        `${address}`,
        ``,
        `🧺 *Detalle del Servicio:*`,
        `• ${o.items_text}`,
        ``,
        `⏱️ *Tiempo estimado:* 3 horas tras la recogida.`,
        ``,
        `🌱 *Sigue tu pedido en vivo:*`,
        `${ticketUrl}`,
        ``,
        `¡En breve nuestro domiciliario estará contigo! 🛵✨`
      ].join("\n");

    case "maktub_en_entrega":
      return [
        `🛵 *¡TU PEDIDO VA EN CAMINO!*`,
        `🐧 ${businessName} · Tiquete #${o.order_number}`,
        ``,
        `Hola *${name}* 👋`,
        `Tus prendas ya fueron lavadas, secadas y planchadas con la mejor calidad.`,
        ``,
        `💳 *Saldo a pagar al recibir:*`,
        `*${money.format(o.balance)}* (Aceptamos Nequi, Daviplata o Efectivo)`,
        ``,
        `🌱 *Ver Recibo Digital Completo:*`,
        `${ticketUrl}`,
        ``,
        `¡Gracias por confiar el cuidado de tus prendas en nosotros! ✨`
      ].join("\n");

    case "maktub_remision_b2b":
      return [
        `🏨 *${businessName.toUpperCase()}*`,
        `📋 *Remisión Comercial B2B #${o.order_number}*`,
        ``,
        `Estimado(a) *${name}* 👋`,
        ``,
        `🧺 *Detalle de Kilos Procesados:*`,
        `• ${o.items_text}`,
        ``,
        `💳 *Resumen de Cuenta:*`,
        `• Total Servicio: ${money.format(o.total)}`,
        `• Saldo Pendiente: *${money.format(o.balance)}*`,
        ``,
        `🌱 *Ver Remisión Digital Completa:*`,
        `${ticketUrl}`,
        ``,
        `Agradecemos su confianza en nuestro servicio corporativo 🐧`
      ].join("\n");

    case "maktub_cobro":
      return [
        `💸 *RECORDATORIO DE PAGO*`,
        `🐧 ${businessName} · Tiquete #${o.order_number}`,
        ``,
        `Hola *${name}* 👋`,
        `Esperamos que te encuentres muy bien.`,
        ``,
        `💳 *Saldo Pendiente de tu Servicio:*`,
        `*${money.format(o.balance)}*`,
        ``,
        `🏦 *Medios de Pago Disponibles:*`,
        `• Nequi / Daviplata: 310 268 8991`,
        `• Bancolombia Ahorros: 123-456789-01`,
        ``,
        `🌱 *Ver Tiquete Digital:*`,
        `${ticketUrl}`,
        ``,
        `Envíanos el comprobante por este chat. ¡Muchas gracias! 🐧✨`
      ].join("\n");

    default:
      return [
        `🐧 *${businessName.toUpperCase()}*`,
        `📄 *Recibo Digital #${o.order_number}*`,
        ``,
        `Hola *${name}* 👋`,
        `¡Gracias por confiar en nosotros!`,
        ``,
        `🧺 *Detalle del Servicio:*`,
        `• ${o.items_text}`,
        ``,
        `💳 *Resumen del Pedido:*`,
        `• Total Servicio: ${money.format(o.total)}`,
        `• Abono Realizado: ${money.format(o.paid)}`,
        `• Saldo Pendiente: *${money.format(o.balance)}*`,
        ``,
        `🌱 *Consulta tu Tiquete Digital 100% Cero Papel:*`,
        `${ticketUrl}`,
        ``,
        `¡Nos aseguraremos de dejar todo impecable! ✨`
      ].join("\n");
  }
}

function buildWaLink(order, templateName) {
  const o = normalize(order);
  return `https://wa.me/${digitsOnly(o.customer_phone)}?text=${encodeURIComponent(buildWhatsAppMessage(o, templateName))}`;
}

// ─── Order Status ────────────────────────────────────────────────────

/**
 * Determines if a status represents a delivered/final state.
 * In a vertical-aware flow, this is the last step. Legacy fallback: DELIVERED.
 */
function isDeliveredStatus(status) {
  if (!status) return false;
  if (status.toUpperCase() === "DELIVERED") return true;
  const flow = businessConfig.status_flow_config || [];
  if (flow.length > 0) {
    const last = flow[flow.length - 1];
    if (last && last.status_key.toUpperCase() === status.toUpperCase()) return true;
  }
  return false;
}

async function changeOrderStatus(orderId, newStatus) {
  if (!orderId || orderId.startsWith("demo-")) {
    const order = orders.find(o => o.id === orderId);
    if (order) { order.status = newStatus; render(); toast("Estado actualizado localmente"); }
    return;
  }

  // If changing to delivered, offer optional delivery photo first
  if (isDeliveredStatus(newStatus)) {
    pendingDeliveryUpdate = { orderId, newStatus };
    openDeliveryPhotoModal();
    return;
  }

  await doChangeOrderStatus(orderId, newStatus, null);
}

async function doChangeOrderStatus(orderId, newStatus, deliveryPhoto) {
  try {
    const payload = { id: orderId, status: newStatus, slug: BUSINESS_SLUG };
    if (deliveryPhoto) payload.deliveryPhoto = deliveryPhoto;

    const res = await authFetch("/api/update-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: "Error desconocido" }));
      console.error("[doChangeOrderStatus] server error:", errorBody);
      throw new Error(errorBody.message || errorBody.error || "Error al actualizar estado");
    }
    const updated = await res.json();
    const index = orders.findIndex(o => o.id === orderId);
    if (index !== -1) orders[index] = normalize(updated);
    localStorage.setItem("tiquete_orders", JSON.stringify(orders));
    render();
    toast("Estado actualizado en la nube");
  } catch (err) {
    toast(err.message);
    // Kanban revert: repaint board from authoritative data after failed update
    if (window.KanbanBoard) KanbanBoard.onStatusChangeFailed();
  }
}

// ─── Delivery Photo Modal ────────────────────────────────────────────

let currentDeliveryPhoto = null;

function openDeliveryPhotoModal() {
  // Photo evidence is a paid feature; skip modal on free plans
  if (!isPaidPlan()) {
    if (pendingDeliveryUpdate) {
      doChangeOrderStatus(pendingDeliveryUpdate.orderId, pendingDeliveryUpdate.newStatus, null);
      pendingDeliveryUpdate = null;
    }
    return;
  }

  const modal = document.getElementById("deliveryPhotoModal");
  if (modal) modal.classList.add("show");
  currentDeliveryPhoto = null;
  const input = document.getElementById("deliveryPhotoInput");
  const preview = document.getElementById("deliveryPhotoPreview");
  const img = document.getElementById("deliveryPhotoImg");
  const wrap = document.getElementById("deliveryPhotoWrap");
  if (input) input.value = "";
  if (img) img.src = "";
  if (preview) preview.classList.remove("show");
  if (wrap) wrap.classList.remove("has-photo");
}

function closeDeliveryPhotoModal(confirmed) {
  const modal = document.getElementById("deliveryPhotoModal");
  if (modal) modal.classList.remove("show");

  if (confirmed && pendingDeliveryUpdate) {
    doChangeOrderStatus(pendingDeliveryUpdate.orderId, pendingDeliveryUpdate.newStatus, currentDeliveryPhoto);
  } else if (pendingDeliveryUpdate) {
    doChangeOrderStatus(pendingDeliveryUpdate.orderId, pendingDeliveryUpdate.newStatus, null);
  }
  pendingDeliveryUpdate = null;
  currentDeliveryPhoto = null;
}

window.openDeliveryPhotoModal = openDeliveryPhotoModal;
window.closeDeliveryPhotoModal = closeDeliveryPhotoModal;

function closeDeliveryPhotoModalOnBackdrop() {
  // If a photo was selected, treat backdrop click as confirm to avoid losing the image.
  // Otherwise treat it as skip.
  closeDeliveryPhotoModal(Boolean(currentDeliveryPhoto));
}

window.closeDeliveryPhotoModalOnBackdrop = closeDeliveryPhotoModalOnBackdrop;

// ─── QR Modal ────────────────────────────────────────────────────────

function openQrModal(orderNumber) {
  const order = orders.find(o => String(o.order_number) === String(orderNumber) || String(o.id) === String(orderNumber));
  if (!order) return;
  const ticketUrl = buildTicketUrl(order.order_number);
  const waLink = buildWaLink(order, "default");

  document.getElementById("modalQrTitle").textContent = `Tiquete Digital #${order.order_number}`;
  document.getElementById("modalQrCust").textContent = order.customer_name;
  document.getElementById("modalTicketLink").href = ticketUrl;

  // Generate QR pointing to the digital ticket (not wa.me)
  const qrTarget = document.getElementById("modalQrContainer");
  generateQR(qrTarget, ticketUrl, 220);

  document.getElementById("modalWaBtn").href = waLink;
  document.getElementById("qrModal").classList.add("show");
}

function closeQrModal() {
  document.getElementById("qrModal").classList.remove("show");
}

window.openQrModal = openQrModal;
window.closeQrModal = closeQrModal;
window.changeOrderStatus = changeOrderStatus;

// ─── Render Table ────────────────────────────────────────────────────

function render() {
  orders = orders.map(normalize);
  const q = document.getElementById("search").value.toLowerCase();
  const f = document.getElementById("statusFilter").value;
  const statusLabels = getStatusLabels();
  const visible = orders.filter(o => (!f || o.status === f) && (`${o.order_number} ${o.customer_name} ${o.items_text} ${o.custom_fields?.rack_location || ""}`.toLowerCase().includes(q)));

  // Mobile cards: delegate to renderOrderCards() defined in app.html
  if (typeof renderOrderCards === "function") renderOrderCards();

  // Build status select options HTML from config
  const statusOptionsHtml = (businessConfig.status_flow_config || []).map(entry =>
    `<option value="${entry.status_key}">\${o.status === '${entry.status_key}' ? 'selected' : ''}>${entry.display_label}</option>`
  ).join("") + `<option value="CANCELLED">\${o.status === 'CANCELLED' ? 'selected' : ''}>Cancelado</option>`;

  document.getElementById("ordersBody").innerHTML = visible.length ? visible.map(o => {
    // Build dynamic status options for this row
    const rowStatusOptions = (businessConfig.status_flow_config || []).map(entry =>
      `<option value="${entry.status_key}" ${o.status === entry.status_key ? 'selected' : ''}>${entry.display_label}</option>`
    ).join("") + `<option value="CANCELLED" ${o.status === 'CANCELLED' ? 'selected' : ''}>Cancelado</option>`;

    // Build custom fields display
    const customFieldsHtml = buildCustomFieldsDisplay(o);
    const confirmationHtml = buildConfirmationDisplay(o);
    const serviceType = o.custom_fields?.service_type;
    const serviceTypeHtml = serviceType ? `<br><small style="color:var(--blue); font-size:11px; font-weight:700;">🧺 ${serviceType}</small>` : "";

    return `
    <tr>
      <td>
        <strong>#${o.order_number}</strong>
        ${(() => {
          const loyaltyData = window._loyaltySummaries && window._loyaltySummaries[o.customer_phone];
          if (loyaltyData) {
            return `<br><span class="badge loyalty-badge" title="Fidelidad: ${loyaltyData.stamps_count} de ${loyaltyData.stamps_target} sellos">🎟️ ${loyaltyData.stamps_count}/${loyaltyData.stamps_target}</span>`;
          }
          return '';
        })()}
      </td>
      <td>${o.customer_name}<br><small>${o.customer_phone}</small></td>
      <td>
        ${o.items_text}
        ${serviceTypeHtml}
        ${customFieldsHtml}
        ${confirmationHtml}
      </td>
      <td>${money.format(o.balance)}</td>
      <td>
        <select style="border:1px solid var(--line); border-radius:6px; padding:4px 8px; font-size:12px; font-weight:700;" onchange="changeOrderStatus('${o.id}', this.value)">
          ${rowStatusOptions}
        </select>
      </td>
      <td>
        <div style="display:flex; gap:4px;">
          <button class="btn green" onclick="openQrModal('${o.order_number}')" title="Mostrar Código QR en Mostrador">📸 QR</button>
          <a class="btn light" href="${buildWaLink(o)}" target="_blank" rel="noopener" title="Enviar por WhatsApp">WhatsApp</a>
          <a class="btn light" href="/tiquete.html?number=${o.order_number}&slug=${BUSINESS_SLUG}" target="_blank" rel="noopener" title="Ver tiquete digital 🌐">🌐</a>
          ${(() => {
            const cf = o.custom_fields || {};
            const hasAddr = cf.direccion || cf.delivery_address || cf.address || cf.direccion_entrega;
            const isFinal = o.status === 'CANCELLED' || isDeliveredStatus(o.status);
            if (hasAddr && !isFinal) {
              return `<button class="btn light btn-delivery-link" data-order-id="${o.id}" onclick="DeliveryLinkModal.open('${o.id}')" type="button" title="Generar link de entrega">🚚 Link Entrega</button>`;
            }
            return '';
          })()}
        </div>
      </td>
    </tr>
  `}).join("") : `<tr><td colspan="6" class="empty">No hay pedidos con este filtro.</td></tr>`;

  // Update stats — use the first "ready-like" status from flow (typically 3rd step or status with "READY" in key)
  const readyStatusKey = findReadyStatus();
  const totalOrders = orders.length;
  const totalSales = orders.reduce((s, o) => s + o.total, 0);
  const totalBalance = orders.reduce((s, o) => s + o.balance, 0);
  const readyCount = orders.filter(o => o.status === readyStatusKey).length;

  // Use animated counters if available
  if (typeof AnimatedCounter !== 'undefined') {
    AnimatedCounter.animateCount(document.getElementById("statOrders"), totalOrders);
    AnimatedCounter.animateMoney(document.getElementById("statSales"), totalSales);
    AnimatedCounter.animateMoney(document.getElementById("statBalance"), totalBalance);
    AnimatedCounter.animateCount(document.getElementById("statReady"), readyCount);
  } else {
    document.getElementById("statOrders").textContent = totalOrders;
    document.getElementById("statSales").textContent = money.format(totalSales);
    document.getElementById("statBalance").textContent = money.format(totalBalance);
    document.getElementById("statReady").textContent = readyCount;
  }
}

/**
 * Finds the "ready" status from the status flow config.
 * Looks for a status containing "READY" or the second-to-last step.
 */
function findReadyStatus() {
  const flow = businessConfig.status_flow_config || [];
  // First try to find a status with "READY" in the key
  const readyEntry = flow.find(e => e.status_key.toUpperCase().includes("READY"));
  if (readyEntry) return readyEntry.status_key;
  // Fallback: use the second-to-last status (before final delivery/exit)
  if (flow.length >= 2) return flow[flow.length - 2].status_key;
  return "READY";
}

/**
 * Renders dynamic custom field inputs into a container based on field definitions.
 * Maps field_type to appropriate HTML input types:
 *   text → text input, number → number input, date → date picker,
 *   datetime → datetime-local picker, boolean → checkbox, select → select dropdown
 * Marks required fields visually with * and sets the HTML required attribute.
 * Requirements: 10.2, 5.1
 * @param {HTMLElement} container - DOM element to render inputs into
 * @param {Array} fieldDefinitions - Array of CustomFieldDef objects from businessConfig.custom_fields_config
 */
function renderCustomFieldInputs(container, fieldDefinitions) {
  if (!container) return;
  container.innerHTML = "";

  const definitions = fieldDefinitions || [];
  if (definitions.length === 0) return;

  // Group fields: booleans go in pairs on one row, others get full width or row pairs
  const booleanFields = definitions.filter(d => d.field_type === "boolean");
  const nonBooleanFields = definitions.filter(d => d.field_type !== "boolean");

  // Render non-boolean fields in pairs (rows of 2)
  for (let i = 0; i < nonBooleanFields.length; i += 2) {
    const row = document.createElement("div");
    row.className = "row";

    row.appendChild(createFieldInput(nonBooleanFields[i]));

    if (i + 1 < nonBooleanFields.length) {
      row.appendChild(createFieldInput(nonBooleanFields[i + 1]));
    }

    container.appendChild(row);
  }

  // Render boolean fields in a row
  if (booleanFields.length > 0) {
    const boolRow = document.createElement("div");
    boolRow.className = "row";
    boolRow.style.alignItems = "center";

    for (const def of booleanFields) {
      boolRow.appendChild(createFieldInput(def));
    }

    container.appendChild(boolRow);
  }
}

/**
 * Creates a label+input element for a single custom field definition.
 * @param {object} def - CustomFieldDef object
 * @returns {HTMLElement} label element wrapping the input
 */
function createFieldInput(def) {
  const label = document.createElement("label");
  const requiredMark = def.required ? " *" : "";

  if (def.field_type === "boolean") {
    // Checkbox: rendered inline with label
    label.style.flexDirection = "row";
    label.style.alignItems = "center";
    label.style.gap = "8px";
    label.style.marginTop = "12px";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = `custom_field_${def.field_key}`;
    input.dataset.fieldKey = def.field_key;
    input.dataset.fieldType = "boolean";
    input.style.width = "auto";
    if (def.default_value === true) input.checked = true;

    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${def.display_label}${requiredMark}`));
  } else if (def.field_type === "select") {
    // Select dropdown
    label.textContent = `${def.display_label}${requiredMark}`;

    const select = document.createElement("select");
    select.name = `custom_field_${def.field_key}`;
    select.dataset.fieldKey = def.field_key;
    select.dataset.fieldType = "select";
    if (def.required) select.required = true;

    // Add empty option
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = `Seleccionar ${def.display_label}...`;
    select.appendChild(emptyOpt);

    const options = def.options || [];
    for (const opt of options) {
      const optEl = document.createElement("option");
      optEl.value = opt;
      optEl.textContent = opt;
      if (def.default_value === opt) optEl.selected = true;
      select.appendChild(optEl);
    }

    label.appendChild(select);
  } else if (def.field_type === "textarea") {
    // Multi-line text (e.g. product lists)
    label.textContent = `${def.display_label}${requiredMark}`;

    const textarea = document.createElement("textarea");
    textarea.name = `custom_field_${def.field_key}`;
    textarea.dataset.fieldKey = def.field_key;
    textarea.dataset.fieldType = "textarea";
    textarea.placeholder = def.display_label;
    if (def.required) textarea.required = true;
    if (def.default_value != null && def.default_value !== "") {
      textarea.value = def.default_value;
    }

    label.appendChild(textarea);
  } else {
    // Text, number, date, datetime, time
    label.textContent = `${def.display_label}${requiredMark}`;

    const input = document.createElement("input");
    input.name = `custom_field_${def.field_key}`;
    input.dataset.fieldKey = def.field_key;
    input.dataset.fieldType = def.field_type;

    switch (def.field_type) {
      case "number":
        input.type = "number";
        input.step = "any";
        break;
      case "date":
        input.type = "date";
        break;
      case "datetime":
        input.type = "datetime-local";
        break;
      case "time":
        input.type = "time";
        break;
      default: // text
        input.type = "text";
        break;
    }

    if (def.required) input.required = true;
    if (def.default_value != null && def.default_value !== "") {
      input.value = def.default_value;
    }
    input.placeholder = def.display_label;

    label.appendChild(input);
  }

  return label;
}

/**
 * Collects custom field values from the rendered form inputs.
 * Returns an object mapping field_key → value (typed appropriately).
 * Requirements: 5.1
 * @returns {object} Key-value map of custom field data
 */
function collectCustomFieldValues() {
  const customFields = {};
  const definitions = businessConfig.custom_fields_config || [];
  const form = document.getElementById("orderForm");
  if (!form) return customFields;

  for (const def of definitions) {
    const inputName = `custom_field_${def.field_key}`;
    const element = form.querySelector(`[name="${inputName}"]`);
    if (!element) continue;

    switch (def.field_type) {
      case "boolean":
        customFields[def.field_key] = element.checked;
        break;
      case "number":
        customFields[def.field_key] = element.value !== "" ? Number(element.value) : null;
        break;
      case "date":
      case "datetime":
      case "time":
        customFields[def.field_key] = element.value || null;
        break;
      case "select":
      case "text":
      default:
        customFields[def.field_key] = element.value || null;
        break;
    }
  }

  return customFields;
}

/**
 * Builds HTML for displaying custom field values on order rows in the table.
 * Shows all custom fields with their labels from definitions.
 * Requirements: 10.5, 5.5
 */
function buildCustomFieldsDisplay(order) {
  const customFields = order.custom_fields || {};
  const definitions = businessConfig.custom_fields_config || [];
  const html = [];

  for (const def of definitions) {
    const value = customFields[def.field_key];
    if (value == null || value === "" || value === false) continue;

    let displayValue = value;
    if (def.field_type === "boolean") {
      displayValue = value ? "Sí" : "No";
    } else if (def.field_type === "datetime" && value) {
      try {
        displayValue = new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
      } catch { displayValue = value; }
    } else if (def.field_type === "date" && value) {
      try {
        displayValue = new Date(value).toLocaleDateString("es-CO");
      } catch { displayValue = value; }
    } else if (def.field_type === "textarea" && value) {
      displayValue = String(value).replace(/\r?\n/g, " · ");
    }

    html.push(`<br><small style="color:var(--muted); font-size:11px;"><strong>${def.display_label}:</strong> ${displayValue}</small>`);
  }
  return html.join("");
}

function buildConfirmationDisplay(order) {
  const html = [];
  if (order.intake_confirmed_at) {
    try {
      const dateStr = new Date(order.intake_confirmed_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
      html.push(`<br><small style="color:#059669; font-size:11px; font-weight:800;">✅ Recibido conforme: ${dateStr}</small>`);
    } catch { /* ignore */ }
  }
  if (order.delivery_confirmed_at) {
    try {
      const dateStr = new Date(order.delivery_confirmed_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
      html.push(`<br><small style="color:#1d4ed8; font-size:11px; font-weight:800;">✅ Entregado conforme: ${dateStr}</small>`);
    } catch { /* ignore */ }
  }
  return html.join("");
}

// ─── Dynamic Service Detail Fields ───────────────────────────────────

const serviceSelect = document.getElementById("serviceTypeSelect");
const serviceDetailBox = document.getElementById("serviceDetailBox");
const serviceDetailRow = document.getElementById("serviceDetailRow");
const itemsInput = document.getElementById("itemsInput");
const totalInput = document.getElementById("totalInput");

serviceSelect.addEventListener("change", () => {
  const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
  const unit = selectedOption?.dataset?.unit;
  const price = Number(selectedOption?.dataset?.price) || 0;

  renderServiceDetailFields(unit, price);
  updateServiceDescription();
});

/**
 * Renders dynamic input fields based on the service unit.
 * Supported units: per_kg, per_item, per_hour, flat_rate.
 */
function renderServiceDetailFields(unit, defaultPrice) {
  if (!serviceDetailBox || !serviceDetailRow) return;

  serviceDetailRow.innerHTML = "";

  if (!unit || unit === "flat_rate") {
    serviceDetailBox.style.display = "none";
    if (defaultPrice > 0 && totalInput) totalInput.value = defaultPrice;
    return;
  }

  serviceDetailBox.style.display = "grid";

  if (unit === "per_kg") {
    serviceDetailRow.innerHTML = `
      <label>Kilos (Kg)<input id="serviceQtyInput" name="serviceQty" type="number" step="0.1" value="10" placeholder="Ej: 15.5"></label>
      <label>Tarifa / Kg<input id="serviceUnitPriceInput" name="serviceUnitPrice" type="number" value="${defaultPrice || 4500}" placeholder="Ej: 4500"></label>
    `;
  } else if (unit === "per_item") {
    serviceDetailRow.innerHTML = `
      <label>Cantidad de prendas<input id="serviceQtyInput" name="serviceQty" type="number" min="1" value="1" placeholder="Ej: 3"></label>
      <label>Precio por prenda<input id="serviceUnitPriceInput" name="serviceUnitPrice" type="number" value="${defaultPrice || 8000}" placeholder="Ej: 8000"></label>
    `;
  } else if (unit === "per_hour") {
    serviceDetailRow.innerHTML = `
      <label>Horas<input id="serviceQtyInput" name="serviceQty" type="number" step="0.5" value="1" placeholder="Ej: 2.5"></label>
      <label>Tarifa / Hora<input id="serviceUnitPriceInput" name="serviceUnitPrice" type="number" value="${defaultPrice || 12000}" placeholder="Ej: 12000"></label>
    `;
  } else {
    serviceDetailBox.style.display = "none";
    return;
  }

  const qtyInput = document.getElementById("serviceQtyInput");
  const unitPriceInput = document.getElementById("serviceUnitPriceInput");

  if (qtyInput) qtyInput.addEventListener("input", recalcServiceTotal);
  if (unitPriceInput) unitPriceInput.addEventListener("input", recalcServiceTotal);

  recalcServiceTotal();
}

function recalcServiceTotal() {
  const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
  const unit = selectedOption?.dataset?.unit;
  const serviceName = selectedOption?.textContent || selectedOption?.value || "Servicio";
  const qtyInput = document.getElementById("serviceQtyInput");
  const unitPriceInput = document.getElementById("serviceUnitPriceInput");

  if (!qtyInput || !unitPriceInput || !unit) return;

  const qty = parseFloat(qtyInput.value) || 0;
  const unitPrice = parseFloat(unitPriceInput.value) || 0;
  const calcTotal = Math.round(qty * unitPrice);

  if (totalInput) totalInput.value = calcTotal;

  if (itemsInput) {
    if (unit === "per_kg") {
      itemsInput.value = `${serviceName}: ${qty} kg a ${money.format(unitPrice)}/kg`;
    } else if (unit === "per_item") {
      itemsInput.value = `${serviceName}: ${qty} prenda(s) a ${money.format(unitPrice)}/und`;
    } else if (unit === "per_hour") {
      itemsInput.value = `${serviceName}: ${qty} hr(s) a ${money.format(unitPrice)}/hr`;
    }
  }
}

// ─── API Calls ───────────────────────────────────────────────────────

async function sync() {
  try {
    const response = await authFetch(`/api/list-orders?slug=${BUSINESS_SLUG}&include_loyalty=1`);
    if (!response.ok) throw new Error("No se pudo conectar. Seguimos en modo demo.");
    const responseData = await response.json();
    // Handle wrapped response with loyalty_summaries or flat array (backward compat)
    if (responseData.orders && responseData.loyalty_summaries) {
      orders = responseData.orders.map(normalize);
      window._loyaltySummaries = responseData.loyalty_summaries;
    } else if (Array.isArray(responseData)) {
      orders = responseData.map(normalize);
      window._loyaltySummaries = {};
    } else {
      orders = (responseData.orders || responseData).map ? (responseData.orders || responseData).map(normalize) : [];
      window._loyaltySummaries = responseData.loyalty_summaries || {};
    }
    localStorage.setItem("tiquete_orders", JSON.stringify(orders));
    setDataStatus("Guardado en la nube");
    toast("Pedidos actualizados");
    render();
  } catch (error) {
    setDataStatus("Demo activa");
    toast(error.message);
    render();
  }
}

async function createOrder(payload) {
    const response = await authFetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "No se pudo guardar" }));
    throw new Error(error.error || "No se pudo guardar");
  }
  return response.json();
}

// ─── Event Listeners ─────────────────────────────────────────────────

document.getElementById("syncBtn").addEventListener("click", sync);
document.getElementById("search").addEventListener("input", render);
document.getElementById("statusFilter").addEventListener("change", render);

// Wire photo evidence inputs
wirePhotoInput({
  inputId: "intakePhotoInput",
  previewId: "intakePhotoPreview",
  imgId: "intakePhotoImg",
  removeId: "intakePhotoRemove",
  wrapId: "intakePhotoWrap",
  onChange: (dataUrl) => { currentIntakePhoto = dataUrl; }
});

wirePhotoInput({
  inputId: "deliveryPhotoInput",
  previewId: "deliveryPhotoPreview",
  imgId: "deliveryPhotoImg",
  removeId: "deliveryPhotoRemove",
  wrapId: "deliveryPhotoWrap",
  onChange: (dataUrl) => { currentDeliveryPhoto = dataUrl; }
});

document.getElementById("deliveryPhotoSkip").addEventListener("click", () => closeDeliveryPhotoModal(false));
document.getElementById("deliveryPhotoConfirm").addEventListener("click", () => closeDeliveryPhotoModal(true));

document.getElementById("copyMessage").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(lastMessage); toast("Mensaje copiado"); } catch { toast("No se pudo copiar"); }
});

document.getElementById("cashReportBtn").addEventListener("click", () => {
  const today = new Date().toLocaleDateString("es-CO");
  const businessName = businessConfig.business_name || "TiqueteVivo";
  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const totalPaidInCash = orders.reduce((sum, o) => sum + o.paid, 0);
  const totalPendingBalance = orders.reduce((sum, o) => sum + o.balance, 0);
  const readyStatusKey = findReadyStatus();
  const readyOrdersCount = orders.filter(o => o.status === readyStatusKey).length;

  const reportText = [
    `📊 *CIERRE DE CAJA DIARIA — ${businessName}*`,
    `📅 Fecha: ${today}`,
    `----------------------------------------`,
    `📥 Total pedidos creados: ${totalOrders}`,
    `💰 Ventas totales: ${money.format(totalSales)}`,
    `💵 Ingresado a Caja (Abonos): ${money.format(totalPaidInCash)}`,
    `💸 Saldos por cobrar: ${money.format(totalPendingBalance)}`,
    `✅ Pedidos listos para entregar: ${readyOrdersCount}`,
    `----------------------------------------`,
    `🌱 *Operación 100% Digital y Cero Papel*`
  ].join("\n");

  const waLink = `https://wa.me/?text=${encodeURIComponent(reportText)}`;
  window.open(waLink, "_blank", "noopener");
  toast("Reporte de Cierre de Caja generado para WhatsApp");
});

// ─── Order Form Submit ───────────────────────────────────────────────

document.getElementById("orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("createBtn");
  button.disabled = true;
  button.textContent = "Creando Tiquete Digital...";
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.slug = BUSINESS_SLUG;
  body.total = Number(body.total);
  body.paid = Number(body.paid);

  // Generate orderNumber on the frontend and send it to ensure consistency
  body.orderNumber = String(Date.now()).slice(-6);

  // Collect custom field values into a custom_fields object
  body.custom_fields = collectCustomFieldValues();

  // Store selected service type in custom_fields for reporting/display
  const serviceSelectEl = document.getElementById("serviceTypeSelect");
  if (serviceSelectEl && serviceSelectEl.value) {
    body.custom_fields.service_type = serviceSelectEl.value;
  }

  // Remove individual custom_field_* keys from body (they came from FormData)
  for (const key of Object.keys(body)) {
    if (key.startsWith("custom_field_")) {
      delete body[key];
    }
  }

  // Remove service detail helper fields (only used for frontend calculation)
  delete body.serviceQty;
  delete body.serviceUnitPrice;

  // Attach compressed intake photo evidence if available
  if (currentIntakePhoto) {
    body.intakePhoto = currentIntakePhoto;
  }
  delete body.intakePhotoInput;

  let order;
  let storedInCloud = false;
  try {
    order = await createOrder(body);
    storedInCloud = true;
    setDataStatus("Guardado en la nube");
  } catch (error) {
    const firstStatus = businessConfig.status_flow_config[0]?.status_key || "RECEIVED";
    order = { ...body, id: "demo-" + Date.now(), order_number: body.orderNumber, balance: Math.max(0, body.total - body.paid), status: firstStatus };
    setDataStatus("Demo activa");
    toast("Pedido guardado localmente. Revisa Supabase si querias guardarlo en la nube.");
  }

  orders.unshift(normalize(order));
  localStorage.setItem("tiquete_orders", JSON.stringify(orders));
  render();

  // Celebrate first order of the day with confetti
  if (typeof Confetti !== 'undefined') {
    Confetti.celebrateFirstOrder(orders.length);
  }

  const templateSelected = body.templateName || "default";
  const normalizedOrder = normalize(order);
  const waLink = buildWaLink(order, templateSelected);
  const liveTicketUrl = buildTicketUrl(normalizedOrder.order_number);
  lastMessage = buildWhatsAppMessage(order, templateSelected);

  document.getElementById("receiptTitle").textContent = `Tiquete Digital #${normalizedOrder.order_number} Creado 🌱`;
  document.getElementById("receiptText").textContent = "El cliente escanea este QR para ver su recibo digital en tiempo real 📸";
  document.getElementById("receiptWa").href = waLink;
  document.getElementById("receiptLive").href = liveTicketUrl;

  // Generate QR locally pointing to the digital ticket URL
  const qrContainer = document.getElementById("qrContainer");
  qrContainer.innerHTML = "";
  generateQR(qrContainer, liveTicketUrl, 160);
  // Add scan label below QR
  const scanLabel = document.createElement("div");
  scanLabel.style.cssText = "font-size:11px; font-weight:800; color:#15803d; margin-top:6px; text-align:center;";
  scanLabel.textContent = "📸 Escanear con la Cámara → Ver Recibo Digital";
  qrContainer.appendChild(scanLabel);

  document.getElementById("receiptBox").classList.add("show");

  // Reset intake photo for next ticket
  currentIntakePhoto = null;
  const intakeInput = document.getElementById("intakePhotoInput");
  const intakePreview = document.getElementById("intakePhotoPreview");
  const intakeImg = document.getElementById("intakePhotoImg");
  const intakeWrap = document.getElementById("intakePhotoWrap");
  if (intakeInput) intakeInput.value = "";
  if (intakeImg) intakeImg.src = "";
  if (intakePreview) intakePreview.classList.remove("show");
  if (intakeWrap) intakeWrap.classList.remove("has-photo");

  button.disabled = false;
  button.textContent = "✅ Crear Tiquete y Abrir WhatsApp";
  // Scroll receipt into view (works both in drawer and desktop panel)
  document.getElementById("receiptBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
  sync();
});

// ─── Init ────────────────────────────────────────────────────────────

/**
 * Fetches all businesses and populates the business selector dropdown.
 * Highlights the currently active business.
 */
async function loadBusinessSelector() {
  const selector = document.getElementById("businessSelector");
  if (!selector) return;

  // In single-business mode we still need the business name for display,
  // but we don't show the selector to switch businesses.
  try {
    const res = await authFetch(`/api/get-business-config?slug=${BUSINESS_SLUG}`);
    if (!res.ok) throw new Error("Could not load business config");
    const config = await res.json();

    selector.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = BUSINESS_SLUG;
    opt.textContent = config.business_name || BUSINESS_SLUG;
    opt.selected = true;
    selector.appendChild(opt);

    if (HAS_SLUG_PARAM) {
      // Single-business mode: no need to allow switching
      selector.disabled = true;
      return;
    }

    // Multi-business mode (superadmin): load full list and allow switching
    const listRes = await authFetch("/api/list-businesses");
    if (!listRes.ok) throw new Error("Could not load businesses");
    const businesses = await listRes.json();

    selector.innerHTML = "";
    if (businesses.length === 0) {
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "No hay negocios registrados";
      selector.appendChild(emptyOpt);
      return;
    }

    for (const biz of businesses) {
      const bizOpt = document.createElement("option");
      bizOpt.value = biz.slug;
      bizOpt.textContent = `${biz.vertical_emoji || ""} ${biz.name}`;
      if (biz.slug === BUSINESS_SLUG) bizOpt.selected = true;
      selector.appendChild(bizOpt);
    }

    selector.addEventListener("change", () => {
      const newSlug = selector.value;
      if (newSlug && newSlug !== BUSINESS_SLUG) {
        window.location.href = `/app.html?slug=${newSlug}`;
      }
    });
  } catch (err) {
    console.warn("Could not load business selector:", err.message);
    selector.innerHTML = `<option value="${BUSINESS_SLUG}">${BUSINESS_SLUG}</option>`;
  }
}

/**
 * Application initialization.
 * Loads business selector, fetches business config, then syncs orders.
 * Requirements: 10.1
 */
async function init() {
  // Initialize authentication UI first
  initAuth();

  // If not authenticated, wait for login; data loading happens after login
  if (!isLoggedIn()) {
    return;
  }

  // Show skeleton loaders while data loads
  if (typeof SkeletonLoader !== 'undefined') {
    SkeletonLoader.showTableSkeleton(document.getElementById('ordersBody'), 5, 6);
    SkeletonLoader.showStatsSkeleton(['statOrders', 'statSales', 'statBalance', 'statReady']);
  }

  await loadBusinessSelector();
  await fetchBusinessConfig();

  // Apply vertical theming based on business config
  if (typeof VerticalTheming !== 'undefined' && businessConfig.vertical_name) {
    // Try to match vertical name to slug
    const verticalSlug = guessVerticalSlug(businessConfig.vertical_name);
    if (verticalSlug) VerticalTheming.applyTheme(verticalSlug);
  }

  await sync();

  // Start onboarding tour for first-time users (after data loads)
  if (typeof Onboarding !== 'undefined') {
    setTimeout(function() { Onboarding.start(); }, 1500);
  }

  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
}

// ─── Delivery Link Modal ─────────────────────────────────────────────

/**
 * DeliveryLinkModal — generates a delivery token via the backend and provides
 * copy/WhatsApp sharing options for sending the link to delivery personnel.
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
const DeliveryLinkModal = (() => {
  let currentOrderId = null;
  let currentDeliveryUrl = null;
  let currentOrder = null;

  /**
   * Opens the delivery link modal for a given order.
   * Populates the order summary and resets the form state.
   */
  function open(orderId) {
    currentOrderId = orderId;
    currentDeliveryUrl = null;

    // Find order in local data
    currentOrder = orders.find(o => o.id === orderId);
    if (!currentOrder) {
      toast("Pedido no encontrado");
      return;
    }

    // Populate order summary
    const cf = currentOrder.custom_fields || {};
    const address = cf.direccion || cf.delivery_address || cf.address || cf.direccion_entrega || "No disponible";
    const balance = currentOrder.balance || Math.max(0, currentOrder.total - currentOrder.paid);

    document.getElementById("dlCustomerName").textContent = currentOrder.customer_name || "—";
    document.getElementById("dlAddress").textContent = address;
    document.getElementById("dlBalance").textContent = money.format(balance);

    // Reset form state
    document.getElementById("dlDeliveryPhone").value = "";
    document.getElementById("dlResultSection").style.display = "none";
    document.getElementById("dlGenerateBtn").disabled = false;
    document.getElementById("dlGenerateBtn").textContent = "🔗 Generar Link";
    document.getElementById("dlWhatsAppBtn").disabled = true;

    // Show modal
    document.getElementById("deliveryLinkModal").classList.add("show");

    // Wire phone input to enable/disable WhatsApp button
    const phoneInput = document.getElementById("dlDeliveryPhone");
    phoneInput.oninput = function () {
      const hasPhone = digitsOnly(phoneInput.value).length >= 7;
      document.getElementById("dlWhatsAppBtn").disabled = !hasPhone || !currentDeliveryUrl;
    };
  }

  /**
   * Closes the delivery link modal.
   */
  function close() {
    document.getElementById("deliveryLinkModal").classList.remove("show");
    currentOrderId = null;
    currentDeliveryUrl = null;
    currentOrder = null;
  }

  /**
   * Calls POST /api/delivery-confirm with action "generate-token" to create
   * a delivery token and display the URL.
   */
  async function generate() {
    if (!currentOrderId || !businessConfig.business_id) {
      toast("Error: datos insuficientes");
      return;
    }

    const btn = document.getElementById("dlGenerateBtn");
    btn.disabled = true;
    btn.textContent = "⏳ Generando...";

    try {
      const res = await authFetch("/api/delivery-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-token",
          order_id: currentOrderId,
          business_id: businessConfig.business_id
        })
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || errorBody.error || "Error al generar link");
      }

      const data = await res.json();
      currentDeliveryUrl = data.delivery_url;

      // Display the generated URL
      document.getElementById("dlGeneratedUrl").textContent = currentDeliveryUrl;
      document.getElementById("dlResultSection").style.display = "block";

      // Enable WhatsApp button if phone is filled
      const phoneInput = document.getElementById("dlDeliveryPhone");
      const hasPhone = digitsOnly(phoneInput.value).length >= 7;
      document.getElementById("dlWhatsAppBtn").disabled = !hasPhone;

      btn.textContent = "✅ Link generado";
      toast("Link de entrega generado");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "🔗 Generar Link";
      toast(err.message || "Error al generar link");
    }
  }

  /**
   * Copies the generated delivery URL to the clipboard.
   */
  async function copyLink() {
    if (!currentDeliveryUrl) return;

    try {
      await navigator.clipboard.writeText(currentDeliveryUrl);
      toast("Link copiado al portapapeles");
      const copyBtn = document.getElementById("dlCopyBtn");
      copyBtn.textContent = "✅ Copiado";
      setTimeout(() => { copyBtn.textContent = "📋 Copiar"; }, 2000);
    } catch (err) {
      // Fallback: select + copy for older browsers
      const urlEl = document.getElementById("dlGeneratedUrl");
      const range = document.createRange();
      range.selectNodeContents(urlEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand("copy");
        toast("Link copiado");
      } catch (e) {
        toast("No se pudo copiar. Selecciona y copia manualmente.");
      }
      selection.removeAllRanges();
    }
  }

  /**
   * Opens wa.me with a pre-filled message containing customer name, address,
   * amount to collect, the delivery URL, and expiry notice.
   * Requirements: 10.2, 10.4
   */
  function sendWhatsApp() {
    if (!currentDeliveryUrl || !currentOrder) return;

    const phoneInput = document.getElementById("dlDeliveryPhone");
    const phone = digitsOnly(phoneInput.value);
    if (phone.length < 7) {
      toast("Ingresa el teléfono del domiciliario");
      return;
    }

    const cf = currentOrder.custom_fields || {};
    const customerName = currentOrder.customer_name || "Cliente";
    const address = cf.direccion || cf.delivery_address || cf.address || cf.direccion_entrega || "No disponible";
    const balance = currentOrder.balance || Math.max(0, currentOrder.total - currentOrder.paid);

    // Build WhatsApp message (Req 10.2)
    const message = [
      `🚚 *Entrega Pendiente*`,
      ``,
      `👤 *Cliente:* ${customerName}`,
      `📍 *Dirección:* ${address}`,
      `💰 *Cobrar:* ${money.format(balance)}`,
      ``,
      `🔗 *Link de confirmación:*`,
      currentDeliveryUrl,
      ``,
      `⏰ Este link expira en 2 horas.`
    ].join("\n");

    // Open wa.me in new tab (Req 10.4)
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener");
  }

  return { open, close, generate, copyLink, sendWhatsApp };
})();

// Expose globally for onclick handlers in HTML
window.DeliveryLinkModal = DeliveryLinkModal;

/**
 * Guess vertical slug from vertical name for theming.
 */
function guessVerticalSlug(verticalName) {
  if (!verticalName) return null;
  const map = {
    'lavandería': 'laundry', 'lavanderia': 'laundry',
    'parqueadero': 'parking',
    'calzado': 'shoe-repair', 'reparación de calzado': 'shoe-repair',
    'mecánica': 'mechanic', 'taller mecánico': 'mechanic',
    'pastelería': 'bakery', 'pasteleria': 'bakery',
    'sastrería': 'tailor', 'sastreria': 'tailor',
    'mascotas': 'pet-daycare', 'guardería de mascotas': 'pet-daycare',
    'mensajería': 'courier', 'mensajeria': 'courier',
    'impresión': 'print-center', 'centro de impresión': 'print-center',
    'belleza': 'salon', 'salón de belleza': 'salon',
    'casilleros': 'gym-locker',
    'vivero': 'nursery'
  };
  const lower = verticalName.toLowerCase();
  return map[lower] || null;
}

init();
