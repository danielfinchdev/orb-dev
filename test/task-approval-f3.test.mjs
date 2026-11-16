import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsApproval, countApprovals } from '../src/ui/lib/task-approval.js';

test('needsApproval: awaiting approval or held, nothing else', () => {
  assert.equal(needsApproval({ status: 'awaiting_approval' }), true);
  assert.equal(needsApproval({ status: 'done', held: { reasons: 'x' } }), true);
  for (const status of ['queued', 'running', 'done', 'failed', 'blocked', 'cancelled', 'limited']) assert.equal(needsApproval({ status }), false, status);
  assert.equal(needsApproval(null), false);
  assert.equal(needsApproval(undefined), false);
});

test('countApprovals counts with the same rule', () => {
  assert.equal(countApprovals([{ status: 'awaiting_approval' }, { status: 'done', held: {} }, { status: 'running' }]), 2);
  assert.equal(countApprovals(undefined), 0);
});
