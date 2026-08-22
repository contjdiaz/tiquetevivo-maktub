/**
 * Unit tests for buildPickupPayload and parsePickupPayload
 * Validates: Requirements 3.2
 */
import { describe, it, expect } from 'vitest';
import { buildPickupPayload, parsePickupPayload, buildPayPayload } from '../public/js/qr-payload.js';

describe('buildPickupPayload', () => {
  it('returns structured payload with correct format', () => {
    const order = { id: 'abc-123', order_number: '8707', slug: 'majesty' };
    const result = buildPickupPayload(order);
    expect(result).toBe('TIQUETEVIVO:PICKUP|ID:abc-123|NUM:8707|SLUG:majesty');
  });

  it('handles numeric order_number', () => {
    const order = { id: 'uuid-456', order_number: 1234, slug: 'cleanfast' };
    const result = buildPickupPayload(order);
    expect(result).toBe('TIQUETEVIVO:PICKUP|ID:uuid-456|NUM:1234|SLUG:cleanfast');
  });

  it('supports orderNumber alias', () => {
    const order = { id: 'uuid-789', orderNumber: '5555', slug: 'lav' };
    const result = buildPickupPayload(order);
    expect(result).toBe('TIQUETEVIVO:PICKUP|ID:uuid-789|NUM:5555|SLUG:lav');
  });
});

describe('parsePickupPayload', () => {
  it('parses a valid pickup payload', () => {
    const raw = 'TIQUETEVIVO:PICKUP|ID:abc-123|NUM:8707|SLUG:majesty';
    const result = parsePickupPayload(raw);
    expect(result).toEqual({ id: 'abc-123', orderNumber: '8707', slug: 'majesty' });
  });

  it('returns null for null input', () => {
    expect(parsePickupPayload(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parsePickupPayload(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePickupPayload('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parsePickupPayload(42)).toBeNull();
  });

  it('returns null when prefix is missing', () => {
    expect(parsePickupPayload('ID:abc|NUM:123|SLUG:test')).toBeNull();
  });

  it('returns null when a segment is missing (no SLUG)', () => {
    expect(parsePickupPayload('TIQUETEVIVO:PICKUP|ID:abc|NUM:123')).toBeNull();
  });

  it('returns null when a segment is missing (no NUM)', () => {
    expect(parsePickupPayload('TIQUETEVIVO:PICKUP|ID:abc|SLUG:test')).toBeNull();
  });

  it('returns null when a segment is missing (no ID)', () => {
    expect(parsePickupPayload('TIQUETEVIVO:PICKUP|NUM:123|SLUG:test')).toBeNull();
  });

  it('returns null when a segment value is empty', () => {
    expect(parsePickupPayload('TIQUETEVIVO:PICKUP|ID:|NUM:123|SLUG:test')).toBeNull();
  });
});

describe('buildPickupPayload + parsePickupPayload round-trip', () => {
  it('round-trips correctly', () => {
    const order = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', order_number: '8707', slug: 'majesty' };
    const payload = buildPickupPayload(order);
    const parsed = parsePickupPayload(payload);
    expect(parsed).toEqual({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      orderNumber: '8707',
      slug: 'majesty',
    });
  });
});

describe('buildPayPayload', () => {
  it('returns correctly formatted payment string using order.balance', () => {
    const order = { balance: 70000, order_number: '8707' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:70000|NEQUI:3102688991|REF:TiqueteVivo-8707|NOMBRE:Majesty Lavanderia');
  });

  it('computes balance from total and paid when balance is not a number', () => {
    const order = { total: 100000, paid: 60000, order_number: '1234' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:40000|NEQUI:3102688991|REF:TiqueteVivo-1234|NOMBRE:Majesty Lavanderia');
  });

  it('clamps computed balance to zero when paid exceeds total', () => {
    const order = { total: 50000, paid: 60000, order_number: '9999' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:0|NEQUI:3102688991|REF:TiqueteVivo-9999|NOMBRE:Majesty Lavanderia');
  });

  it('handles zero balance', () => {
    const order = { balance: 0, order_number: '5555' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:0|NEQUI:3102688991|REF:TiqueteVivo-5555|NOMBRE:Majesty Lavanderia');
  });

  it('supports orderNumber alias', () => {
    const order = { balance: 25000, orderNumber: '4321' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:25000|NEQUI:3102688991|REF:TiqueteVivo-4321|NOMBRE:Majesty Lavanderia');
  });

  it('defaults to zero balance when no balance info is provided', () => {
    const order = { order_number: '1111' };
    const result = buildPayPayload(order);
    expect(result).toBe('PAGO:0|NEQUI:3102688991|REF:TiqueteVivo-1111|NOMBRE:Majesty Lavanderia');
  });
});
