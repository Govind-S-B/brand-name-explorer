import concurrent.futures
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import Mock, patch

import domain_lookup as d
import name_generator as g


class LookupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'domain_cache.json'
        self.dns = patch.object(d.DohResolver, 'get', return_value=d.DnsResult('no_ns', 300)).start()
        self.addCleanup(patch.stopall)

    def lookup(self, **kwargs):
        kwargs.setdefault('dns', False)
        lookup = d.DomainLookup(self.path, **kwargs)
        self.addCleanup(lookup.close)
        return lookup

    def test_legacy_migration_is_once_and_keeps_json(self):
        original = json.dumps({'old.com': {'status':'registered', 'checked_at':'2020'}})
        self.path.write_text(original)
        lookup = self.lookup()
        self.assertEqual(lookup.get('old.com')[2], 'cache')
        self.assertEqual(self.path.read_text(), original)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')):
            lookup.get('old.com', fresh_since='9999')
        lookup.close()
        self.assertEqual(self.lookup().get('old.com')[1], 'possibly available')
        self.assertEqual(self.path.read_text(), original)

    def test_invalid_migration_rejects_and_can_recover(self):
        self.path.write_text('{"bad.com": {"status": "unknown"}}')
        with self.assertRaises(ValueError):
            self.lookup()
        self.path.write_text('{}')
        self.assertEqual(self.lookup().cache, {})

    def test_concurrent_completion_keeps_order_and_deduplicates(self):
        lookup = self.lookup(workers=4)
        second_done = threading.Event()
        finished = []
        def check(domain):
            if domain == 'alpha.com':
                self.assertTrue(second_done.wait(2))
            if domain == 'bravo.com':
                second_done.set()
            finished.append(domain)
            return d.Result(status='registered')
        domains = ['alpha.com','bravo.com','alpha.com','charlie.com']
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', side_effect=check) as request:
            rows = list(lookup.many(domains))
        self.assertEqual([r[0] for r in rows], domains)
        self.assertEqual(request.call_count, 3)
        self.assertLess(finished.index('bravo.com'), finished.index('alpha.com'))
        self.assertEqual(len(d.load_cache(self.path)), 3)

    def test_later_success_cached_but_failure_does_not_advance_session(self):
        class Space:
            settings = {'test':'concurrent-resume'}
            capacity = 4
            def names(self):
                return iter(['alpha','bravo','charlie','delta'])
        later = threading.Event()
        def check(domain):
            if domain == 'charlie.com':
                later.set()
            if domain == 'bravo.com':
                self.assertTrue(later.wait(2))
                return d.Result(error='temporary', retryable=True)
            return d.Result(status='possibly available')
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RateLimiter, 'pause'), \
             patch.object(d.RdapClient, 'get', side_effect=check):
            session = g.BrowseSession(self.path, space=Space(), workers=3)
            self.addCleanup(session.lookup.close)
            with self.assertRaises(d.LookupFailure):
                list(session.page(3,1))
        self.assertEqual(session.state['cursor'], 1)
        self.assertNotIn('bravo.com', d.load_cache(self.path))
        self.assertIn('charlie.com', d.load_cache(self.path))
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')) as check:
            resumed = g.BrowseSession(self.path, space=Space(), workers=1)
            self.addCleanup(resumed.lookup.close)
            rows = list(resumed.page(3,1))
        self.assertEqual([r[0] for r in rows], ['alpha.com','bravo.com','charlie.com'])
        check.assert_called_once_with('bravo.com')

    def test_lookahead_stays_bounded_and_close_cancels_cooldown(self):
        lookup = self.lookup(workers=3)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='registered')) as check:
            stream = lookup.many((f'name{i}.com' for i in range(100000)))
            next(stream)
            stream.close()
        self.assertLessEqual(check.call_count, 1024)
        limiter = d.RateLimiter(4)
        limiter.pause(3600, True)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            waiting = pool.submit(limiter.acquire)
            limiter.stop()
            with self.assertRaises(concurrent.futures.CancelledError):
                waiting.result(timeout=1)

    def test_retry_after_and_terminal_errors(self):
        self.assertEqual(d.retry_after_seconds('120'), 120)
        self.assertEqual(d.retry_after_seconds('nonsense'), 0)
        future = format_datetime(datetime.now(timezone.utc)+timedelta(seconds=60))
        self.assertGreater(d.retry_after_seconds(future), 58)
        response = d.interpret_response(429, b'', '120')
        lookup = self.lookup()
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RateLimiter, 'pause') as pause, \
             patch.object(d.RdapClient, 'get', side_effect=[response, d.Result(status='registered')]):
            self.assertEqual(lookup.get('example.com')[1], 'registered')
        self.assertGreaterEqual(pause.call_args.args[0], 120)
        self.assertTrue(pause.call_args.args[1])
        other = self.lookup()
        self.assertGreater(other.limiter.cooldown, time.monotonic()+115)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.interpret_response(403, b'')) as check:
            with self.assertRaisesRegex(d.LookupFailure, 'after 1 attempts'):
                lookup.get('blocked.com')
        self.assertEqual(check.call_count, 1)
        self.assertNotIn('blocked.com', lookup.cache)

    def test_rate_adapts_and_requests_share_pacing(self):
        limiter = d.RateLimiter(40)
        self.assertEqual(limiter.rate, 16)
        for _ in range(20):
            limiter.success()
        self.assertEqual(limiter.rate, 20)
        limiter.pause(10, True)
        self.assertEqual(limiter.rate, 10)
        self.assertGreater(limiter.cooldown, time.monotonic()+9)
        limiter = d.RateLimiter(20)
        limiter.rate = 20
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            times = list(pool.map(lambda _: (limiter.acquire(), time.monotonic())[1], range(3)))
        times.sort()
        self.assertGreaterEqual(times[-1]-times[0], .085)

    def test_http_connections_reused_and_bad_404_not_available(self):
        response = Mock(status=200)
        response.read.return_value = b'{"ldhName":"example.com"}'
        response.getheader.return_value = None
        with patch.object(d.http.client, 'HTTPSConnection') as make:
            make.return_value.getresponse.return_value = response
            client = d.RdapClient()
            self.assertEqual(client.get('example.com').status, 'registered')
            self.assertEqual(client.get('example.com').status, 'registered')
            self.assertEqual(make.call_count, 1)
            client.close()
        self.assertFalse(d.interpret_response(404, b'proxy not found').status)
        self.assertFalse(d.interpret_response(404, b'').status)
        self.assertEqual(d.interpret_response(404, b'', content_type='application/rdap+json').status,
                         'possibly available')
        self.assertFalse(d.interpret_response(200, b'{"ldhName":"other.com"}', domain='example.com').status)

    def test_stale_connection_reconnects_without_backoff(self):
        response = Mock(status=200)
        response.read.return_value = b'{"ldhName":"example.com"}'
        response.getheader.return_value = None
        with patch.object(d.http.client, 'HTTPSConnection') as make:
            make.return_value.getresponse.side_effect = [response, d.http.client.RemoteDisconnected(), response, response]
            client = d.RdapClient()
            self.assertEqual(client.get('example.com').status, 'registered')
            self.assertTrue(client.get('example.com').reconnect)
            self.assertFalse(client.reuse_supported)
            self.assertEqual(client.get('example.com').status, 'registered')
            self.assertEqual(client.get('example.com').status, 'registered')
            self.assertEqual(make.call_count, 3)
            client.close()
        lookup = self.lookup()
        with patch.object(d.RateLimiter, 'reserve', return_value=0) as acquire, patch.object(d.RateLimiter, 'pause') as pause, \
             patch.object(d.RdapClient, 'get', side_effect=[d.Result(error='stale', retryable=True, reconnect=True),
                                                          d.Result(status='registered')]):
            lookup.get('example.com')
            pause.assert_not_called()
            self.assertEqual(acquire.call_count, 2)

    def test_connection_retry_does_not_pause_other_domains(self):
        lookup = self.lookup(workers=2)
        with patch.object(d.RateLimiter, 'reserve', return_value=0) as acquire, patch.object(d.RateLimiter, 'pause') as pause, \
             patch.object(d.RdapClient, 'get', side_effect=[d.Result(error='network', retryable=True),
                                                          d.Result(status='registered')]):
            lookup.get('example.com')
        pause.assert_not_called()
        self.assertGreater(acquire.call_args_list[-1].args[0], acquire.call_args_list[0].args[0])
        self.assertTrue(d.interpret_response(503, b'').provider_failure)

    def test_reorder_window_can_fill_while_first_domain_is_slow(self):
        lookup = self.lookup(workers=2)
        fourth_finished = threading.Event()
        def check(domain):
            if domain == 'first.com':
                self.assertTrue(fourth_finished.wait(2))
            if domain == 'fourth.com':
                fourth_finished.set()
            return d.Result(status='registered')
        domains = ['first.com','second.com','third.com','fourth.com']
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', side_effect=check):
            rows = list(lookup.many(domains))
        self.assertEqual([r[0] for r in rows], domains)

    def test_retry_timer_releases_the_only_worker(self):
        lookup = self.lookup(workers=1)
        order = []
        def check(domain):
            order.append(domain)
            if domain == 'alpha.com' and order.count(domain) == 1:
                return d.Result(error='connection reset', retryable=True)
            return d.Result(status='registered')
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', side_effect=check):
            futures = lookup._submit_many(['alpha.com', 'bravo.com'])
            for future in futures:
                self.assertEqual(future.result(timeout=2)[1], 'registered')
        self.assertEqual(order, ['alpha.com', 'bravo.com', 'alpha.com'])

    def test_slow_first_request_does_not_stall_later_dispatch(self):
        lookup = self.lookup(workers=2)
        later = threading.Event()
        def check(domain):
            if domain == 'name0.com':
                self.assertTrue(later.wait(2))
            if domain == 'name49.com':
                later.set()
            return d.Result(status='registered')
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', side_effect=check):
            rows = list(lookup.many(f'name{i}.com' for i in range(60)))
        self.assertEqual([r[0] for r in rows], [f'name{i}.com' for i in range(60)])

    def test_warm_batch_needs_no_transport(self):
        lookup = self.lookup()
        with lookup.db:
            lookup.db.executemany('INSERT INTO domains VALUES (?, ?, ?)',
                                  [(f'name{i}.com', 'registered', '2026') for i in range(600)])
        with patch.object(d, 'RdapClient', side_effect=AssertionError('warm cache created transport')):
            rows = list(lookup.many(f'name{i}.com' for i in range(600)))
        self.assertEqual(len(rows), 600)
        self.assertEqual(lookup.requests, 0)
        self.assertIsNone(lookup.dispatcher)

    def test_legacy_session_migrates_without_rewriting_original(self):
        class Space:
            settings = {'test': 'legacy-progress'}
            capacity = 3
            def names(self):
                return iter(['alpha', 'bravo', 'charlie'])
        session = g.BrowseSession(self.path, space=Space())
        session.lookup.close()
        session.progress_path.unlink()
        state = dict(settings=Space.settings, cursor=2, fresh_since=None,
                     matches=[['alpha.com','possibly available','live','2026'],
                              ['bravo.com','possibly available','live','2026']])
        original = json.dumps(state)
        session.path.write_text(original)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')) as check:
            resumed = g.BrowseSession(self.path, space=Space())
            rows = list(resumed.page(3, 1))
        self.assertEqual([r[0] for r in rows], ['alpha.com','bravo.com','charlie.com'])
        self.assertEqual(session.path.read_text(), original)
        check.assert_called_once_with('charlie.com')
        resumed = g.BrowseSession(self.path, space=Space())
        self.addCleanup(resumed.lookup.close)
        self.assertEqual(resumed.state['cursor'], 3)

    def test_filtered_lookahead_never_checks_more_than_needed(self):
        class Space:
            settings = {'test': 'bounded-page'}
            capacity = 1000
            def names(self):
                return (f'name{i}' for i in range(self.capacity))
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')) as check:
            session = g.BrowseSession(self.path, space=Space())
            rows = list(session.page(7, 1))
        self.assertEqual(len(rows), 7)
        self.assertEqual(check.call_count, 7)

    def test_failed_cache_commit_cannot_publish_success(self):
        lookup = self.lookup()
        with lookup.db:
            lookup.db.execute("CREATE TRIGGER refuse_cache BEFORE INSERT ON domains BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        with patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')):
            with self.assertRaisesRegex(d.sqlite3.IntegrityError, 'disk failure'):
                lookup.get('alpha.com')
        self.assertEqual(lookup.cache, {})

    def test_closed_lookup_rejects_new_jobs_without_hanging(self):
        lookup = self.lookup()
        lookup.close()
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            lookup.get('alpha.com')

    def test_stopping_a_paused_stream_wakes_its_consumer(self):
        lookup = self.lookup()
        lookup.limiter.pause(3600)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = pool.submit(lambda: list(lookup.many(['alpha.com', 'bravo.com'])))
            with lookup.condition:
                self.assertTrue(lookup.condition.wait_for(lambda: lookup.dispatcher is not None, timeout=2))
            lookup.limiter.stop()
            with self.assertRaises(concurrent.futures.CancelledError):
                result.result(timeout=2)
        self.assertEqual(lookup.requests, 0)

    def test_dns_is_shared_between_connections_and_refreshed_in_background(self):
        client = d.RdapClient()
        self.addCleanup(client.close)
        address = [(d.socket.AF_INET, d.socket.SOCK_STREAM, 6, '', ('192.0.2.1', 443))]
        with patch.object(d.socket, 'getaddrinfo', return_value=address) as resolve, \
             patch.object(d.RdapClient, '_rank_addresses', side_effect=lambda rows: rows):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: client._resolve(('rdap.verisign.com', 443)), range(20)))
            self.assertTrue(all(row == address for row in results))
            self.assertEqual(resolve.call_count, 1)
        release = threading.Event()
        def slow_dns(*args, **kwargs):
            release.wait(2)
            return address
        client.dns_expires = 0
        with patch.object(d.socket, 'getaddrinfo', side_effect=slow_dns), \
             patch.object(d.RdapClient, '_rank_addresses', side_effect=lambda rows: rows):
            try:
                started = time.monotonic()
                self.assertEqual(client._resolve(('rdap.verisign.com', 443)), address)
                self.assertLess(time.monotonic()-started, .5)
            finally:
                release.set()

    def test_transport_errors_have_a_bounded_longer_recovery_budget(self):
        lookup = self.lookup()
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(error='timeout', retryable=True, network_failure=True)):
            with self.assertRaisesRegex(d.LookupFailure, 'after 6 attempts'):
                lookup.get('alpha.com')
        self.assertEqual(lookup.requests, 6)
        self.assertEqual(lookup.cache, {})

    def test_congestion_reduces_concurrency_but_isolated_errors_do_not(self):
        lookup = self.lookup(workers=32, rate=160)
        good = d.Result(status='registered')
        bad = d.Result(error='timeout', retryable=True, network_failure=True)
        for i in range(128):
            lookup._observe(bad if i % 32 == 0 else good)
        self.assertEqual(lookup.active_limit, 32)
        for _ in range(32):
            lookup._observe(bad)
        self.assertLess(lookup.active_limit, 32)
        self.assertGreater(lookup.congestion_events, 0)
        for _ in range(1024):
            lookup._observe(good)
        self.assertEqual(lookup.active_limit, 32)

    def test_dns_parser_requires_matching_answer_and_question(self):
        question = [{'name': 'alpha.com.', 'type': 2}]
        answer = {'name': 'alpha.com.', 'type': 2, 'TTL': 120, 'data': 'ns.example.net.'}
        def parse(**kwargs):
            return d.interpret_dns(200, json.dumps(dict(Question=question, Status=0, **kwargs)), domain='alpha.com')
        self.assertEqual(parse(Answer=[answer]), d.DnsResult('ns', 120))
        self.assertEqual(parse(Authority=[answer]).outcome, 'no_ns')
        self.assertEqual(parse(Answer=[dict(answer, name='com.')]).outcome, 'no_ns')
        self.assertEqual(parse(Answer=[dict(answer, type=5)]).outcome, 'no_ns')
        self.assertEqual(parse(Answer=[dict(answer, TTL='nan')]).outcome, 'error')
        self.assertEqual(parse(TC=True).outcome, 'error')
        self.assertEqual(d.interpret_dns(200, b'{"Status":3}', domain='alpha.com').outcome, 'error')
        negative = dict(Question=question, Status=3, Authority=[{'type':6, 'TTL':100, 'data':'ns. host. 1 2 3 4 30'}])
        self.assertEqual(d.interpret_dns(200, json.dumps(negative), domain='alpha.com'), d.DnsResult('nxdomain', 30))

    def test_dns_ns_skips_rdap_and_negatives_and_errors_confirm(self):
        lookup = self.lookup(dns=True)
        results = [d.DnsResult('ns', 60), d.DnsResult('nxdomain', 60),
                   d.DnsResult('no_ns', 60), d.DnsResult('error', error='SERVFAIL')]
        self.dns.side_effect = results
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')) as rdap:
            rows = list(lookup.many(['alpha.com', 'bravo.com', 'charlie.com', 'delta.com']))
        self.assertEqual([r[1] for r in rows], ['registered'] + ['possibly available']*3)
        self.assertEqual(rdap.call_count, 3)
        self.assertEqual(lookup.rdap_avoided, 1)
        self.assertEqual(lookup.dns_errors, 1)
        with d.closing(d.sqlite3.connect(lookup.db_path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dns').fetchone()[0], 3)
        self.assertEqual(self.lookup(dns=True).get('alpha.com')[2], 'cache')

    def test_dns_cache_resume_expiry_and_refresh(self):
        lookup = self.lookup(dns=True)
        stamp = datetime.now(timezone.utc).isoformat()
        with lookup.db:
            lookup.db.executemany('INSERT INTO dns VALUES (?,?,?,?)',
                                 [('alpha.com', 'nxdomain', stamp, time.time()+60),
                                  ('bravo.com', 'ns', stamp, time.time()-1)])
        self.dns.return_value = d.DnsResult('ns', 60)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', return_value=d.Result(status='registered')):
            self.assertEqual(lookup.get('alpha.com')[1], 'registered')
            self.assertEqual(lookup.dns_hits, 1)
            self.dns.assert_not_called()
            lookup.get('bravo.com')
            self.assertEqual(self.dns.call_count, 1)
            lookup.get('alpha.com', fresh_since='9999')
            self.assertEqual(self.dns.call_count, 2)
        self.assertEqual(lookup.rdap_avoided, 2)

    def test_dns_and_rdap_have_independent_workers_and_pacing(self):
        lookup = self.lookup(dns=True, workers=1, dns_workers=1)
        lookup.limiter.pause(3600)
        self.dns.return_value = d.DnsResult('ns', 60)
        self.assertEqual(lookup.get('alpha.com')[1], 'registered')
        self.assertEqual(lookup.requests, 0)
        self.assertEqual(lookup.dns_requests, 1)
        lookup.limiter.cooldown = 0
        lookup.dns_limiter.pause(3600)
        with patch.object(d.RdapClient, 'get', return_value=d.Result(status='registered')):
            self.assertEqual(lookup.get('bravo.com')[1], 'registered')
        self.assertEqual(lookup.requests, 1)
        self.assertEqual(lookup.dns_requests, 1)

    def test_dns_throttling_persists_cooldown_and_falls_back(self):
        lookup = self.lookup(dns=True)
        self.dns.return_value = d.DnsResult('error', error='HTTP 429', throttled=True, retry_after=120)
        with patch.object(d.RdapClient, 'get', return_value=d.Result(status='registered')):
            lookup.get('alpha.com')
        self.assertEqual(lookup.dns_throttles, 1)
        self.assertEqual(lookup.requests, 1)
        other = self.lookup(dns=True)
        self.assertGreater(other.dns_limiter.cooldown, time.monotonic()+115)
        self.assertLess(other.limiter.cooldown, time.monotonic())

    def test_slow_dns_does_not_occupy_an_rdap_worker(self):
        lookup = self.lookup(dns=True, workers=1, dns_workers=2)
        later = threading.Event()
        def dns(domain):
            if domain == 'alpha.com':
                self.assertTrue(later.wait(2))
                return d.DnsResult('ns', 60)
            return d.DnsResult('nxdomain', 60)
        self.dns.side_effect = dns
        def rdap(domain):
            later.set()
            return d.Result(status='registered')
        with patch.object(d.RateLimiter, 'reserve', return_value=0), patch.object(d.RdapClient, 'get', side_effect=rdap):
            futures = lookup._submit_many(['alpha.com', 'bravo.com'])
            self.assertEqual([f.result(timeout=2)[1] for f in futures], ['registered', 'registered'])
        self.assertEqual(lookup.requests, 1)

    def test_dns_exception_falls_back_without_caching_error(self):
        lookup = self.lookup(dns=True)
        self.dns.side_effect = OSError('resolver unavailable')
        with patch.object(d.RdapClient, 'get', return_value=d.Result(status='possibly available')):
            self.assertEqual(lookup.get('alpha.com')[1], 'possibly available')
        self.assertEqual(lookup.db.execute('SELECT COUNT(*) FROM dns').fetchone()[0], 0)
        self.assertEqual(lookup.dns_errors, 1)

    def test_dns_deduplication_preserves_duplicate_output_rows(self):
        lookup = self.lookup(dns=True)
        self.dns.return_value = d.DnsResult('ns', 60)
        with patch.object(d.RateLimiter, 'reserve', return_value=0), \
             patch.object(d.RdapClient, 'get', side_effect=AssertionError('DNS positive reached RDAP')):
            rows = list(lookup.many(['alpha.com', 'bravo.com', 'alpha.com']))
        self.assertEqual([r[0] for r in rows], ['alpha.com', 'bravo.com', 'alpha.com'])
        self.assertEqual(self.dns.call_count, 2)
        self.assertEqual(lookup.dns_requests, 2)

    def test_dns_cache_commit_must_succeed_before_registration_is_published(self):
        lookup = self.lookup(dns=True)
        self.dns.return_value = d.DnsResult('ns', 60)
        with lookup.db:
            lookup.db.execute("CREATE TRIGGER refuse_dns BEFORE INSERT ON domains BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        with self.assertRaisesRegex(d.sqlite3.IntegrityError, 'disk failure'):
            lookup.get('alpha.com')
        self.assertEqual(lookup.cache, {})
        self.assertEqual(lookup.db.execute('SELECT COUNT(*) FROM dns').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
