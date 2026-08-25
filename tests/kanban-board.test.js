/**
 * Unit tests for Kanban Board pure logic.
 * Validates: sequential drop policy aligned with backend
 * `_validators.js::validateStatusTransition` and board grouping.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeFlow,
  groupOrdersByStatus,
  getValidDropTargets,
  canDropTo,
  isTerminalStatus
} from '../public/js/kanban-board.js';

const FLOW = [
  { status_key: 'RECEIVED', display_label: 'Recibido' },
  { status_key: 'IN_PROGRESS', display_label: 'En proceso' },
  { status_key: 'READY', display_label: 'Listo' },
  { status_key: 'DELIVERED', display_label: 'Entregado' }
];

describe('normalizeFlow', () => {
  it('returns the flow unchanged when valid', () => {
    expect(normalizeFlow(FLOW)).toEqual(FLOW);
  });

  it('falls back to default laundry flow when empty or invalid', () => {
    const fallback = normalizeFlow([]);
    expect(fallback.length).toBe(4);
    expect(fallback[0].status_key).toBe('RECEIVED');
    expect(normalizeFlow(null).length).toBe(4);
  });

  it('filters out entries without status_key', () => {
    const dirty = [{ status_key: 'A' }, { display_label: 'no key' }, null];
    expect(normalizeFlow(dirty).map(e => e.status_key)).toEqual(['A']);
  });
});

describe('groupOrdersByStatus', () => {
  it('groups orders under their status and includes empty buckets', () => {
    const orders = [
      { id: '1', status: 'RECEIVED' },
      { id: '2', status: 'READY' },
      { id: '3', status: 'READY' }
    ];
    const groups = groupOrdersByStatus(orders, FLOW);
    expect(groups.RECEIVED.map(o => o.id)).toEqual(['1']);
    expect(groups.READY.map(o => o.id)).toEqual(['2', '3']);
    expect(groups.IN_PROGRESS).toEqual([]);
    expect(groups.DELIVERED).toEqual([]);
    expect(Array.isArray(groups.CANCELLED)).toBe(true);
  });

  it('never loses orders with unknown statuses', () => {
    const groups = groupOrdersByStatus([{ id: 'x', status: 'WEIRD' }], FLOW);
    expect(groups.WEIRD.map(o => o.id)).toEqual(['x']);
  });

  it('defaults missing status to first step of the flow', () => {
    const groups = groupOrdersByStatus([{ id: 'y', status: '' }], FLOW);
    expect(groups.RECEIVED.map(o => o.id)).toEqual(['y']);
  });

  it('handles undefined orders list', () => {
    const groups = groupOrdersByStatus(undefined, FLOW);
    Object.values(groups).forEach(list => expect(list).toEqual([]));
  });
});

describe('getValidDropTargets — sequential forward-only policy', () => {
  it('first step can only move to second step or cancel', () => {
    expect(getValidDropTargets('RECEIVED', FLOW)).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });

  it('middle steps only advance one position or cancel', () => {
    expect(getValidDropTargets('IN_PROGRESS', FLOW)).toEqual(['READY', 'CANCELLED']);
    expect(getValidDropTargets('READY', FLOW)).toEqual(['DELIVERED', 'CANCELLED']);
  });

  it('terminal delivered cards can only be cancelled', () => {
    expect(getValidDropTargets('DELIVERED', FLOW)).toEqual(['CANCELLED']);
  });

  it('cancelled cards have no targets', () => {
    expect(getValidDropTargets('CANCELLED', FLOW)).toEqual([]);
  });

  it('unknown statuses can still be cancelled', () => {
    expect(getValidDropTargets('UNKNOWN', FLOW)).toEqual(['CANCELLED']);
  });

  it('respects custom flows of arbitrary length', () => {
    const short = [
      { status_key: 'A' },
      { status_key: 'B' }
    ];
    expect(getValidDropTargets('A', short)).toEqual(['B', 'CANCELLED']);
    expect(getValidDropTargets('B', short)).toEqual(['CANCELLED']);
  });
});

describe('canDropTo', () => {
  it('allows adjacent forward moves and cancel', () => {
    expect(canDropTo('RECEIVED', 'IN_PROGRESS', FLOW)).toBe(true);
    expect(canDropTo('RECEIVED', 'CANCELLED', FLOW)).toBe(true);
  });

  it('rejects skips of two or more columns', () => {
    expect(canDropTo('RECEIVED', 'READY', FLOW)).toBe(false);
    expect(canDropTo('RECEIVED', 'DELIVERED', FLOW)).toBe(false);
  });

  it('rejects backward moves', () => {
    expect(canDropTo('READY', 'RECEIVED', FLOW)).toBe(false);
    expect(canDropTo('DELIVERED', 'IN_PROGRESS', FLOW)).toBe(false);
    expect(canDropTo('DELIVERED', 'READY', FLOW)).toBe(false);
  });

  it('rejects any move originating from CANCELLED', () => {
    expect(canDropTo('CANCELLED', 'RECEIVED', FLOW)).toBe(false);
    expect(canDropTo('CANCELLED', 'CANCELLED', FLOW)).toBe(false);
  });
});

describe('isTerminalStatus', () => {
  it('marks last flow step as terminal', () => {
    expect(isTerminalStatus('DELIVERED', FLOW)).toBe(true);
  });

  it('does not mark intermediate steps as terminal', () => {
    expect(isTerminalStatus('READY', FLOW)).toBe(false);
    expect(isTerminalStatus('RECEIVED', FLOW)).toBe(false);
  });

  it('always marks CANCELLED as terminal', () => {
    expect(isTerminalStatus('CANCELLED', FLOW)).toBe(true);
  });
});
