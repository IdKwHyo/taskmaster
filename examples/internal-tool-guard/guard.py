"""Offline internal-tool experiment; fake provider, no credentials or network."""
from dataclasses import dataclass
import hashlib
import json
import sqlite3


def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class Context:
    # Supplied by the authenticated server, never from model-generated arguments.
    tenant: str
    actor: str
    scopes: frozenset


class FakeSlack:
    """Simulates a provider with durable, payload-bound idempotency."""
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE posts (key TEXT PRIMARY KEY, body TEXT)')
        self.calls = 0
        self.outage = False
        self.lose_ack = False

    def send(self, key, payload):
        self.calls += 1
        if self.outage:
            raise TimeoutError('provider unavailable')
        body = json.dumps(payload, sort_keys=True)
        old = self.db.execute('SELECT body FROM posts WHERE key=?', (key,)).fetchone()
        if old and old[0] != body:
            raise ValueError('idempotency conflict')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO posts VALUES (?,?)', (key, body))
        if self.lose_ack:
            self.lose_ack = False
            raise TimeoutError('response lost after commit')
        return {'verified': self.db.execute('SELECT body FROM posts WHERE key=?', (key,)).fetchone()[0] == body}

    @property
    def side_effects(self):
        return self.db.execute('SELECT COUNT(*) FROM posts').fetchone()[0]


class Guard:
    def __init__(self, provider, path=':memory:'):
        self.provider = provider
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS approvals (tenant TEXT, actor TEXT, digest TEXT, PRIMARY KEY (tenant,actor,digest))')
        self.db.execute('CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, digest TEXT, done INTEGER)')
        self.db.execute('CREATE TABLE IF NOT EXISTS audit (request_key TEXT, outcome TEXT)')

    def approve(self, context, request_id, payload):
        # Demo-only stand-in for a separate authenticated human approval service.
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO approvals VALUES (?,?,?)',
                            (context.tenant, context.actor, fingerprint([request_id, payload])))

    def run(self, request_id, payload, context):
        key = fingerprint([context.tenant, context.actor, request_id if isinstance(request_id, str) else 'invalid-request'])
        def finish(status):
            with self.db:
                # Store no message text, user tokens or exception strings.
                self.db.execute('INSERT INTO audit VALUES (?,?)', (key, status))
            return status

        if (not isinstance(request_id, str) or not 1 <= len(request_id) <= 100
            or not isinstance(payload, dict)
            or set(payload) != {'channel', 'text'}
            or payload.get('channel') not in ('it-help', 'finance')
            or not isinstance(payload.get('text'), str)
            or not 1 <= len(payload['text'].strip()) <= 500):
            return finish('schema_rejected')
        if 'slack:write:' + payload['channel'] not in context.scopes:
            return finish('permission_denied')
        digest = fingerprint(payload)
        approved = self.db.execute('SELECT 1 FROM approvals WHERE tenant=? AND actor=? AND digest=?',
                                   (context.tenant, context.actor, fingerprint([request_id, payload]))).fetchone()
        if not approved:
            return finish('approval_required')
        # Transaction plus a unique key handles concurrent request reservation.
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO requests VALUES (?,?,0)', (key, digest))
        old_digest, done = self.db.execute('SELECT digest,done FROM requests WHERE key=?', (key,)).fetchone()
        if old_digest != digest:
            return finish('idempotency_conflict')
        if done:
            return finish('completed_cached')
        for _ in range(2):
            try:
                result = self.provider.send(key, payload)
            except TimeoutError:
                continue
            if not isinstance(result, dict) or result.get('verified') is not True:
                return finish('verification_failed')
            with self.db:
                self.db.execute('UPDATE requests SET done=1 WHERE key=?', (key,))
            return finish('completed')
        return finish('unknown_needs_reconciliation')


def baseline(provider, request_id, payload, context):
    """Deliberately minimal send+retry script; a comparison, not an LLM baseline."""
    for attempt in range(2):
        try:
            # No stable provider key, schema, permissions or approval checks.
            provider.send(str(provider.calls) + '-' + str(attempt), payload)
            return 'completed'
        except TimeoutError:
            pass
    return 'unknown_needs_reconciliation'


def experiment():
    rows = []
    cases = ('normal', 'wrong_schema', 'no_permission', 'no_approval',
             'duplicate_delivery', 'lost_ack', 'changed_after_approval', 'outage')
    for case in cases:
        for mode in ('baseline', 'guarded'):
            provider = FakeSlack()
            guard = Guard(provider)
            context = Context('demo', 'alice', frozenset({'slack:write:it-help'}))
            payload = {'channel': 'it-help', 'text': 'Deployment is ready for review.'}
            if case != 'no_approval':
                guard.approve(context, 'request-1', payload)
            if case == 'wrong_schema':
                payload = {**payload, 'approved': True}
            if case == 'no_permission':
                context = Context('demo', 'alice', frozenset())
            if case == 'changed_after_approval':
                payload['text'] = 'A different write that was never approved.'
            provider.lose_ack = case == 'lost_ack'
            provider.outage = case == 'outage'
            execute = guard.run if mode == 'guarded' else lambda rid, data, ctx: baseline(provider, rid, data, ctx)
            status = execute('request-1', payload, context)
            if case == 'duplicate_delivery':
                status = execute('request-1', payload, context)
            rows.append(dict(case=case, mode=mode, status=status,
                             provider_calls=provider.calls, side_effects=provider.side_effects))
    return rows


if __name__ == '__main__':
    print(json.dumps(experiment(), indent=2))
