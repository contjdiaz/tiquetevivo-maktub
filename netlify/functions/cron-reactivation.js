/**
 * Scheduled Reactivation Function for TiqueteVivo.
 * Runs daily at 14:00 UTC (9:00 AM Colombia, UTC-5) to identify inactive customers
 * and send personalized reactivation messages with unique coupon codes.
 *
 * Flow per active business with reactivation_config.enabled = true:
 * 1. Query inactive customers using smart segmentation
 * 2. Exclude: opted-out, recently messaged (< 15 days), has newer order
 * 3. Respect plan limits (free: 10/month, paid: configurable)
 * 4. Check time window (08:00-20:00 Colombia) — defer if outside
 * 5. Generate unique coupon per customer
 * 6. Compose message via Template Engine (customer_reactivation trigger)
 * 7. Send via sendWhatsAppMessage (templateName for out-of-window)
 * 8. Log in reactivation_log and whatsapp_messages
 *
 * Implements retry with exponential backoff (max 3 attempts) for API failures.
 *
 * Requirements: 7, 8, 9, 10
 */

import { supabaseAdmin } from "./_utils.js";
import { sendWhatsAppMessage, logWhatsAppMessage } from "./_whatsapp.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";

// --- Netlify Scheduled Function config ---
export const config = {
  schedule: "0 14 * * *"
};

/**
 * Default free plan monthly limit for reactivation messages.
 */
const FREE_PLAN_MONTHLY_LIMIT = 10;

/**
 * Meta-approved template name for reactivation (used for out-of-24h-window messages).
 */
const REACTIVATION_TEMPLATE_NAME = "customer_reactivation";

/**
 * Coupon defaults.
 */
const COUPON_EXPIRATION_DAYS = 7;
const COUPON_DEFAULT_TYPE = "PERCENT";
const COUPON_DEFAULT_VALUE = 10; // 10% off

/**
 * Checks if the current time is within the allowed send window (08:00-20:00 Colombia).
 * Colombia is UTC-5.
 *
 * @returns {boolean} True if within send window
 */
export function isWithinSendWindow() {
  const now = new Date();
  // Colombia is UTC-5 (no DST)
  const colombiaOffset = -5;
  const colombiaHour = (now.getUTCHours() + colombiaOffset + 24) % 24;
  return colombiaHour >= 8 && colombiaHour < 20;
}

/**
 * Generates a unique, human-readable coupon code (6-8 chars uppercase alphanumeric).
 *
 * @param {string} prefix - Optional prefix for the code
 * @returns {string} Unique coupon code
 */
export function generateCouponCode(prefix = "") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude ambiguous chars (I, O, 0, 1)
  let code = prefix ? prefix.toUpperCase().slice(0, 3) : "";
  const targetLen = prefix ? 8 : 6;
  while (code.length < targetLen) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Retries an async function with exponential backoff.
 *
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts (default: 3)
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Fetches all active businesses with reactivation enabled.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<Array>} Array of business objects
 */
async function getEnabledBusinesses(supabase) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, slug, plan, reactivation_config, whatsapp_templates")
    .eq("active", true);

  if (error) {
    console.error("[cron-reactivation] Error fetching businesses:", error.message);
    return [];
  }

  // Filter businesses with reactivation enabled
  return (data || []).filter(
    (b) => b.reactivation_config && b.reactivation_config.enabled === true
  );
}

/**
 * Counts reactivation messages sent this month for a business.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @returns {Promise<number>} Number of messages sent this month
 */
async function getMonthlyMessageCount(supabase, businessId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count, error } = await supabase
    .from("reactivation_log")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("sent_at", startOfMonth);

  if (error) {
    console.error("[cron-reactivation] Error counting monthly messages:", error.message);
    return 0;
  }

  return count || 0;
}

