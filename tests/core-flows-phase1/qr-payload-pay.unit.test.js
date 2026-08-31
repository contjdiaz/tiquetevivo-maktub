/**
 * Unit tests for QR "pay" mode — buildPayPayload URL format and
 * getAvailableModes hiding "pay" for zero-balance / terminal statuses.
 *
 * Validates: Requirements 6.1, 6.4, 6.5
 */
import { describe, it, expect } from 'vitest';
import { buildPayPayload } from '../../public/js/qr-payload.js';
import { getAvailableModes } from '../../public/js/qr-mode-selector.js';

// --- Requirement 6.1: buildPayPayload returns absolute URL to /pagar.html ---

describe('buildPayPayload — URL format (Req 6.1)', () => {
  const origin = 'https://tiquetevivo.netlify.app';

  it('returns a URL containing /pagar.html with order_id and token params', () => {
    const order = { id: 'order-uuid-1', ticket_token: 'token-uuid-1' };
    const result = buildPayPayload(order, origin);

    expect(result).toBe(
      'https://tiquetevivo.netlify.app/pagar.html?order_id=order-uuid-1&token=token-uuid-1'
    );
    // Verify structure
    const url = new URL(result);
    expect(url.pathname).toBe('/pagar.html');
    expect(url.searchParams.get('order_id')).toBe('order-uuid-1');
    expect(url.searchParams.get('token')).toBe('token-uuid-1');
  });

  it('properly encodes special characters in order_id and token', () => {
    const order = { id: 'id con espacios&más', ticket_token: 'tok/en=val&x' };
    const result = buildPayPayload(order, origin);

    // The result should be a valid URL where params decode correctly
    const url = new URL(result);
    expect(url.searchParams.get('order_id')).toBe('id con espacios&más');
    expect(url.searchParams.get('token')).toBe('tok/en=val&x');
  });

  it('uses the provided origin (supports different environments)', () => {
    const order = { id: 'abc', ticket_token: 'def' };
    const localResult = buildPayPayload(order, 'http://localhost:8888');
    expect(localResult.startsWith('http://localhost:8888/pagar.html')).toBe(true);
  });
});

// --- Requirement 6.4: Hide "pay" when balance === 0 ---

describe('getAvailableModes — hides "pay" when balance=0 (Req 6.4)', () => {
  it('does NOT include "pay" when balance is 0 and status is RECEIVED', () => {
    const modes = getAvailableModes('RECEIVED', 0);
    expect(modes).not.toContain('pay');
  });

  it('does NOT include "pay" when balance is 0 and status is IN_PROGRESS', () => {
    const modes = getAvailableModes('IN_PROGRESS', 0);
    expect(modes).not.toContain('pay');
  });

  it('does NOT include "pay" when balance is 0 and status is READY', () => {
    const modes = getAvailableModes('READY', 0);
    expect(modes).not.toContain('pay');
  });
});

// --- Requirement 6.5: Hide "pay" when status is DELIVERED or CANCELLED ---

describe('getAvailableModes — hides "pay" for DELIVERED/CANCELLED (Req 6.5)', () => {
  it('does NOT include "pay" when status is DELIVERED even with balance > 0', () => {
    const modes = getAvailableModes('DELIVERED', 50000);
    expect(modes).not.toContain('pay');
  });

  it('does NOT include "pay" when status is CANCELLED even with balance > 0', () => {
    const modes = getAvailableModes('CANCELLED', 30000);
    expect(modes).not.toContain('pay');
  });
});

// --- Positive case: "pay" IS included for active statuses with balance > 0 ---

describe('getAvailableModes — includes "pay" for active orders with balance (Reqs 6.4, 6.5 inverse)', () => {
  it('includes "pay" when status is IN_PROGRESS and balance > 0', () => {
    const modes = getAvailableModes('IN_PROGRESS', 25000);
    expect(modes).toContain('pay');
  });

  it('includes "pay" when status is RECEIVED and balance > 0', () => {
    const modes = getAvailableModes('RECEIVED', 15000);
    expect(modes).toContain('pay');
  });

  it('includes "pay" when status is READY and balance > 0', () => {
    const modes = getAvailableModes('READY', 40000);
    expect(modes).toContain('pay');
  });
});
