/**
 * Unit tests for the _loyalty.js shared module.
 * Validates: Requirements 1, 2, 3
 *
 * Tests stamp idempotency, reversion, cancelled-order blocking,
 * reward unlocking at threshold, and single-use redemption.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateLoyaltyProfile,
  addStamp,
  revertStamp,
  redeemReward,
  getLoyaltySummary
} from '../netlify/functions/_loyalty.js';

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

/**
 * Creates a mock supabase client with configurable table behaviors.
 * Each table can be configured with custom responses for select/insert/update.
 */
function createMockSupabase(config = {}) {
  const tables = {};

  function getTable(tableName) {
    if (tables[tableName]) return tables[tableName];
    // Default: successful empty responses
    return {
      selectData: null,
      selectError: null,
      insertData: {},
      insertError: null,
      updateData: {},
      updateError: null,
    };
  }

  // Allow test to configure table behaviors
  function configureTable(tableName, cfg) {
    tables[tableName] = { ...getTable(tableName), ...cfg };
  }

  // Pre-configure from init config
  for (const [table, cfg] of Object.entries(config)) {
    configureTable(table, cfg);
  }

  const supabase = {
    _tables: tables,
    _configureTable: configureTable,
    from: vi.fn((tableName) => {
      const tbl = getTable(tableName);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: tbl.selectData, error: tbl.selectError })),
              })),
              single: vi.fn(() => Promise.resolve({ data: tbl.selectData, error: tbl.selectError })),
            })),
            single: vi.fn(() => Promise.resolve({ data: tbl.selectData, error: tbl.selectError })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: tbl.insertData, error: tbl.insertError })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: tbl.updateData, error: tbl.updateError })),
        })),
      };
    }),
  };

  return supabase;
}

describe('_loyalty.js — getOrCreateLoyaltyProfile', () => {
  it('returns existing profile when found', async () => {
    const existingProfile = { id: 'loyalty-1', phone_number: '573001234567', total_stamps: 3, available_rewards: 0 };
    const supabase = createMockSupabase({
      customer_loyalty: { selectData: existingProfile, selectError: null }
    });

    const result = await getOrCreateLoyaltyProfile(supabase, '3001234567');
    expect(result.success).toBe(true);
    expect(result.profile).toEqual(existingProfile);
  });

  it('creates new profile when not found', async () => {
    const newProfile = { id: 'loyalty-new', phone_number: '573009876543', total_stamps: 0, available_rewards: 0 };

    // First call (select) returns not found, second call (insert) creates new
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows' } })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: newProfile, error: null })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await getOrCreateLoyaltyProfile(supabase, '+57 300 987 6543');
    expect(result.success).toBe(true);
    expect(result.profile).toEqual(newProfile);
  });

  it('returns error for invalid phone', async () => {
    const supabase = createMockSupabase();
    const result = await getOrCreateLoyaltyProfile(supabase, '123');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('_loyalty.js — addStamp (idempotency)', () => {
  /**
   * Validates: Requirements 2.2
   * Same order_id → only one STAMP event (unique partial index catches duplicate)
   */
  it('returns already_stamped: true when same order_id stamps twice', async () => {
    // Second call triggers unique constraint violation (23505)
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })),
          };
        }
        return {};
      }),
    };

    const result = await addStamp(supabase, 'loyalty-1', 'order-1', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.already_stamped).toBe(true);
  });

  it('successfully adds stamp on first call', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 2, available_rewards: 0 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await addStamp(supabase, 'loyalty-1', 'order-new', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.already_stamped).toBe(false);
    expect(result.stamps_count).toBe(3); // 2 + 1
    expect(result.reward_unlocked).toBe(false);
  });
});

describe('_loyalty.js — revertStamp', () => {
  /**
   * Validates: Requirements 2.3
   * Cancel after deliver → REVERT event, stamps never negative
   */
  it('inserts REVERT event and decrements stamps when STAMP exists', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: { id: 'event-1' },
                      error: null
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 3 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await revertStamp(supabase, 'loyalty-1', 'order-1');
    expect(result.success).toBe(true);
    expect(result.reverted).toBe(true);
    expect(result.stamps_count).toBe(2); // 3 - 1
  });

  it('stamps never go negative after revert (floor at 0)', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: { id: 'event-1' },
                      error: null
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 0 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await revertStamp(supabase, 'loyalty-1', 'order-1');
    expect(result.success).toBe(true);
    expect(result.reverted).toBe(true);
    expect(result.stamps_count).toBe(0); // Math.max(0, 0-1) = 0
  });

  it('does nothing when no STAMP exists for the order', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: { code: 'PGRST116', message: 'No rows' }
                    })),
                  })),
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await revertStamp(supabase, 'loyalty-1', 'order-never-stamped');
    expect(result.success).toBe(true);
    expect(result.reverted).toBe(false);
  });
});

