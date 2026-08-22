import { describe, it, expect } from 'vitest';
import { validateStatusInFlow, validateStatusTransition } from '../netlify/functions/_validators.js';

const parkingFlow = [
  { status_key: 'ENTRY', display_label: 'Ingreso' },
  { status_key: 'ACTIVE', display_label: 'Activo' },
  { status_key: 'EXIT', display_label: 'Salida' },
];

const laundryFlow = [
  { status_key: 'RECEIVED', display_label: 'Recibido' },
  { status_key: 'IN_PROGRESS', display_label: 'En proceso' },
  { status_key: 'READY', display_label: 'Listo' },
  { status_key: 'DELIVERED', display_label: 'Entregado' },
];

describe('validateStatusInFlow', () => {
  it('accepts a status that exists in the flow (exact case)', () => {
    const result = validateStatusInFlow('ENTRY', parkingFlow);
    expect(result).toEqual({ valid: true, value: 'ENTRY' });
  });

  it('accepts a status with case-insensitive matching', () => {
    const result = validateStatusInFlow('entry', parkingFlow);
    expect(result).toEqual({ valid: true, value: 'ENTRY' });
  });

  it('accepts mixed case', () => {
    const result = validateStatusInFlow('Active', parkingFlow);
    expect(result).toEqual({ valid: true, value: 'ACTIVE' });
  });

  it('rejects a status not in the flow', () => {
    const result = validateStatusInFlow('UNKNOWN', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Status must be one of: ENTRY, ACTIVE, EXIT. Received: 'UNKNOWN'");
  });

  it('rejects null status', () => {
    const result = validateStatusInFlow(null, parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Status is required and must be a string');
  });

  it('rejects empty status flow', () => {
    const result = validateStatusInFlow('ENTRY', []);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Status flow configuration is required');
  });

  it('returns the canonical status_key from the flow', () => {
    const result = validateStatusInFlow('in_progress', laundryFlow);
    expect(result.value).toBe('IN_PROGRESS');
  });
});

describe('validateStatusTransition', () => {
  it('allows transition to the next sequential step', () => {
    const result = validateStatusTransition('ENTRY', 'ACTIVE', parkingFlow);
    expect(result).toEqual({ valid: true });
  });

  it('allows transition to CANCELLED from any status', () => {
    const result = validateStatusTransition('ENTRY', 'CANCELLED', parkingFlow);
    expect(result).toEqual({ valid: true });
  });

  it('allows CANCELLED from middle of flow', () => {
    const result = validateStatusTransition('ACTIVE', 'CANCELLED', parkingFlow);
    expect(result).toEqual({ valid: true });
  });

  it('allows CANCELLED from last status', () => {
    const result = validateStatusTransition('EXIT', 'CANCELLED', parkingFlow);
    expect(result).toEqual({ valid: true });
  });

  it('rejects skipping a step', () => {
    const result = validateStatusTransition('ENTRY', 'EXIT', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot transition from ENTRY to EXIT. Next valid: ACTIVE');
  });

  it('rejects going backward', () => {
    const result = validateStatusTransition('ACTIVE', 'ENTRY', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot transition from ACTIVE to ENTRY. Next valid: EXIT');
  });

  it('rejects transition to the same status', () => {
    const result = validateStatusTransition('ACTIVE', 'ACTIVE', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot transition from ACTIVE to ACTIVE. Next valid: EXIT');
  });

  it('rejects transition when current status is not in flow', () => {
    const result = validateStatusTransition('UNKNOWN', 'ACTIVE', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Received: 'UNKNOWN'");
  });

  it('rejects transition when target status is not in flow', () => {
    const result = validateStatusTransition('ENTRY', 'UNKNOWN', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Received: 'UNKNOWN'");
  });

  it('handles case-insensitive current and target', () => {
    const result = validateStatusTransition('entry', 'active', parkingFlow);
    expect(result).toEqual({ valid: true });
  });

  it('shows CANCELLED as next valid when at last step', () => {
    const result = validateStatusTransition('EXIT', 'ENTRY', parkingFlow);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot transition from EXIT to ENTRY. Next valid: CANCELLED');
  });

  it('rejects with empty status flow', () => {
    const result = validateStatusTransition('ENTRY', 'ACTIVE', []);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Status flow configuration is required');
  });
});
