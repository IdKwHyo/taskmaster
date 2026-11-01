import os
import tempfile
import unittest
from guard import Context, FakeSlack, Guard, experiment


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.provider = FakeSlack()
        self.guard = Guard(self.provider)
        self.ctx = Context('tenant-a', 'alice', frozenset({'slack:write:it-help'}))
        self.payload = {'channel': 'it-help', 'text': 'secret text should stay out of audit'}

    def test_expected_injected_outcomes(self):
        expected = {
            'normal': ('completed', 1), 'wrong_schema': ('schema_rejected', 0),
            'no_permission': ('permission_denied', 0), 'no_approval': ('approval_required', 0),
            'duplicate_delivery': ('completed_cached', 1), 'lost_ack': ('completed', 1),
            'changed_after_approval': ('approval_required', 0),
            'outage': ('unknown_needs_reconciliation', 0),
        }
        for row in experiment():
            if row['mode'] == 'guarded':
                with self.subTest(case=row['case']):
                    self.assertEqual((row['status'], row['side_effects']), expected[row['case']])
                    self.assertLessEqual(row['provider_calls'], 2)

    def test_approval_cannot_cross_tenants_or_actors(self):
        self.guard.approve(self.ctx, 'r', self.payload)
        for other in [Context('tenant-b', 'alice', self.ctx.scopes), Context('tenant-a', 'bob', self.ctx.scopes)]:
            self.assertEqual(self.guard.run('r', self.payload, other), 'approval_required')
        self.assertEqual(self.provider.side_effects, 0)

    def test_changed_payload_cannot_reuse_request_key_even_if_both_approved(self):
        self.guard.approve(self.ctx, 'r', self.payload)
        self.assertEqual(self.guard.run('r', self.payload, self.ctx), 'completed')
        changed = {**self.payload, 'text': 'another approved message'}
        self.guard.approve(self.ctx, 'r', changed)
        self.assertEqual(self.guard.run('r', changed, self.ctx), 'idempotency_conflict')
        self.assertEqual(self.provider.side_effects, 1)

    def test_worker_restart_uses_durable_ledger(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'guard.db')
            first = Guard(self.provider, path)
            first.approve(self.ctx, 'r', self.payload)
            self.assertEqual(first.run('r', self.payload, self.ctx), 'completed')
            first.db.close()
            second = Guard(self.provider, path)
            self.assertEqual(second.run('r', self.payload, self.ctx), 'completed_cached')
            self.assertEqual(self.provider.calls, 1)
            second.db.close()

    def test_no_false_completion_and_no_sensitive_audit_payload(self):
        self.guard.approve(self.ctx, 'r', self.payload)
        self.provider.send = lambda *_: {'verified': False}
        self.assertEqual(self.guard.run('r', self.payload, self.ctx), 'verification_failed')
        audit = str(self.guard.db.execute('SELECT * FROM audit').fetchall())
        self.assertNotIn(self.payload['text'], audit)
        self.assertNotIn('secret', audit)

    def test_invalid_values_do_not_reach_provider(self):
        for bad in [None, [], {'channel': 'finance', 'text': 7},
                    {'channel': 'it-help', 'text': ''}, {'channel': 'it-help', 'text': 'x'*501}]:
            with self.subTest(payload=bad):
                self.assertEqual(self.guard.run('r', bad, self.ctx), 'schema_rejected')
        self.assertEqual(self.provider.calls, 0)

    def test_approval_is_bound_to_request_and_invalid_ids_fail_closed(self):
        self.guard.approve(self.ctx, 'r', self.payload)
        self.assertEqual(self.guard.run('new-r', self.payload, self.ctx), 'approval_required')
        for bad_id in [None, [], object(), '', 'x'*101]:
            self.assertEqual(self.guard.run(bad_id, self.payload, self.ctx), 'schema_rejected')
        self.assertEqual(self.provider.calls, 0)


if __name__ == '__main__':
    unittest.main()