describe('_loyalty.js — addStamp (cancelled orders never generate stamps)', () => {
  /**
   * Validates: Requirements 2.4
   * Orders in CANCELLED status SHALL never generate a stamp.
   * This is enforced at the update-order.js level (not calling addStamp for CANCELLED),
   * but the idempotency also means if something weird happened, addStamp deduplicate.
   *
   * Here we test that the module itself handles the constraint correctly — 
   * a CANCELLED order that somehow calls addStamp would either:
   * - Already have a stamp (idempotent) → already_stamped: true
   * - Never reach addStamp (upstream guard)
   */
  it('constraint violation prevents double-stamp regardless of status', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })),
          };
        }
        return {};
      }),
    };

    // Even if called for a cancelled order that previously had a stamp, idempotency holds
    const result = await addStamp(supabase, 'loyalty-1', 'order-cancelled', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.already_stamped).toBe(true);
  });
});

describe('_loyalty.js — addStamp (reward unlocking at target threshold)', () => {
  /**
   * Validates: Requirements 3.1
   * WHEN stamps reach configured target, available_rewards increments.
   */
  it('unlocks reward when stamp count reaches target', async () => {
    // Target is 5, current stamps = 4, so adding one reaches 5
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 4, available_rewards: 0 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await addStamp(supabase, 'loyalty-1', 'order-5th', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.stamps_count).toBe(5);
    expect(result.reward_unlocked).toBe(true);
  });

  it('does NOT unlock reward when stamp count has not reached target', async () => {
    // Target is 5, current stamps = 2, adding one gives 3
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 2, available_rewards: 0 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await addStamp(supabase, 'loyalty-1', 'order-3rd', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.stamps_count).toBe(3);
    expect(result.reward_unlocked).toBe(false);
  });

  it('unlocks reward at multiples of target (e.g., 10th stamp with target 5)', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 9, available_rewards: 1 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await addStamp(supabase, 'loyalty-1', 'order-10th', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.stamps_count).toBe(10);
    expect(result.reward_unlocked).toBe(true);
  });
});

describe('_loyalty.js — redeemReward (single-use)', () => {
  /**
   * Validates: Requirements 3.3
   * A reward SHALL be redeemable exactly once.
   */
  it('successfully redeems when reward is available', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { available_rewards: 1, total_stamps: 5 },
                  error: null
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          };
        }
        if (table === 'loyalty_events') {
          return {
            insert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        return {};
      }),
    };

    const result = await redeemReward(supabase, 'loyalty-1', 'order-redeem', 'operator-1');
    expect(result.success).toBe(true);
  });

  it('fails when no rewards are available (single-use enforced)', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { available_rewards: 0, total_stamps: 3 },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await redeemReward(supabase, 'loyalty-1', 'order-x', 'operator-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No rewards available');
  });

  it('cannot redeem twice (second call finds 0 rewards)', async () => {
    // Simulate: first redemption succeeded → available_rewards is now 0
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { available_rewards: 0, total_stamps: 0 },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await redeemReward(supabase, 'loyalty-1', 'order-second', 'operator-2');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No rewards available');
  });
});

describe('_loyalty.js — getLoyaltySummary', () => {
  it('returns zeroed summary when no profile exists', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: null,
                  error: { code: 'PGRST116', message: 'No rows' }
                })),
              })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await getLoyaltySummary(supabase, '3001234567', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      stamps_count: 0,
      stamps_target: 5,
      reward_available: false
    });
  });

  it('returns correct summary with existing profile', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customer_loyalty') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { total_stamps: 4, available_rewards: 1 },
                  error: null
                })),
              })),
            })),
          };
        }
        if (table === 'businesses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: { loyalty_config: { enabled: true, target: 5 } },
                  error: null
                })),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const result = await getLoyaltySummary(supabase, '3001234567', 'biz-1');
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      stamps_count: 4,
      stamps_target: 5,
      reward_available: true
    });
  });
});