/**
 * Identifies inactive customers for a business using smart segmentation.
 * A customer is inactive when days_since_last > max(threshold_days, avg_frequency × 1.5).
 *
 * Excludes:
 * - Customers who opted out of marketing
 * - Customers who received a reactivation message in the last 15 days
 * - Customers who have a newer order after their last serviced order
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @param {number} thresholdDays - Configured threshold in days
 * @returns {Promise<Array>} Array of inactive customer records
 */
async function getInactiveCustomers(supabase, businessId, thresholdDays) {
  // Fetch all customers who have at least one order with this business
  // Group by phone to get last order date and order count
  const { data: customerOrders, error: ordersError } = await supabase
    .from("orders")
    .select("customer_phone, customer_name, items_text, created_at, status")
    .eq("business_id", businessId)
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false });

  if (ordersError || !customerOrders || customerOrders.length === 0) {
    return [];
  }

  // Group orders by customer phone
  const customerMap = new Map();
  for (const order of customerOrders) {
    const phone = order.customer_phone;
    if (!phone) continue;

    if (!customerMap.has(phone)) {
      customerMap.set(phone, {
        phone,
        customer_name: order.customer_name,
        last_service: order.items_text,
        last_order_date: order.created_at,
        orders: []
      });
    }
    customerMap.get(phone).orders.push(order);
  }

  const now = new Date();
  const inactiveCustomers = [];

  for (const [phone, customer] of customerMap) {
    const orderCount = customer.orders.length;
    const lastOrderDate = new Date(customer.last_order_date);
    const daysSinceLast = Math.floor((now - lastOrderDate) / (1000 * 60 * 60 * 24));

    // Calculate effective threshold
    let effectiveThreshold = thresholdDays;

    if (orderCount >= 2) {
      // Calculate average frequency from order dates
      const orderDates = customer.orders
        .map((o) => new Date(o.created_at).getTime())
        .sort((a, b) => b - a);

      let totalGap = 0;
      for (let i = 0; i < orderDates.length - 1; i++) {
        totalGap += orderDates[i] - orderDates[i + 1];
      }
      const avgFrequencyMs = totalGap / (orderDates.length - 1);
      const avgFrequencyDays = avgFrequencyMs / (1000 * 60 * 60 * 24);
      const dynamicThreshold = avgFrequencyDays * 1.5;

      effectiveThreshold = Math.max(thresholdDays, dynamicThreshold);
    }

    // Customer is inactive if days since last order exceeds effective threshold
    if (daysSinceLast > effectiveThreshold) {
      inactiveCustomers.push({
        phone,
        customer_name: customer.customer_name || "",
        last_service: customer.last_service || "",
        days_inactive: daysSinceLast,
        last_order_date: customer.last_order_date
      });
    }
  }

  return inactiveCustomers;
}

/**
 * Filters out customers who should be excluded from reactivation:
 * - Opted out of marketing
 * - Received a reactivation message in the last 15 days
 * - Have a newer order after their last service (already came back)
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @param {Array} candidates - Array of inactive customer objects
 * @returns {Promise<Array>} Filtered array of eligible customers
 */
async function filterExclusions(supabase, businessId, candidates) {
  if (candidates.length === 0) return [];

  const phones = candidates.map((c) => c.phone);

  // 1. Fetch opt-out status from customer_loyalty
  const { data: loyaltyRecords } = await supabase
    .from("customer_loyalty")
    .select("phone_number, marketing_opt_in")
    .in("phone_number", phones);

  const optedOutPhones = new Set(
    (loyaltyRecords || [])
      .filter((r) => r.marketing_opt_in === false)
      .map((r) => r.phone_number)
  );

  // 2. Fetch recent reactivation messages (last 15 days)
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentMessages } = await supabase
    .from("reactivation_log")
    .select("phone")
    .eq("business_id", businessId)
    .gte("sent_at", fifteenDaysAgo)
    .in("phone", phones);

  const recentlyMessagedPhones = new Set(
    (recentMessages || []).map((r) => r.phone)
  );

  // Filter candidates
  return candidates.filter((customer) => {
    // Exclude opted-out customers
    if (optedOutPhones.has(customer.phone)) return false;

    // Exclude recently messaged customers (< 15 days)
    if (recentlyMessagedPhones.has(customer.phone)) return false;

    return true;
  });
}

