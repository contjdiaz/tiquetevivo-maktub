/**
 * Shared Loyalty Module for TiqueteVivo.
 * Handles loyalty stamp accumulation, reversion, reward redemption, and summary retrieval.
 *
 * Requirements: 1 (Stamp Visualization), 2 (Automatic Stamp Accumulation),
 *               3 (Reward Redemption), 11 (Loyalty Configuration Management)
 */

import { validatePhone } from "./_validators.js";

/**
 * Finds or creates a customer_loyalty profile by normalized phone number.
 * Uses upsert to handle race conditions gracefully.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} phone - Raw phone number (will be normalized)
 * @returns {Promise<{ success: boolean, profile?: object, error?: string }>}
 */
export async function getOrCreateLoyaltyProfile(supabase, phone) {
  const phoneResult = validatePhone(phone);
  if (!phoneResult.valid) {
    return { success: false, error: phoneResult.error };
  }

  const normalizedPhone = phoneResult.value;

  // Try to fetch existing profile first
  const { data: existing, error: fetchError } = await supabase
    .from("customer_loyalty")
    .select("*")
    .eq("phone_number", normalizedPhone)
    .single();

  if (existing) {
    return { success: true, profile: existing };
  }

  // If not found (PGRST116 = no rows), create a new one
  if (fetchError && fetchError.code !== "PGRST116") {
    return { success: false, error: fetchError.message };
  }

  const { data: created, error: insertError } = await supabase
    .from("customer_loyalty")
    .insert({ phone_number: normalizedPhone })
    .select()
    .single();

  if (insertError) {
    // Handle race condition: another process may have inserted it
    if (insertError.code === "23505") {
      // Unique constraint violation — fetch the existing row
      const { data: raced, error: racedError } = await supabase
        .from("customer_loyalty")
        .select("*")
        .eq("phone_number", normalizedPhone)
        .single();

      if (racedError) {
        return { success: false, error: racedError.message };
      }
      return { success: true, profile: raced };
    }
    return { success: false, error: insertError.message };
  }

  return { success: true, profile: created };
}

/**
 * Adds a STAMP event for an order. Idempotent: catches unique constraint violation
 * (loyalty_events_one_stamp_per_order) to prevent double stamps on the same order.
 *
 * After stamping, checks if the stamp target is reached to increment available_rewards.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} loyaltyId - UUID of the customer_loyalty record
 * @param {string} orderId - UUID of the order generating the stamp
 * @param {string} businessId - UUID of the business (used to check target)
 * @returns {Promise<{ success: boolean, stamps_count?: number, reward_unlocked?: boolean, already_stamped?: boolean, error?: string }>}
 */
export async function addStamp(supabase, loyaltyId, orderId, businessId) {
  // Insert STAMP event (unique partial index enforces idempotency)
  const { error: insertError } = await supabase
    .from("loyalty_events")
    .insert({
      loyalty_id: loyaltyId,
      order_id: orderId,
      event_type: "STAMP"
    });

  if (insertError) {
    // Unique constraint violation means this order already has a stamp
    if (insertError.code === "23505") {
      return { success: true, already_stamped: true };
    }
    return { success: false, error: insertError.message };
  }

  // Fetch current profile to increment stamps
  const { data: profile, error: fetchError } = await supabase
    .from("customer_loyalty")
    .select("total_stamps, available_rewards")
    .eq("id", loyaltyId)
    .single();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  const newStamps = profile.total_stamps + 1;

  // Fetch business loyalty target
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("loyalty_config")
    .eq("id", businessId)
    .single();

  if (bizError) {
    return { success: false, error: bizError.message };
  }

  const target = business.loyalty_config?.target || 5;
  const rewardUnlocked = newStamps >= target && newStamps % target === 0;

  const updatePayload = {
    total_stamps: newStamps,
    last_stamp_at: new Date().toISOString()
  };

  if (rewardUnlocked) {
    updatePayload.available_rewards = profile.available_rewards + 1;
  }

  const { error: saveError } = await supabase
    .from("customer_loyalty")
    .update(updatePayload)
    .eq("id", loyaltyId);

  if (saveError) {
    return { success: false, error: saveError.message };
  }

  return {
    success: true,
    stamps_count: newStamps,
    reward_unlocked: rewardUnlocked,
    already_stamped: false
  };
}

