import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRebaseLegacyOperation, hasUnresolvedConflict, validAuthoritativeRecovery } from './worker.js';

describe('district sync conflict guard', () => {
  it('keeps reconciliation stopped while the state is marked as conflicted', () => {
    assert.equal(hasUnresolvedConflict({ mode: 'conflict' }, 0), true);
  });

  it('keeps reconciliation stopped while a conflicted operation remains', () => {
    assert.equal(hasUnresolvedConflict({ mode: 'primary' }, 1), true);
  });

  it('allows reconciliation when no conflict is recorded', () => {
    assert.equal(hasUnresolvedConflict({ mode: 'backup' }, 0), false);
  });
});

describe('authoritative recovery bootstrap guard', () => {
  const project = { revision: 200 };

  it('accepts an explicit recovery above the last verified primary revision', () => {
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: 'recovery-200', baseRevision: 100, project }), true);
  });

  it('rejects an implicit, unidentified, or stale recovery', () => {
    assert.equal(validAuthoritativeRecovery({ operationId: 'recovery-200', baseRevision: 100, project }), false);
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: '', baseRevision: 100, project }), false);
    assert.equal(validAuthoritativeRecovery({ authoritativeRecovery: true, operationId: 'recovery-200', baseRevision: 200, project }), false);
  });
});

describe('legacy local change migration guard', () => {
  const shared = { publishedAtIso: '2026-10-21T04:01:10.947Z' };

  it('rebases only a newer legacy edit when the shared queue is empty', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 0), true);
  });

  it('does not rebase an older or equally old legacy edit', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-21T04:01:10.947Z' }, shared, 0), false);
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-20T08:00:00.000Z' }, shared, 0), false);
  });

  it('does not rebase while another shared operation is pending', () => {
    assert.equal(canRebaseLegacyOperation('legacy-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 1), false);
  });

  it('does not rebase a normal operation through the legacy migration path', () => {
    assert.equal(canRebaseLegacyOperation('map-123', { publishedAtIso: '2026-10-22T08:00:00.000Z' }, shared, 0), false);
  });
});
