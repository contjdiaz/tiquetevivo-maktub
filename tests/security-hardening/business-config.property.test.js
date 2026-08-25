/**
 * Property-based tests for get-business-config.js public config field whitelist.
 *
 * Feature: security-hardening, Property 6: Unauthenticated config exposes only public-safe fields
 *
 * **Validates: Requirements 4.1, 4.3**
 *
 * Property 6: For any business configuration, when accessed without authentication,
 * the response SHALL contain only the fields: business_name, business_slug,
 * vertical_emoji, vertical_name, status_flow_config, custom_fields_config, and
 * loyalty_config (with only enabled and target sub-fields). No other fields
 * (business_id, services_config, whatsapp_templates_config, reactivation_config)
 * SHALL be present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// The exact set of fields allowed in an unauthenticated response
const PUBLIC_SAFE_FIELDS = [
  'business_name',
  'business_slug',
  'vertical_emoji',
  'vertical_name',
  'status_flow_config',
  'custom_fields_config',
  'loyalty_config'
];

// Fields that must NEVER appear in unauthenticated responses
const INTERNAL_FIELDS = [
  'business_id',
  'services_config',
  'whatsapp_templates_config',
  'reactivation_config',
  'plan'
];

// Mock _utils.js — set getBearerToken to return null and getAuthUser to return null
// for unauthenticated requests
vi.mock('../../netlify/functions/_utils.js', () => {
  const createMockSupabase = () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { emoji: '🧺', name: 'Laundry' } })
          })),
          single: vi.fn().mockResolvedValue({ data: { emoji: '🧺', name: 'Laundry' } })
        }))
      }))
    })),
    auth: { getUser: vi.fn() }
  });

  const mockSupabaseInstance = createMockSupabase();

  return {
    json: (statusCode, body) => ({
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }),
    supabaseAdmin: () => mockSupabaseInstance,
    getBusinessBySlug: vi.fn(),
    getBearerToken: vi.fn().mockReturnValue(null),
    getAuthUser: vi.fn().mockResolvedValue(null),
    getUserBusinessRole: vi.fn().mockResolvedValue(null),
    hasPermission: vi.fn().mockReturnValue(false)
  };
});

import { handler } from '../../netlify/functions/get-business-config.js';
import { getBusinessBySlug, getBearerToken, getAuthUser } from '../../netlify/functions/_utils.js';

/**
 * Arbitrary generator for random business configurations with both
 * public-safe fields and extra internal/random fields.
 */
const businessConfigArb = fc.record({
  // Core fields present in every business
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  slug: fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,29}$/),
  plan: fc.constantFrom('free', 'basic', 'premium', 'enterprise'),
  vertical_id: fc.option(fc.uuid(), { nil: null }),

  // Public-safe nested configs
  status_flow_config: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 6 }),
  custom_fields_config: fc.array(
    fc.record({ key: fc.string({ minLength: 1, maxLength: 15 }), label: fc.string({ minLength: 1, maxLength: 30 }) }),
    { minLength: 0, maxLength: 5 }
  ),

  // loyalty_config with both public and internal sub-fields
  loyalty_config: fc.record({
    enabled: fc.boolean(),
    target: fc.integer({ min: 1, max: 100 }),
    reward_type: fc.constantFrom('discount', 'free_service', 'points'),
    reward_value: fc.integer({ min: 1, max: 50 }),
    message_template: fc.string({ minLength: 5, maxLength: 100 }),
    secret_internal_key: fc.string({ minLength: 5, maxLength: 30 })
  }),

  // Internal configs that must be excluded
  services_config: fc.array(
    fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      price: fc.integer({ min: 1, max: 1000 })
    }),
    { minLength: 0, maxLength: 5 }
  ),
  whatsapp_templates_config: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 15 }),
    fc.string({ minLength: 1, maxLength: 100 }),
    { minKeys: 0, maxKeys: 3 }
  ),
  reactivation_config: fc.record({
    enabled: fc.boolean(),
    threshold_days: fc.integer({ min: 1, max: 90 }),
    monthly_limit: fc.integer({ min: 1, max: 500 })
  })
});

/**
 * Arbitrary generator for extra random unknown fields that could be
 * added to a business config in the future. These must never leak.
 */
const extraFieldsArb = fc.dictionary(
  fc.stringMatching(/^[a-z_]{3,20}$/).filter(
    (key) => !['id', 'name', 'slug', 'plan', 'vertical_id', 'status_flow_config',
      'custom_fields_config', 'loyalty_config', 'services_config',
      'whatsapp_templates_config', 'reactivation_config'].includes(key)
  ),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  { minKeys: 0, maxKeys: 5 }
);