/**
 * Reverts a stamp for a given order. Only reverts if a STAMP event exists for this order.
 * Inserts a REVERT event and decrements total_stamps (floor at 0).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} loyaltyId - UUID of the customer_loyalty record
 * @param {string} orderId - UUID of the order whose stamp should be reverted
 * @returns {Promise<{ success: boolean, reverted?: boolean, stamps_count?: number, error?: string }>}
 */
export async function revertStamp(supabase, loyaltyId, orderId) {
  // Check if a STAMP event exists for this order
  const { data: stampEvent, error: fetchError } = await supabase
    .from("loyalty_events")
    .select("id")
    .eq("loyalty_id", loyaltyId)
    .eq("order_id", orderId)
    .eq("event_type", "STAMP")
    .single();

  if (fetchError || !stampEvent) {
    // No stamp exists for this order — nothing to revert
    return { success: true, reverted: false };
  }

  // Insert REVERT event
  const { error: insertError } = await supabase
    .from("loyalty_events")
    .insert({
      loyalty_id: loyaltyId,
      order_id: orderId,
      event_type: "REVERT"
    });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // Decrement total_stamps (floor at 0)
  const { data: profile, error: profileError } = await supabase
    .from("customer_loyalty")
    .select("total_stamps")
    .eq("id", loyaltyId)
    .single();

  if (profileError) {
    return { success: false, error: profileError.message };
  }

  const newStamps = Math.max(0, profile.total_stamps - 1);

  const { error: updateError } = await supabase
    .from("customer_loyalty")
    .update({ total_stamps: newStamps })
    .eq("id", loyaltyId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, reverted: true, stamps_count: newStamps };
}

/**
 * Redeems an available reward. Decrements available_rewards and inserts a REDEEM event.
 * After redemption, the stamp counter resets to 0 for the next cycle.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} loyaltyId - UUID of the customer_loyalty record
 * @param {string} orderId - UUID of the order where the reward is applied
 * @param {string} operatorUserId - UUID of the operator who validated the redemption
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function redeemReward(supabase, loyaltyId, orderId, operatorUserId) {
  // Fetch current profile to check available rewards
  const { data: profile, error: fetchError } = await supabase
    .from("customer_loyalty")
    .select("available_rewards, total_stamps")
    .eq("id", loyaltyId)
    .single();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!profile || profile.available_rewards <= 0) {
    return { success: false, error: "No rewards available to redeem" };
  }

  // Insert REDEEM event with metadata (order_id and operator)
  const { error: insertError } = await supabase
    .from("loyalty_events")
    .insert({
      loyalty_id: loyaltyId,
      order_id: orderId,
      event_type: "REDEEM"
    });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // Decrement available_rewards and reset stamp counter to 0
  const { error: updateError } = await supabase
    .from("customer_loyalty")
    .update({
      available_rewards: profile.available_rewards - 1,
      total_stamps: 0
    })
    .eq("id", loyaltyId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

/**
 * Returns a public-safe loyalty summary for a customer, including:
 * - stamps_count: current stamp count
 * - stamps_target: the configured target for this business
 * - reward_available: whether a reward is available for redemption
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} phone - Raw phone number (will be normalized)
 * @param {string} businessId - UUID of the business (used to get target from loyalty_config)
 * @returns {Promise<{ success: boolean, summary?: { stamps_count: number, stamps_target: number, reward_available: boolean }, error?: string }>}
 */
export async function getLoyaltySummary(supabase, phone, businessId) {
  const phoneResult = validatePhone(phone);
  if (!phoneResult.valid) {
    return { success: false, error: phoneResult.error };
  }

  const normalizedPhone = phoneResult.value;

  // Fetch loyalty profile
  const { data: profile, error: profileError } = await supabase
    .from("customer_loyalty")
    .select("total_stamps, available_rewards")
    .eq("phone_number", normalizedPhone)
    .single();

  // Fetch business loyalty_config for target
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("loyalty_config")
    .eq("id", businessId)
    .single();

  if (bizError) {
    return { success: false, error: bizError.message };
  }

  const target = business.loyalty_config?.target || 5;

  // If no profile exists, return zeroed summary
  if (profileError || !profile) {
    return {
      success: true,
      summary: {
        stamps_count: 0,
        stamps_target: target,
        reward_available: false
      }
    };
  }

  return {
    success: true,
    summary: {
      stamps_count: profile.total_stamps,
      stamps_target: target,
      reward_available: profile.available_rewards > 0
    }
  };
}
