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
  const origin = 'https://tiquetevivo.netlify.app';

  it('returns URL format with order_id and token params', () => {
    const order = { id: 'abc-123', ticket_token: 'tok-456' };
    const result = buildPayPayload(order, origin);
    expect(result).toBe('https://tiquetevivo.netlify.app/pagar.html?order_id=abc-123&token=tok-456');
  });

  it('supports ticketToken alias', () => {
    const order = { id: 'order-1', ticketToken: 'token-xyz' };
    const result = buildPayPayload(order, origin);
    expect(result).toBe('https://tiquetevivo.netlify.app/pagar.html?order_id=order-1&token=token-xyz');
  });

  it('encodes special characters in order_id and token', () => {
    const order = { id: 'id with spaces', ticket_token: 'tok&en=val' };
    const result = buildPayPayload(order, origin);
    expect(result).toBe('https://tiquetevivo.netlify.app/pagar.html?order_id=id%20with%20spaces&token=tok%26en%3Dval');
  });

  it('handles missing id and token gracefully', () => {
    const order = {};
    const result = buildPayPayload(order, origin);
    expect(result).toBe('https://tiquetevivo.netlify.app/pagar.html?order_id=&token=');
  });

  it('uses ticket_token over ticketToken when both present', () => {
    const order = { id: 'ord-1', ticket_token: 'primary', ticketToken: 'secondary' };
    const result = buildPayPayload(order, origin);
    expect(result).toBe('https://tiquetevivo.netlify.app/pagar.html?order_id=ord-1&token=primary');
  });

  it('works with different origin values', () => {
    const order = { id: 'uuid-1', ticket_token: 'tok-1' };
    const result = buildPayPayload(order, 'http://localhost:8888');
    expect(result).toBe('http://localhost:8888/pagar.html?order_id=uuid-1&token=tok-1');
  });
});
