import { describe, it, expect, vi } from 'vitest';
import { getBusinessConfig, getVerticalBySlug, applyVerticalDefaults } from '../netlify/functions/_vertical-config.js';

// Helper to create a mock supabase client
function createMockSupabase(mockResult) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(mockResult),
    update: vi.fn().mockReturnThis()
  };
  return chain;
}

describe('_vertical-config.js', () => {
  describe('getBusinessConfig', () => {
    it('returns merged business config with vertical data', async () => {
      const mockBusiness = {
        id: 'biz-1',
        slug: 'mi-lavanderia',
        name: 'Mi Lavandería',
        vertical_id: 'vert-1',
        services_config: [{ name: 'Lavado', default_price: 12000 }],
        custom_fields_config: [{ field_key: 'is_delicate', field_type: 'boolean' }],
        status_flow_config: [{ status_key: 'RECEIVED', display_label: 'Recibido' }],
        whatsapp_templates_config: { order_created: 'Hola {customer_name}' },
        verticals: {
          id: 'vert-1',
          slug: 'laundry',
          name: 'Lavandería',
          emoji: '🧺',
          services_default: [],
          custom_fields_default: [],
          status_flow_default: [],
          whatsapp_templates_default: {}
        }
      };

      const supabase = createMockSupabase({ data: mockBusiness, error: null });
      const result = await getBusinessConfig(supabase, 'biz-1');

      expect(result.id).toBe('biz-1');
      expect(result.slug).toBe('mi-lavanderia');
      expect(result.name).toBe('Mi Lavandería');
      expect(result.vertical_id).toBe('vert-1');
      expect(result.services_config).toEqual([{ name: 'Lavado', default_price: 12000 }]);
      expect(result.custom_fields_config).toEqual([{ field_key: 'is_delicate', field_type: 'boolean' }]);
      expect(result.status_flow_config).toEqual([{ status_key: 'RECEIVED', display_label: 'Recibido' }]);
      expect(result.whatsapp_templates_config).toEqual({ order_created: 'Hola {customer_name}' });
      expect(result.vertical).toEqual(mockBusiness.verticals);
    });

    it('returns empty arrays/objects when config columns are null', async () => {
      const mockBusiness = {
        id: 'biz-2',
        slug: 'test-biz',
        name: 'Test',
        vertical_id: null,
        services_config: null,
        custom_fields_config: null,
        status_flow_config: null,
        whatsapp_templates_config: null,
        verticals: null
      };

      const supabase = createMockSupabase({ data: mockBusiness, error: null });
      const result = await getBusinessConfig(supabase, 'biz-2');

      expect(result.services_config).toEqual([]);
      expect(result.custom_fields_config).toEqual([]);
      expect(result.status_flow_config).toEqual([]);
      expect(result.whatsapp_templates_config).toEqual({});
      expect(result.vertical).toBeNull();
    });

    it('throws when supabase returns an error', async () => {
      const supabase = createMockSupabase({ data: null, error: new Error('DB error') });
      await expect(getBusinessConfig(supabase, 'bad-id')).rejects.toThrow('DB error');
    });

    it('throws when no business is found', async () => {
      const supabase = createMockSupabase({ data: null, error: null });
      await expect(getBusinessConfig(supabase, 'nonexistent')).rejects.toThrow('Business not found');
    });

    it('queries the businesses table with correct businessId', async () => {
      const supabase = createMockSupabase({
        data: { id: 'biz-1', slug: 'x', name: 'X', vertical_id: null, services_config: [], custom_fields_config: [], status_flow_config: [], whatsapp_templates_config: {}, verticals: null },
        error: null
      });

      await getBusinessConfig(supabase, 'biz-1');

      expect(supabase.from).toHaveBeenCalledWith('businesses');
      expect(supabase.eq).toHaveBeenCalledWith('id', 'biz-1');
    });
  });

  describe('getVerticalBySlug', () => {
    it('returns vertical definition for valid slug', async () => {
      const mockVertical = {
        id: 'vert-1',
        slug: 'laundry',
        name: 'Lavandería',
        emoji: '🧺',
        services_default: [{ name: 'Lavado estándar', default_price: 12000 }],
        custom_fields_default: [{ field_key: 'is_delicate', field_type: 'boolean' }],
        status_flow_default: [{ status_key: 'RECEIVED', display_label: 'Recibido' }],
        whatsapp_templates_default: { order_created: 'Hola' },
        active: true,
        created_at: '2024-01-01T00:00:00Z'
      };

      const supabase = createMockSupabase({ data: mockVertical, error: null });
      const result = await getVerticalBySlug(supabase, 'laundry');

      expect(result).toEqual(mockVertical);
      expect(supabase.from).toHaveBeenCalledWith('verticals');
      expect(supabase.eq).toHaveBeenCalledWith('slug', 'laundry');
    });

    it('returns null when no vertical found (PGRST116)', async () => {
      const supabase = createMockSupabase({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' }
      });

      const result = await getVerticalBySlug(supabase, 'nonexistent');
      expect(result).toBeNull();
    });

    it('throws on unexpected database errors', async () => {
      const supabase = createMockSupabase({
        data: null,
        error: { code: '42P01', message: 'Table not found' }
      });

      await expect(getVerticalBySlug(supabase, 'laundry')).rejects.toEqual({ code: '42P01', message: 'Table not found' });
    });

    it('filters by active=true', async () => {
      const supabase = createMockSupabase({ data: null, error: { code: 'PGRST116' } });
      await getVerticalBySlug(supabase, 'inactive-vert');

      expect(supabase.eq).toHaveBeenCalledWith('active', true);
    });
  });

  describe('applyVerticalDefaults', () => {
    it('updates business with vertical default values', async () => {
      const vertical = {
        id: 'vert-parking',
        slug: 'parking',
        services_default: [{ name: 'Hora', default_price: 3000 }],
        custom_fields_default: [{ field_key: 'plate_number', field_type: 'text', required: true }],
        status_flow_default: [{ status_key: 'ENTRY', display_label: 'Ingreso' }],
        whatsapp_templates_default: { order_created: 'Bienvenido' }
      };

      const mockResult = { data: null, error: null };
      const supabase = {
        from: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue(mockResult)
      };

      await applyVerticalDefaults(supabase, 'biz-1', vertical);

      expect(supabase.from).toHaveBeenCalledWith('businesses');
      expect(supabase.update).toHaveBeenCalledWith({
        vertical_id: 'vert-parking',
        services_config: [{ name: 'Hora', default_price: 3000 }],
        custom_fields_config: [{ field_key: 'plate_number', field_type: 'text', required: true }],
        status_flow_config: [{ status_key: 'ENTRY', display_label: 'Ingreso' }],
        whatsapp_templates_config: { order_created: 'Bienvenido' }
      });
      expect(supabase.eq).toHaveBeenCalledWith('id', 'biz-1');
    });

    it('uses empty defaults when vertical config is null', async () => {
      const vertical = {
        id: 'vert-empty',
        slug: 'empty',
        services_default: null,
        custom_fields_default: null,
        status_flow_default: null,
        whatsapp_templates_default: null
      };

      const mockResult = { data: null, error: null };
      const supabase = {
        from: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue(mockResult)
      };

      await applyVerticalDefaults(supabase, 'biz-1', vertical);

      expect(supabase.update).toHaveBeenCalledWith({
        vertical_id: 'vert-empty',
        services_config: [],
        custom_fields_config: [],
        status_flow_config: [],
        whatsapp_templates_config: {}
      });
    });

    it('throws when supabase returns an error', async () => {
      const vertical = {
        id: 'vert-1',
        services_default: [],
        custom_fields_default: [],
        status_flow_default: [],
        whatsapp_templates_default: {}
      };

      const supabase = {
        from: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: new Error('Update failed') })
      };

      await expect(applyVerticalDefaults(supabase, 'biz-1', vertical)).rejects.toThrow('Update failed');
    });
  });
});
