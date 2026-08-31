/**
 * Unit tests for qr-mode-selector.js - selectDefaultMode, getAvailableModes,
 * setUserOverride, shouldAutoSwitch, resetOverrideOnPhaseChange, and getPhase functions.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectDefaultMode,
  getAvailableModes,
  setUserOverride,
  shouldAutoSwitch,
  resetOverrideOnPhaseChange,
  getPhase
} from '../public/js/qr-mode-selector.js';

describe('selectDefaultMode', () => {
  it('returns "track" for RECEIVED status', () => {
    expect(selectDefaultMode('RECEIVED', 0)).toBe('track');
    expect(selectDefaultMode('RECEIVED', 50000)).toBe('track');
  });

  it('returns "track" for IN_PROGRESS status', () => {
    expect(selectDefaultMode('IN_PROGRESS', 0)).toBe('track');
    expect(selectDefaultMode('IN_PROGRESS', 70000)).toBe('track');
  });

  it('returns "pickup" for READY status', () => {
    expect(selectDefaultMode('READY', 0)).toBe('pickup');
    expect(selectDefaultMode('READY', 30000)).toBe('pickup');
  });

  it('returns "review" for DELIVERED status', () => {
    expect(selectDefaultMode('DELIVERED', 0)).toBe('review');
    expect(selectDefaultMode('DELIVERED', 10000)).toBe('review');
  });

  it('returns "track" for CANCELLED status', () => {
    expect(selectDefaultMode('CANCELLED', 0)).toBe('track');
    expect(selectDefaultMode('CANCELLED', 25000)).toBe('track');
  });

  it('returns "track" for unknown/invalid status as fallback', () => {
    expect(selectDefaultMode('UNKNOWN', 0)).toBe('track');
    expect(selectDefaultMode('', 0)).toBe('track');
  });
});


describe('getAvailableModes', () => {
  it('always returns the default mode as the first element', () => {
    expect(getAvailableModes('RECEIVED', 0)[0]).toBe('track');
    expect(getAvailableModes('IN_PROGRESS', 0)[0]).toBe('track');
    expect(getAvailableModes('READY', 0)[0]).toBe('pickup');
    expect(getAvailableModes('DELIVERED', 0)[0]).toBe('review');
    expect(getAvailableModes('CANCELLED', 0)[0]).toBe('track');
  });

  it('includes "pay" when balance > 0 and status is not DELIVERED or CANCELLED', () => {
    expect(getAvailableModes('RECEIVED', 50000)).toContain('pay');
    expect(getAvailableModes('IN_PROGRESS', 70000)).toContain('pay');
    expect(getAvailableModes('READY', 30000)).toContain('pay');
  });

  it('does NOT include "pay" when balance is 0', () => {
    expect(getAvailableModes('RECEIVED', 0)).not.toContain('pay');
    expect(getAvailableModes('READY', 0)).not.toContain('pay');
    expect(getAvailableModes('DELIVERED', 0)).not.toContain('pay');
    expect(getAvailableModes('CANCELLED', 0)).not.toContain('pay');
  });

  it('does NOT include "pay" when status is DELIVERED even with balance > 0', () => {
    expect(getAvailableModes('DELIVERED', 50000)).not.toContain('pay');
  });

  it('does NOT include "pay" when status is CANCELLED even with balance > 0', () => {
    expect(getAvailableModes('CANCELLED', 10000)).not.toContain('pay');
  });

  it('includes "track" as additional mode when status is READY', () => {
    const modes = getAvailableModes('READY', 0);
    expect(modes[0]).toBe('pickup');
    expect(modes).toContain('track');
  });

  it('returns correct full set for READY with balance > 0', () => {
    const modes = getAvailableModes('READY', 30000);
    expect(modes[0]).toBe('pickup');
    expect(modes).toContain('pay');
    expect(modes).toContain('track');
    expect(modes.length).toBe(3);
  });

  it('returns only default mode for RECEIVED with zero balance', () => {
    const modes = getAvailableModes('RECEIVED', 0);
    expect(modes).toEqual(['track']);
  });

  it('returns only default mode for DELIVERED with zero balance', () => {
    const modes = getAvailableModes('DELIVERED', 0);
    expect(modes).toEqual(['review']);
  });
});


describe('getPhase', () => {
  it('maps RECEIVED to "processing"', () => {
    expect(getPhase('RECEIVED')).toBe('processing');
  });

  it('maps IN_PROGRESS to "processing"', () => {
    expect(getPhase('IN_PROGRESS')).toBe('processing');
  });

  it('maps READY to "ready"', () => {
    expect(getPhase('READY')).toBe('ready');
  });

  it('maps DELIVERED to "done"', () => {
    expect(getPhase('DELIVERED')).toBe('done');
  });

  it('maps CANCELLED to "cancelled"', () => {
    expect(getPhase('CANCELLED')).toBe('cancelled');
  });

  it('returns undefined for unknown statuses', () => {
    expect(getPhase('UNKNOWN')).toBeUndefined();
  });
});


describe('setUserOverride and shouldAutoSwitch', () => {
  beforeEach(() => {
    // Reset state before each test
    setUserOverride(false);
  });

  it('shouldAutoSwitch returns true by default (no override)', () => {
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('shouldAutoSwitch returns false after setUserOverride(true)', () => {
    setUserOverride(true);
    expect(shouldAutoSwitch()).toBe(false);
  });

  it('shouldAutoSwitch returns true after setUserOverride(false)', () => {
    setUserOverride(true);
    setUserOverride(false);
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('setUserOverride coerces truthy values to boolean', () => {
    setUserOverride(1);
    expect(shouldAutoSwitch()).toBe(false);

    setUserOverride(0);
    expect(shouldAutoSwitch()).toBe(true);
  });
});


describe('resetOverrideOnPhaseChange', () => {
  beforeEach(() => {
    // Start with override set
    setUserOverride(true);
  });

  it('does NOT reset override when transitioning within same phase (RECEIVED → IN_PROGRESS)', () => {
    resetOverrideOnPhaseChange('RECEIVED', 'IN_PROGRESS');
    expect(shouldAutoSwitch()).toBe(false);
  });

  it('does NOT reset override when transitioning within same phase (IN_PROGRESS → RECEIVED)', () => {
    resetOverrideOnPhaseChange('IN_PROGRESS', 'RECEIVED');
    expect(shouldAutoSwitch()).toBe(false);
  });

  it('resets override when transitioning to a different phase (RECEIVED → READY)', () => {
    resetOverrideOnPhaseChange('RECEIVED', 'READY');
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('resets override when transitioning to a different phase (IN_PROGRESS → READY)', () => {
    resetOverrideOnPhaseChange('IN_PROGRESS', 'READY');
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('resets override when transitioning to a different phase (READY → DELIVERED)', () => {
    resetOverrideOnPhaseChange('READY', 'DELIVERED');
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('resets override when transitioning to a different phase (RECEIVED → CANCELLED)', () => {
    resetOverrideOnPhaseChange('RECEIVED', 'CANCELLED');
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('resets override when transitioning to a different phase (READY → CANCELLED)', () => {
    resetOverrideOnPhaseChange('READY', 'CANCELLED');
    expect(shouldAutoSwitch()).toBe(true);
  });

  it('does NOT reset override when status stays the same (READY → READY)', () => {
    resetOverrideOnPhaseChange('READY', 'READY');
    expect(shouldAutoSwitch()).toBe(false);
  });
});