describe('Feature: security-hardening, Property 6: Unauthenticated business config exposes only public-safe fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure unauthenticated state
    getBearerToken.mockReturnValue(null);
    getAuthUser.mockResolvedValue(null);
  });

  it('response contains only the whitelisted public-safe fields for any business config', async () => {
    /**
     * **Validates: Requirements 4.1, 4.3**
     *
     * For any randomly generated business configuration (including extra internal
     * fields), the unauthenticated response contains ONLY the 7 public-safe fields
     * and no others.
     */
    await fc.assert(
      fc.asyncProperty(businessConfigArb, extraFieldsArb, async (businessConfig, extraFields) => {
        // Construct a full business with known + extra random fields
        const fullBusiness = { ...extraFields, ...businessConfig };
        getBusinessBySlug.mockResolvedValue(fullBusiness);

        const event = {
          httpMethod: 'GET',
          queryStringParameters: { slug: businessConfig.slug },
          headers: {}
        };

        const response = await handler(event);
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(200);

        // Response must contain ONLY public-safe fields
        const responseKeys = Object.keys(body);
        for (const key of responseKeys) {
          expect(PUBLIC_SAFE_FIELDS).toContain(key);
        }

        // All public-safe fields must be present
        for (const field of PUBLIC_SAFE_FIELDS) {
          expect(body).toHaveProperty(field);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never exposes known internal fields regardless of business configuration content', async () => {
    /**
     * **Validates: Requirements 4.1, 4.3**
     *
     * For any business configuration, none of the internal fields (business_id,
     * services_config, whatsapp_templates_config, reactivation_config, plan)
     * appear in the unauthenticated response.
     */
    await fc.assert(
      fc.asyncProperty(businessConfigArb, async (businessConfig) => {
        getBusinessBySlug.mockResolvedValue(businessConfig);

        const event = {
          httpMethod: 'GET',
          queryStringParameters: { slug: businessConfig.slug },
          headers: {}
        };

        const response = await handler(event);
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(200);

        // None of the internal fields should be present
        for (const field of INTERNAL_FIELDS) {
          expect(body).not.toHaveProperty(field);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('loyalty_config exposes only enabled and target sub-fields for any loyalty configuration', async () => {
    /**
     * **Validates: Requirements 4.1, 4.3**
     *
     * For any business loyalty_config containing arbitrary sub-fields beyond
     * enabled and target, the unauthenticated response loyalty_config contains
     * ONLY { enabled, target } and nothing else.
     */
    await fc.assert(
      fc.asyncProperty(businessConfigArb, async (businessConfig) => {
        getBusinessBySlug.mockResolvedValue(businessConfig);

        const event = {
          httpMethod: 'GET',
          queryStringParameters: { slug: businessConfig.slug },
          headers: {}
        };

        const response = await handler(event);
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(200);

        // loyalty_config must exist and have exactly 2 keys
        const loyaltyKeys = Object.keys(body.loyalty_config);
        expect(loyaltyKeys).toHaveLength(2);
        expect(loyaltyKeys).toContain('enabled');
        expect(loyaltyKeys).toContain('target');

        // Values must match the source (or defaults)
        const sourceLoyalty = businessConfig.loyalty_config || { enabled: true, target: 5 };
        expect(body.loyalty_config.enabled).toBe(sourceLoyalty.enabled);
        expect(body.loyalty_config.target).toBe(sourceLoyalty.target);
      }),
      { numRuns: 100 }
    );
  });

  it('extra unknown fields added to business config never appear in unauthenticated response', async () => {
    /**
     * **Validates: Requirements 4.3**
     *
     * For any business configuration augmented with arbitrary extra fields
     * (simulating future additions), the whitelist approach ensures none of
     * those extra fields leak to unauthenticated users.
     */
    await fc.assert(
      fc.asyncProperty(businessConfigArb, extraFieldsArb, async (businessConfig, extraFields) => {
        const fullBusiness = { ...businessConfig, ...extraFields };
        getBusinessBySlug.mockResolvedValue(fullBusiness);

        const event = {
          httpMethod: 'GET',
          queryStringParameters: { slug: businessConfig.slug },
          headers: {}
        };

        const response = await handler(event);
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(200);

        // No extra field key should appear in the response
        for (const extraKey of Object.keys(extraFields)) {
          expect(body).not.toHaveProperty(extraKey);
        }
      }),
      { numRuns: 100 }
    );
  });
});
