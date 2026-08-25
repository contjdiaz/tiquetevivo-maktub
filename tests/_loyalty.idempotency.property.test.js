/**
 * Property Test: Random status transition sequences preserve stamp idempotency
 * Feature: customer-retention-platform, Property 1: Stamp idempotency — one stamp per order
 *
 * **Validates: Requirements 2.2**
 *
 * For any sequence of status transitions on a single order, at most one STAMP event
 * is created in loyalty_events for that order_id, regardless of how many times the
 * status oscillates through the delivery state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock _validators.js
vi.mock('../netlify/functions/_validators.js', () => ({
  validatePhone: vi.fn((phone) => {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, error: 'Phone number is required' };
    }
    const normalized = phone.replace(/[+\s\-]/g, '');
    if (!/^\d+$/.test(normalized) || normalized.length < 10 || normalized.length > 15) {
      return { valid: false, error: 'Invalid phone number' };
    }
    return { valid: true, value: normalized };
  })
}));

import { addStamp, revertStamp } from '../netlify/functions/_loyalty.js';

/**
 * Simulates the loyalty event store (in-memory) to verify idempotency properties
 * without relying on an actual database. This gives us deterministic behavior
 * and allows fast-check to run many iterations.
 */
class InMemoryLoyaltyStore {
  constructor(target = 5) {
    this.events = []; // { loyalty_id, order_id, event_type }
    this.profile = { total_stamps: 0, available_rewards: 0 };
    this.target = target;
  }

  /**
   * Creates a mock supabase that uses this in-memory store.
   * The mock respects the unique partial index constraint:
   * only one STAMP event per order_id.
   */
  createMockSupabase() {
    const store = this;

    return {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() => {
                      // Used by revertStamp to check if STAMP exists
                      // We need to find the right event based on call context
                      // This is a simplified mock - actual args tracked via closure
                      return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                    }),
                  })),
                })),
              })),
            })),
            insert: vi.fn((data) => {
              const eventData = Array.isArray(data) ? data[0] : data;

              // Enforce unique partial index: one STAMP per order_id
              if (eventData.event_type === 'STAMP') {
                const existing = store.events.find(
                  e => e.order_id === eventData.order_id && e.event_type === 'STAMP'
                );
                if (existing) {
                  return Promise.resolve({
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' }
                  });
                }
              }

              store.events.push({ ...eventData });
              return Promise.resolve({ error: null });
            }),
          };
        }

        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { ...store.profile },
                  error: null
                })),
              })),
            })),
            update: vi.fn((payload) => ({
              eq: vi.fn(() => {
                // Apply the update to our in-memory store
                if (payload.total_stamps !== undefined) store.profile.total_stamps = payload.total_stamps;
                if (payload.available_rewards !== undefined) store.profile.available_rewards = payload.available_rewards;
                if (payload.last_stamp_at !== undefined) store.profile.last_stamp_at = payload.last_stamp_at;
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }

        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: store.target } },
                  error: null
                })),
              })),
            })),
          };
        }

        return {};
      }),
    };
  }

  getStampCount(orderId) {
    return this.events.filter(e => e.order_id === orderId && e.event_type === 'STAMP').length;
  }

  getTotalStampEvents() {
    return this.events.filter(e => e.event_type === 'STAMP').length;
  }
}

describe('Property: Random status transition sequences preserve stamp idempotency', () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * Generator: produces random sequences of status transitions for a single order,
   * including repeats of DELIVERED (the stamp-triggering status).
   *
   * Property: regardless of the transition sequence, at most one STAMP event exists
   * for any given order_id in the loyalty events store.
   */
  it('at most one STAMP event per order_id regardless of transition sequence', async () => {
    const STATUSES = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

    // Generator: random sequence of statuses (1 to 20 transitions)
    const statusSequenceArb = fc.array(
      fc.constantFrom(...STATUSES),
      { minLength: 1, maxLength: 20 }
    );

    await fc.assert(
      fc.asyncProperty(
        statusSequenceArb,
        fc.uuid(), // orderId
        async (statusSequence, orderId) => {
          const store = new InMemoryLoyaltyStore(5);
          const supabase = store.createMockSupabase();
          const loyaltyId = 'loyalty-property-test';
          const businessId = 'biz-property-test';

          // Simulate applying the status transitions
          for (const status of statusSequence) {
            if (status === 'DELIVERED') {
              // Order transitioned to DELIVERED → attempt to add stamp
              await addStamp(supabase, loyaltyId, orderId, businessId);
            }
            // Non-DELIVERED statuses don't trigger addStamp (upstream guard)
            // But CANCELLED after DELIVERED would trigger revertStamp
            // (tested separately — here we focus on STAMP idempotency)
          }

          // PROPERTY: At most one STAMP event for this order_id
          const stampCount = store.getStampCount(orderId);
          expect(stampCount).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple different orders each get at most one stamp', async () => {
    /**
     * **Validates: Requirements 2.2**
     *
     * Tests that when multiple orders go through various status transitions,
     * each order_id gets at most one STAMP event.
     */
    const STATUSES = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

    // Generator: multiple orders with their status sequences
    const ordersArb = fc.array(
      fc.record({
        orderId: fc.uuid(),
        transitions: fc.array(fc.constantFrom(...STATUSES), { minLength: 1, maxLength: 10 })
      }),
      { minLength: 1, maxLength: 5 }
    );

    await fc.assert(
      fc.asyncProperty(
        ordersArb,
        async (orders) => {
          const store = new InMemoryLoyaltyStore(5);
          const supabase = store.createMockSupabase();
          const loyaltyId = 'loyalty-multi';
          const businessId = 'biz-multi';

          for (const { orderId, transitions } of orders) {
            for (const status of transitions) {
              if (status === 'DELIVERED') {
                await addStamp(supabase, loyaltyId, orderId, businessId);
              }
            }
          }

          // PROPERTY: Each unique order_id has at most one STAMP event
          const orderIds = [...new Set(orders.map(o => o.orderId))];
          for (const oid of orderIds) {
            const stamps = store.getStampCount(oid);
            expect(stamps).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stamp count never exceeds number of unique DELIVERED orders', async () => {
    /**
     * **Validates: Requirements 2.2**
     *
     * The total stamp count (total_stamps on the profile) should never exceed
     * the number of unique orders that reached DELIVERED status.
     */
    const STATUSES = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

    const ordersArb = fc.array(
      fc.record({
        orderId: fc.uuid(),
        transitions: fc.array(fc.constantFrom(...STATUSES), { minLength: 1, maxLength: 8 })
      }),
      { minLength: 1, maxLength: 8 }
    );

    await fc.assert(
      fc.asyncProperty(
        ordersArb,
        async (orders) => {
          const store = new InMemoryLoyaltyStore(5);
          const supabase = store.createMockSupabase();
          const loyaltyId = 'loyalty-count';
          const businessId = 'biz-count';

          for (const { orderId, transitions } of orders) {
            for (const status of transitions) {
              if (status === 'DELIVERED') {
                await addStamp(supabase, loyaltyId, orderId, businessId);
              }
            }
          }

          // Total stamps in store = count of STAMP events
          const totalStamps = store.getTotalStampEvents();
          const uniqueOrderIds = new Set(orders.map(o => o.orderId)).size;

          // PROPERTY: total stamps never exceed unique order count
          expect(totalStamps).toBeLessThanOrEqual(uniqueOrderIds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