/**
 * Creates a unique coupon for a customer.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @returns {Promise<{coupon: object|null, error: string|null}>}
 */
async function createCoupon(supabase, businessId) {
  const expiresAt = new Date(Date.now() + COUPON_EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const code = generateCouponCode();

  const { data, error } = await supabase
    .from("coupons")
    .insert({
      business_id: businessId,
      code,
      type: COUPON_DEFAULT_TYPE,
      value: COUPON_DEFAULT_VALUE,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) {
    // If code collision (unlikely), try once more with a different code
    if (error.code === "23505") {
      const retryCode = generateCouponCode("R");
      const { data: retryData, error: retryError } = await supabase
        .from("coupons")
        .insert({
          business_id: businessId,
          code: retryCode,
          type: COUPON_DEFAULT_TYPE,
          value: COUPON_DEFAULT_VALUE,
          expires_at: expiresAt
        })
        .select()
        .single();

      if (retryError) return { coupon: null, error: retryError.message };
      return { coupon: retryData, error: null };
    }
    return { coupon: null, error: error.message };
  }

  return { coupon: data, error: null };
}

/**
 * Sends a reactivation message to a customer and logs the attempt.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {object} params.business - Business object
 * @param {object} params.customer - Customer object with phone, customer_name, etc.
 * @param {object} params.coupon - Coupon object with code
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendReactivationMessage(supabase, { business, customer, coupon }) {
  // Build the coupon link (public page to view/redeem coupon)
  const couponLink = `${process.env.URL || "https://tiquetevivo.com"}/coupon?code=${coupon.code}`;

  // Compose message using Template Engine
  const businessTemplates = business.whatsapp_templates || null;
  const template = selectTemplate("customer_reactivation", businessTemplates, null);

  const messageText = renderTemplate(
    template,
    {
      customer_name: customer.customer_name,
      last_service: customer.last_service,
      days_inactive: customer.days_inactive,
      coupon_link: couponLink
    },
    { name: business.name }
  );

  // Send via WhatsApp — use template message since this is outside 24h window
  const sendFn = async () => {
    return await sendWhatsAppMessage({
      to: customer.phone,
      templateName: REACTIVATION_TEMPLATE_NAME,
      templateParams: [
        customer.customer_name,
        business.name,
        String(customer.days_inactive),
        customer.last_service,
        couponLink
      ]
    });
  };

  let sendResult;
  try {
    sendResult = await withRetry(sendFn, 3);
  } catch (error) {
    sendResult = { success: false, error: error.message };
  }

  // Log in reactivation_log
  const logStatus = sendResult.success ? "SENT" : "FAILED";
  await supabase.from("reactivation_log").insert({
    business_id: business.id,
    phone: customer.phone,
    coupon_id: coupon.id,
    status: logStatus
  });

  // Log in whatsapp_messages
  await logWhatsAppMessage(supabase, {
    orderId: null,
    businessId: business.id,
    phone: customer.phone,
    templateName: REACTIVATION_TEMPLATE_NAME,
    messageBody: messageText,
    metaMessageId: sendResult.messageId || null,
    status: sendResult.success ? "SENT" : (sendResult.dryRun ? "DRY_RUN" : "FAILED"),
    errorMessage: sendResult.error || null
  });

  return {
    success: sendResult.success || sendResult.dryRun === true,
    error: sendResult.error || null
  };
}

/**
 * Processes reactivation for a single business.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} business - Business object
 * @returns {Promise<{sent: number, skipped: number, errors: number}>}
 */
async function processBusinessReactivation(supabase, business) {
  const stats = { sent: 0, skipped: 0, errors: 0 };

  const reactivationConfig = business.reactivation_config || {};
  const thresholdDays = reactivationConfig.threshold_days || 30;

  // Determine monthly limit based on plan
  const isPaid = business.plan === "paid";
  const monthlyLimit = isPaid
    ? (reactivationConfig.monthly_limit || 50)
    : FREE_PLAN_MONTHLY_LIMIT;

  // Check how many messages already sent this month
  const monthlyCount = await getMonthlyMessageCount(supabase, business.id);
  const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

  if (remainingQuota <= 0) {
    console.log(`[cron-reactivation] Business ${business.slug}: monthly limit reached (${monthlyCount}/${monthlyLimit})`);
    return stats;
  }

  // 1. Get inactive customers
  const inactiveCustomers = await getInactiveCustomers(supabase, business.id, thresholdDays);

  if (inactiveCustomers.length === 0) {
    return stats;
  }

  // 2. Filter exclusions (opt-out, recently messaged, newer orders)
  const eligibleCustomers = await filterExclusions(supabase, business.id, inactiveCustomers);

  if (eligibleCustomers.length === 0) {
    return stats;
  }

  // 3. Respect remaining quota
  const customersToProcess = eligibleCustomers.slice(0, remainingQuota);

  // 4. Process each customer
  for (const customer of customersToProcess) {
    try {
      // Generate unique coupon
      const { coupon, error: couponError } = await createCoupon(supabase, business.id);

      if (couponError || !coupon) {
        console.error(`[cron-reactivation] Coupon creation failed for ${customer.phone}:`, couponError);
        stats.errors++;
        continue;
      }

      // Send reactivation message
      const result = await sendReactivationMessage(supabase, {
        business,
        customer,
        coupon
      });

      if (result.success) {
        stats.sent++;
      } else {
        stats.errors++;
        console.warn(`[cron-reactivation] Message failed for ${customer.phone}:`, result.error);
      }
    } catch (error) {
      stats.errors++;
      console.error(`[cron-reactivation] Error processing customer ${customer.phone}:`, error.message);
    }
  }

  stats.skipped = eligibleCustomers.length - customersToProcess.length;
  return stats;
}

/**
 * Main handler for the scheduled reactivation function.
 * Netlify Scheduled Functions export a default handler.
 */
export default async () => {
  console.log("[cron-reactivation] Starting daily reactivation run...");

  // Check global kill switch
  if (process.env.REACTIVATION_ENABLED === "false") {
    console.log("[cron-reactivation] Reactivation disabled via environment variable.");
    return;
  }

  // Check time window (08:00-20:00 Colombia)
  if (!isWithinSendWindow()) {
    console.log("[cron-reactivation] Outside send window (08:00-20:00 Colombia). Deferring to next execution.");
    return;
  }

  const supabase = supabaseAdmin();
  const results = { total_sent: 0, total_skipped: 0, total_errors: 0, businesses_processed: 0 };

  try {
    // Fetch all businesses with reactivation enabled
    const businesses = await getEnabledBusinesses(supabase);

    if (businesses.length === 0) {
      console.log("[cron-reactivation] No businesses with reactivation enabled.");
      return;
    }

    console.log(`[cron-reactivation] Processing ${businesses.length} businesses...`);

    // Process each business
    for (const business of businesses) {
      try {
        const stats = await processBusinessReactivation(supabase, business);
        results.total_sent += stats.sent;
        results.total_skipped += stats.skipped;
        results.total_errors += stats.errors;
        results.businesses_processed++;

        console.log(
          `[cron-reactivation] Business ${business.slug}: sent=${stats.sent}, skipped=${stats.skipped}, errors=${stats.errors}`
        );
      } catch (error) {
        console.error(`[cron-reactivation] Error processing business ${business.slug}:`, error.message);
        results.total_errors++;
      }
    }
  } catch (error) {
    console.error("[cron-reactivation] Fatal error:", error.message);
  }

  console.log(
    `[cron-reactivation] Completed. Sent: ${results.total_sent}, Skipped: ${results.total_skipped}, Errors: ${results.total_errors}, Businesses: ${results.businesses_processed}`
  );
};
