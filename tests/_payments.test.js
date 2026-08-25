/**
 * Unit tests for the _payments.js shared module.
 * Validates: Requirements 4, 5
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'crypto';
import {
  verifyWompiSignature,
  verifyBoldSignature,
  createWompiCheckout,
  createBoldLink
} from '../netlify/functions/_payments.js';

describe('verifyWompiSignature', () => {
  const integritySecret = 'test_integrity_secret_2024';

  function buildValidWompiEvent(overrides = {}) {
    const ref = overrides.reference || 'order-ref-001';
    const amount = overrides.amount_in_cents || 5000000;
    const currency = overrides.currency || 'COP';
    const status = overrides.status || 'APPROVED';

    const concatenated = `${ref}${amount}${currency}${status}${integritySecret}`;
    const checksum = createHash('sha256').update(concatenated).digest('hex');

    return {
      data: {
        transaction: {
          reference: ref,
          amount_in_cents: amount,
          currency,
          status
        }
      },
      signature: { checksum }
    };
  }

  it('returns valid: true for a correctly signed event', () => {
    const event = buildValidWompiEvent();
    const result = verifyWompiSignature(event, integritySecret);
    expect(result.valid).toBe(true);
  });

  it('returns valid: false for an incorrect checksum', () => {
    const event = buildValidWompiEvent();
    event.signature.checksum = 'deadbeefdeadbeefdeadbeef';
    const result = verifyWompiSignature(event, integritySecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  it('returns valid: false when signature checksum is missing', () => {
    const event = buildValidWompiEvent();
    delete event.signature;
    const result = verifyWompiSignature(event, integritySecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing signature');
  });

  it('returns valid: false when event structure is invalid', () => {
    const result = verifyWompiSignature({}, integritySecret);
    expect(result.valid).toBe(false);
  });

  it('returns valid: false when integrity secret is missing', () => {
    const event = buildValidWompiEvent();
    const result = verifyWompiSignature(event, '');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('validates with different transaction statuses', () => {
    for (const status of ['APPROVED', 'DECLINED', 'VOIDED', 'PENDING']) {
      const event = buildValidWompiEvent({ status });
      const result = verifyWompiSignature(event, integritySecret);
      expect(result.valid).toBe(true);
    }
  });
});

describe('verifyBoldSignature', () => {
  const boldSecret = 'bold_webhook_secret_key_2024';

  function buildValidBoldEvent(body) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const signature = createHmac('sha256', boldSecret).update(rawBody).digest('hex');
    return {
      headers: { 'x-bold-signature': signature },
      body: rawBody
    };
  }

  it('returns valid: true for a correctly signed event', () => {
    const payload = { transaction_id: 'tx-123', status: 'APPROVED', amount: 50000 };
    const event = buildValidBoldEvent(payload);
    const result = verifyBoldSignature(event, boldSecret);
    expect(result.valid).toBe(true);
  });

  it('returns valid: false for an incorrect signature', () => {
    const payload = { transaction_id: 'tx-123', status: 'APPROVED' };
    const event = buildValidBoldEvent(payload);
    event.headers['x-bold-signature'] = 'invalid_signature_hex';
    const result = verifyBoldSignature(event, boldSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid HMAC');
  });

  it('returns valid: false when x-bold-signature header is missing', () => {
    const event = { headers: {}, body: '{"test": true}' };
    const result = verifyBoldSignature(event, boldSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing x-bold-signature');
  });

  it('returns valid: false when body is missing', () => {
    const event = { headers: { 'x-bold-signature': 'something' }, body: '' };
    const result = verifyBoldSignature(event, boldSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing request body');
  });

  it('returns valid: false when bold secret is missing', () => {
    const event = { headers: { 'x-bold-signature': 'something' }, body: '{}' };
    const result = verifyBoldSignature(event, '');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

describe('createWompiCheckout', () => {
  const publicKey = 'pub_test_abc123';

  it('builds a valid checkout URL with all required params', () => {
    const result = createWompiCheckout('order-ref-001', 5000000, 'https://example.com/return', publicKey);

    expect(result.url).toContain('https://checkout.wompi.co/p/');
    expect(result.url).toContain('public-key=pub_test_abc123');
    expect(result.url).toContain('currency=COP');
    expect(result.url).toContain('amount-in-cents=5000000');
    expect(result.url).toContain('reference=order-ref-001');
    expect(result.url).toContain('redirect-url=');
    expect(result.reference).toBe('order-ref-001');
  });

  it('throws when public key is missing', () => {
    expect(() => createWompiCheckout('ref', 100000, 'https://x.com', '')).toThrow('not configured');
  });

  it('throws when required params are missing', () => {
    expect(() => createWompiCheckout('', 100000, 'https://x.com', publicKey)).toThrow('required');
  });

  it('rounds amount to integer cents', () => {
    const result = createWompiCheckout('ref-x', 1234567.89, 'https://x.com/r', publicKey);
    expect(result.url).toContain('amount-in-cents=1234568');
  });
});

describe('createBoldLink', () => {
  it('throws when API key is missing', async () => {
    await expect(createBoldLink('ref', 50000, 'desc', '')).rejects.toThrow('not configured');
  });

  it('throws when required params are missing', async () => {
    await expect(createBoldLink('', 50000, 'desc', 'key')).rejects.toThrow('required');
  });
});
