"""Live .com NS pre-filter and RDAP confirmation, ordered output, durable cache."""

import concurrent.futures
import http.client
import heapq
import itertools
import json
import math
import random
import re
import sqlite3
import socket
import ssl
import threading
import time
from collections import deque
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode

SUCCESS = ('registered', 'possibly available')


class LookupFailure(Exception):
    pass


@dataclass(frozen=True)
class Result:
    status: str = ''
    error: str = ''
    retryable: bool = False
    throttled: bool = False
    retry_after: float = 0
    reconnect: bool = False
    provider_failure: bool = False
    network_failure: bool = False
    phase: str = ''


@dataclass(frozen=True)
class DnsResult:
    outcome: str
    ttl: float = 0
    error: str = ''
    throttled: bool = False
    retry_after: float = 0


def interpret_dns(code, body, retry_after=None, domain='', content_type=''):
    """Only an exact NS answer proves registration; negatives never prove availability."""
    if code != 200:
        return DnsResult('error', error=f'HTTP {code}', throttled=code == 429,
                         retry_after=retry_after_seconds(retry_after))
    try:
        record = json.loads(body)
        questions = record.get('Question', [])
        if not any(q.get('type') == 2 and q.get('name', '').lower().rstrip('.') == domain
                   for q in questions):
            raise ValueError('mismatched DNS question')
        status = record.get('Status')
        if status not in (0, 3) or record.get('TC'):
            raise ValueError(f'DNS status {status} or truncated response')
        answers = record.get('Answer', [])
        ns = [a for a in answers if a.get('type') == 2 and a.get('name', '').lower().rstrip('.') == domain
              and isinstance(a.get('data'), str) and a['data'].strip()]
        if status == 0 and ns:
            ttl = min(float(a['TTL']) for a in ns)
            if not math.isfinite(ttl):
                raise ValueError('invalid DNS TTL')
            return DnsResult('ns', max(0, min(86400, ttl)))
        # SOA authority is negative-cache evidence, never an NS answer for this name.
        ttls = [300]
        for a in record.get('Authority', []):
            if a.get('type') == 6:
                ttls.extend([float(a['TTL']), float(a['data'].split()[-1])])
        ttl = max(0, min(ttls))
        if not math.isfinite(ttl):
            raise ValueError('invalid DNS TTL')
        return DnsResult('nxdomain' if status == 3 else 'no_ns', ttl)
    except (ValueError, TypeError, AttributeError, KeyError, IndexError, OverflowError, UnicodeError):
        return DnsResult('error', error='unexpected DNS response')


def retry_after_seconds(value):
    if not value:
        return 0
    try:
        seconds = float(value)
        return max(0, seconds) if math.isfinite(seconds) else 0
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(0, (date - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return 0


def interpret_response(code, body, retry_after=None, domain='', content_type=''):
    delay = retry_after_seconds(retry_after)
    if code == 429:
        return Result(error='rate limited', retryable=True, throttled=True, retry_after=delay)
    if code in (408, 500, 502, 503, 504):
        return Result(error=f'HTTP {code}', retryable=True, retry_after=delay, provider_failure=True)
    if code not in (200, 404):
        return Result(error=f'HTTP {code}')
    # Verisign's direct RDAP endpoint returns an empty RDAP-typed 404 body.
    if code == 404 and not body.strip() and content_type.split(';')[0].strip().lower() == 'application/rdap+json':
        return Result(status='possibly available')
    try:
        record = json.loads(body)
    except (ValueError, UnicodeError):
        return Result(error='unexpected registry response', retryable=True)
    if isinstance(record, dict):
        if code == 200 and str(record.get('ldhName', '')).lower() == domain:
            return Result(status='registered')
        if code == 404 and record.get('errorCode') == 404:
            return Result(status='possibly available')
    return Result(error='unexpected registry response', retryable=True)


class RdapClient:
    """One reusable TLS connection per worker; no redirects or mirror rotation."""
    def __init__(self):
        self.local = threading.local()
        self.connections = set()
        self.lock = threading.Lock()
        self.reuse_supported = True
        self.tls_context = ssl.create_default_context()
        self.addresses = []
        self.dns_expires = 0
        self.dns_future = None
        self.dns_queries = self.dns_hits = 0

    @staticmethod
    def _rank_addresses(addresses):
        # Probe the registry's own DNS answers once, not on every request.
        # A slow first address otherwise pins the entire warm DNS cache to it.
        def probe(address):
            family, kind, protocol, _, target = address
            started = time.monotonic()
            try:
                with socket.socket(family, kind, protocol) as connection:
                    connection.settimeout(1)
                    connection.connect(target)
                return time.monotonic()-started, address
            except OSError:
                return float('inf'), address
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(addresses))) as pool:
            measured = list(pool.map(probe, addresses))
        return [address for _, address in sorted(measured, key=lambda row: row[0])]

    def _resolve(self, address):
        with self.lock:
            if time.monotonic() < self.dns_expires and self.addresses:
                self.dns_hits += 1
                return self.addresses
            if self.dns_future is None:
                future = concurrent.futures.Future()
                self.dns_future = future
                self.dns_queries += 1
                def resolve():
                    if not future.set_running_or_notify_cancel():
                        return
                    try:
                        addresses = socket.getaddrinfo(*address, type=socket.SOCK_STREAM)
                        future.set_result(self._rank_addresses(addresses) if addresses else [])
                    except Exception as error:
                        future.set_exception(error)
                threading.Thread(target=resolve, name='rdap-dns', daemon=True).start()
            future = self.dns_future
            if self.addresses and not future.done():
                self.dns_hits += 1
                return self.addresses
        try:
            addresses = future.result(timeout=2)
        except (OSError, concurrent.futures.TimeoutError):
            with self.lock:
                if self.addresses:
                    self.dns_expires = time.monotonic()+30
                    if future.done():
                        self.dns_future = None
                    return self.addresses
                if future.done():
                    self.dns_future = None
            raise
        with self.lock:
            if self.dns_future is future:
                self.addresses = addresses
                self.dns_expires = time.monotonic()+300
                self.dns_future = None
        return addresses

    def _connect(self, address, timeout=5, source_address=None):
        deadline = time.monotonic()+timeout
        last_error = OSError('No registry addresses resolved')
        for family, kind, protocol, _, target in self._resolve(address):
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                break
            connection = socket.socket(family, kind, protocol)
            try:
                connection.settimeout(min(2, remaining))
                if source_address:
                    connection.bind(source_address)
                connection.connect(target)
                connection.settimeout(max(.1, deadline-time.monotonic()))
                return connection
            except OSError as error:
                last_error = error
                connection.close()
        raise last_error

    def get(self, domain):
        return self._request('rdap.verisign.com', '/com/v1/domain/' + domain,
                             {'Accept': 'application/rdap+json', 'User-Agent': 'BrandNameExplorer/1.0'},
                             domain, interpret_response)

    def _request(self, host, path, headers, domain, interpret):
        connection = getattr(self.local, 'connection', None)
        if connection is not None and not self.reuse_supported:
            self.discard(connection)
            connection = None
        reused = connection is not None
        if connection is None:
            connection = http.client.HTTPSConnection(host, timeout=5, context=self.tls_context)
            # Keep hostname/SNI verification; cache only DNS, not provider identity.
            connection._create_connection = self._connect
            self.local.connection = connection
            with self.lock:
                self.connections.add(connection)
        phase = 'connect/TLS/send'
        try:
            connection.request('GET', path, headers=headers)
            if connection.sock is not None:
                connection.sock.settimeout(5)
            phase = 'response headers'
            response = connection.getresponse()
            phase = 'response body'
            body = response.read()
            result = interpret(response.status, body, response.getheader('Retry-After'), domain,
                                        response.getheader('Content-Type') or '')
            if not self.reuse_supported:
                self.discard(connection)
                self.local.connection = None
            return result
        except (OSError, http.client.HTTPException) as error:
            self.discard(connection)
            self.local.connection = None
            stale = reused and isinstance(error, (http.client.RemoteDisconnected, BrokenPipeError, ConnectionResetError))
            if stale:
                self.reuse_supported = False
            return Result(error=f'network failure ({type(error).__name__})', retryable=True, reconnect=stale, network_failure=True, phase=phase)

    def discard(self, connection):
        connection.close()
        with self.lock:
            self.connections.discard(connection)

    def close(self):
        for connection in list(self.connections):
            connection.close()
        self.connections.clear()
        if self.dns_future:
            self.dns_future.cancel()


class DohResolver(RdapClient):
    """Swappable resolver interface: get(domain) -> DnsResult, and close()."""
    def get(self, domain):
        result = self._request('cloudflare-dns.com', '/dns-query?' + urlencode({'name': domain, 'type': 'NS'}),
                               {'Accept': 'application/dns-json', 'User-Agent': 'BrandNameExplorer/1.0'},
                               domain, interpret_dns)
        if isinstance(result, Result):
            return DnsResult('error', error=result.error)
        return result


class RateLimiter:
    """A shared dispatch budget and cooldown, not a per-worker allowance."""
    def __init__(self, maximum):
        self.maximum = maximum
        self.rate = min(16.0, maximum)
        self.next_request = 0.0
        self.cooldown = 0.0
        self.successes = 0
        self.condition = threading.Condition()
        self.stopped = False

    def reserve(self, not_before=0):
        """Return seconds until dispatch is allowed; never occupy an HTTP worker."""
        with self.condition:
            if self.stopped:
                raise concurrent.futures.CancelledError()
            now = time.monotonic()
            wait = max(self.next_request, self.cooldown, not_before) - now
            if wait <= 0:
                self.next_request = now + 1 / self.rate
                return 0
            return wait

    def acquire(self, not_before=0):
        with self.condition:
            while True:
                wait = self.reserve(not_before)
                if not wait:
                    return
                self.condition.wait(wait)

    def success(self):
        with self.condition:
            self.successes += 1
            if self.successes >= 20:
                self.rate = min(self.maximum, self.rate * 1.25)
                self.successes = 0

    def pause(self, seconds, throttled=False):
        with self.condition:
            self.cooldown = max(self.cooldown, time.monotonic() + seconds)
            self.successes = 0
            if throttled:
                self.rate = max(min(.25, self.maximum), self.rate / 2)
            self.condition.notify_all()

    def stop(self):
        with self.condition:
            self.stopped = True
            self.condition.notify_all()


def sqlite_path(path):
    path = Path(path)
    return path if path.suffix in ('.sqlite', '.sqlite3', '.db') else path.with_suffix('.sqlite3')


def legacy_cache(path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or any(
        not isinstance(record, dict) or record.get('status') not in SUCCESS
        or not isinstance(record.get('checked_at'), str) for record in data.values()
    ):
        raise ValueError(f'Invalid cache file: {path}')
    return data


class DomainLookup:
    def __init__(self, path, workers=32, rate=160.0, *, dns=True, dns_workers=32, dns_rate=160.0, resolver=None):
        if not 1 <= workers <= 64 or not math.isfinite(rate) or rate <= 0 or rate > 320:
            raise ValueError('lookup workers must be 1–64 and lookup rate must be >0 and <=320')
        if not 1 <= dns_workers <= 64 or not math.isfinite(dns_rate) or not 0 < dns_rate <= 320:
            raise ValueError('DNS workers must be 1–64 and DNS rate must be >0 and <=320')
        self.path = Path(path)
        self.db_path = sqlite_path(self.path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.db_path, timeout=15, check_same_thread=False)
        try:
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('CREATE TABLE IF NOT EXISTS domains (domain TEXT PRIMARY KEY, status TEXT NOT NULL, checked_at TEXT NOT NULL)')
            self.db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
            self.db.execute('CREATE TABLE IF NOT EXISTS dns (domain TEXT PRIMARY KEY, outcome TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at REAL NOT NULL)')
            if not self.db.execute("SELECT 1 FROM metadata WHERE key='legacy_import'").fetchone():
                data = legacy_cache(self.path) if self.path != self.db_path else {}
                with self.db:
                    self.db.executemany('INSERT OR IGNORE INTO domains VALUES (?, ?, ?)',
                                        [(d, r['status'], r['checked_at']) for d,r in data.items()])
                    self.db.execute("INSERT INTO metadata VALUES ('legacy_import', 'done')")
        except Exception:
            self.db.close()
            raise
        self.workers = workers
        self.active_limit = workers
        self.recent_failures = deque(maxlen=64)
        self.healthy_responses = self.congestion_events = 0
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=workers, thread_name_prefix='rdap')
        self.limiter = RateLimiter(rate)
        self.condition = threading.Condition(self.lock)
        self.limiter.condition = self.condition
        self.dns_enabled = dns
        self.dns_workers = dns_workers
        self.dns_pool = concurrent.futures.ThreadPoolExecutor(max_workers=dns_workers, thread_name_prefix='doh')
        self.dns_limiter = RateLimiter(dns_rate)
        self.dns_limiter.condition = self.condition
        self._resolver = resolver
        self.dns_ready = deque()
        self.dns_active = {}
        self.dns_completed = deque()
        self.dns_requests = self.dns_hits = self.rdap_avoided = self.dns_errors = self.dns_throttles = 0
        cooldown = self.db.execute("SELECT value FROM metadata WHERE key='dns_cooldown_until'").fetchone()
        if cooldown and float(cooldown[0]) > time.time():
            self.dns_limiter.pause(float(cooldown[0])-time.time(), True)
        cooldown = self.db.execute("SELECT value FROM metadata WHERE key='cooldown_until'").fetchone()
        if cooldown and float(cooldown[0]) > time.time():
            self.limiter.pause(float(cooldown[0])-time.time(), True)
        self._client = None
        self.dispatcher = None
        self.waiting = []
        self.ready = deque()
        self.completed = deque()
        self.active = {}
        self.sequence = itertools.count()
        self.inflight = {}
        self.requests = self.retries = self.hits = 0
        self.started = time.monotonic()
        self.closed = False

    @property
    def cache(self):
        with self.lock:
            return {d:dict(status=s, checked_at=t) for d,s,t in self.db.execute('SELECT * FROM domains')}

    @property
    def client(self):
        with self.lock:
            if self._client is None:
                self._client = RdapClient()
            return self._client

    @property
    def resolver(self):
        with self.lock:
            if self._resolver is None:
                self._resolver = DohResolver()
            return self._resolver

    def _submit_many(self, domains, fresh_since=None):
        domains = [domain.lower() for domain in domains]
        for domain in domains:
            if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.com', domain):
                raise ValueError(f'Invalid .com domain: {domain!r}')
        if not domains:
            return []
        with self.condition:
            if self.closed:
                raise RuntimeError('lookup is closed')
            cached = {}
            for offset in range(0, len(domains), 256):
                batch = domains[offset:offset+256]
                sql = 'SELECT domain,status,checked_at FROM domains WHERE domain IN (' + ','.join('?' for _ in batch) + ')'
                cached.update((d, (s, t)) for d, s, t in self.db.execute(sql, batch)
                              if fresh_since is None or t >= fresh_since)
            results = []
            for domain in domains:
                key = (domain, fresh_since)
                if domain in cached:
                    status, checked_at = cached[domain]
                    future = concurrent.futures.Future()
                    future.set_result([domain, status, 'cache', checked_at])
                    self.hits += 1
                else:
                    future = self.inflight.get(key)
                    if future is None:
                        future = concurrent.futures.Future()
                        self.inflight[key] = future
                        job = (time.monotonic(), next(self.sequence), key, 0, future)
                        dns_record = self.db.execute('SELECT outcome,checked_at FROM dns WHERE domain=? AND expires_at>?',
                                                     (domain, time.time())).fetchone() if self.dns_enabled else None
                        if dns_record and (fresh_since is None or dns_record[1] >= fresh_since):
                            self.dns_hits += 1
                            if dns_record[0] == 'ns':
                                with self.db:
                                    self.db.execute('INSERT OR REPLACE INTO domains VALUES (?, ?, ?)',
                                                    (domain, 'registered', dns_record[1]))
                                self.rdap_avoided += 1
                                self.inflight.pop(key)
                                future.set_result([domain, 'registered', 'dns-cache', dns_record[1]])
                            else:
                                self.ready.append(job)
                        else:
                            (self.dns_ready if self.dns_enabled else self.ready).append(job)
                results.append(future)
            if (self.ready or self.waiting or self.dns_ready) and self.dispatcher is None:
                self.dispatcher = threading.Thread(target=self._dispatch, name='rdap-dispatch', daemon=True)
                self.dispatcher.start()
            self.condition.notify_all()
            return results

    def _submit(self, domain, fresh_since=None):
        return self._submit_many([domain], fresh_since)[0]

    def _finished(self, future):
        with self.condition:
            self.completed.append(future)
            self.condition.notify_all()

    def _dns_finished(self, future):
        with self.condition:
            self.dns_completed.append(future)
            self.condition.notify_all()

    def _resolve_dns(self, job, result):
        domain = job[2][0]
        if result.outcome in ('ns', 'nxdomain', 'no_ns'):
            checked_at = datetime.now(timezone.utc).isoformat()
            self.db.execute('INSERT OR REPLACE INTO dns VALUES (?, ?, ?, ?)',
                            (domain, result.outcome, checked_at, time.time()+result.ttl))
            self.dns_limiter.success()
            if result.outcome == 'ns':
                self.db.execute('INSERT OR REPLACE INTO domains VALUES (?, ?, ?)',
                                (domain, 'registered', checked_at))
                self.rdap_avoided += 1
                return job[4], [domain, 'registered', 'dns', checked_at], None, job[2]
        else:
            self.dns_errors += 1
            if result.throttled or result.retry_after:
                self.dns_throttles += int(result.throttled)
                delay = max(2, result.retry_after)
                self.dns_limiter.pause(delay, result.throttled)
                self.db.execute("INSERT OR REPLACE INTO metadata VALUES ('dns_cooldown_until', ?)",
                                (str(time.time()+delay),))
        # DNS failure cannot block coverage: RDAP remains authoritative.
        self.ready.append(job)

    def _observe(self, result):
        failed = bool(result.error and not result.reconnect)
        self.recent_failures.append(failed)
        self.healthy_responses = 0 if failed else self.healthy_responses + 1
        if len(self.recent_failures) >= 32 and sum(self.recent_failures) >= max(4, .1*len(self.recent_failures)):
            # Correlated failures are congestion evidence; isolated retries are not.
            self.active_limit = max(min(4, self.workers), int(self.active_limit*.75))
            self.limiter.rate = max(min(1, self.limiter.maximum), self.limiter.rate*.75)
            self.limiter.successes = 0
            self.congestion_events += 1
            self.recent_failures.clear()
        elif self.healthy_responses >= 128:
            self.active_limit = min(self.workers, self.active_limit + max(1, self.workers//8))
            self.healthy_responses = 0

    def _resolve(self, job, result):
        ready, sequence, key, attempt, future = job
        domain = key[0]
        self._observe(result)
        if result.status in SUCCESS:
            checked_at = datetime.now(timezone.utc).isoformat()
            self.db.execute('INSERT OR REPLACE INTO domains VALUES (?, ?, ?)',
                            (domain, result.status, checked_at))
            self.limiter.success()
            return future, [domain, result.status, 'live', checked_at], None, key
        delay = 0
        if result.retryable and not result.reconnect:
            delay = max(result.retry_after, min(60, 2 ** (attempt + 1)) + random.uniform(0, 1))
            if result.throttled or result.retry_after or result.provider_failure:
                self.limiter.pause(delay, result.throttled)
                previous = self.db.execute("SELECT value FROM metadata WHERE key='cooldown_until'").fetchone()
                until = max(time.time()+delay, float(previous[0]) if previous else 0)
                self.db.execute("INSERT OR REPLACE INTO metadata VALUES ('cooldown_until', ?)", (str(until),))
        if not result.retryable or attempt + 1 >= (6 if result.network_failure else 3):
            error = LookupFailure(f'{domain}: {result.error} after {attempt+1} attempts. '
                                  'Progress saved; rerun without --refresh to retry this domain.')
            return future, None, error, key
        # Retries get their own timer; sleeping jobs occupy no network worker.
        heapq.heappush(self.waiting, (time.monotonic()+delay, sequence, key, attempt+1, future))
        return None

    def _dispatch(self):
        try:
            while True:
                with self.condition:
                    resolved = []
                    if self.completed or self.dns_completed:
                        # Commit a completion batch before any consumer can see it.
                        with self.db:
                            while self.dns_completed:
                                network = self.dns_completed.popleft()
                                job = self.dns_active.pop(network)
                                try:
                                    result = network.result()
                                except Exception as error:
                                    result = DnsResult('error', error=f'resolver failure ({type(error).__name__})')
                                outcome = self._resolve_dns(job, result)
                                if outcome:
                                    resolved.append(outcome)
                            while self.completed:
                                network = self.completed.popleft()
                                job = self.active.pop(network)
                                outcome = self._resolve(job, network.result())
                                if outcome:
                                    resolved.append(outcome)
                        for future, row, error, key in resolved:
                            self.inflight.pop(key, None)
                            if error:
                                future.set_exception(error)
                            else:
                                future.set_result(row)
                        self.condition.notify_all()
                    if self.closed or self.limiter.stopped:
                        while self.waiting or self.ready or self.dns_ready:
                            if self.dns_ready:
                                job = self.dns_ready.popleft()
                            elif self.ready:
                                job = self.ready.popleft()
                            else:
                                job = heapq.heappop(self.waiting)
                            self.inflight.pop(job[2], None)
                            job[4].cancel()
                        self.condition.notify_all()
                        if not self.active and not self.dns_active:
                            return
                        self.condition.wait()
                        continue
                    wait = None
                    if self.dns_limiter.cooldown > time.monotonic():
                        # Respect DoH cooldown without holding up authoritative checks.
                        self.ready.extend(self.dns_ready)
                        self.dns_ready.clear()
                    if self.dns_ready and len(self.dns_active) < self.dns_workers:
                        wait = self.dns_limiter.reserve()
                        if not wait:
                            job = self.dns_ready.popleft()
                            self.dns_requests += 1
                            network = self.dns_pool.submit(self.resolver.get, job[2][0])
                            self.dns_active[network] = job
                            network.add_done_callback(self._dns_finished)
                            # Also offer RDAP a dispatch slot on every pass.
                    if (self.waiting or self.ready) and len(self.active) < self.active_limit:
                        retry_due = self.waiting and self.waiting[0][0] <= time.monotonic()
                        retry = retry_due or not self.ready
                        job = self.waiting[0] if retry else self.ready[0]
                        rdap_wait = self.limiter.reserve(job[0])
                        wait = rdap_wait if wait is None else min(wait, rdap_wait)
                        if not rdap_wait:
                            if retry:
                                heapq.heappop(self.waiting)
                            else:
                                self.ready.popleft()
                            self.requests += 1
                            self.retries += int(job[3] > 0)
                            network = self.pool.submit(self.client.get, job[2][0])
                            self.active[network] = job
                            network.add_done_callback(self._finished)
                            continue
                    if wait == 0:
                        continue
                    self.condition.wait(wait)
        except BaseException as error:
            with self.condition:
                for future in self.inflight.values():
                    if not future.done():
                        future.set_exception(error)
                self.inflight.clear()
                self.waiting.clear()
                self.ready.clear()
                self.dns_ready.clear()
                self.limiter.stop()
                self.dns_limiter.stop()
                self.condition.notify_all()

    def get(self, domain, fresh_since=None):
        return self._submit(domain, fresh_since).result()

    def many(self, domains, fresh_since=None, window=None):
        """Pump completions independently of output order; bound speculative work."""
        domains = iter(domains)
        pending = deque()
        exhausted = False
        capacity = 1 if self.workers == 1 else max(1024, 32*self.workers)
        try:
            while True:
                with self.condition:
                    if not pending or not pending[0].done() or len(pending) < max(1, capacity//2):
                        # Completed registered rows no longer consume a potential-match
                        # slot. This lets us keep searching behind a slow earlier name.
                        potential = sum(not future.done() or future.cancelled() or future.exception() is not None
                                        or future.result()[1] == 'possibly available'
                                        for future in pending) if window else len(pending)
                        budget = max(0, window() - potential) if window else capacity-len(pending)
                        take = min(capacity-len(pending), budget)
                        if not exhausted and take:
                            batch = list(itertools.islice(domains, take))
                            exhausted = len(batch) < take
                            pending.extend(self._submit_many(batch, fresh_since))
                    if not pending:
                        return
                    if pending[0].done():
                        future = pending.popleft()
                    else:
                        # Refill on any completion, not just the oldest request.
                        self.condition.wait()
                        continue
                yield future.result()
        finally:
            self.close()

    def close(self):
        with self.condition:
            if self.closed:
                return
            self.closed = True
            self.limiter.stop()
            self.dns_limiter.stop()
            self.condition.notify_all()
        if self.dispatcher:
            self.dispatcher.join()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.dns_pool.shutdown(wait=True, cancel_futures=True)
        if self._client:
            self._client.close()
        if self._resolver:
            self._resolver.close()
        self.db.close()

    def summary(self):
        return (f'lookup: {self.requests} RDAP requests, {self.dns_requests} DNS queries, '
                f'{self.rdap_avoided} RDAP checks avoided, {self.dns_errors} DNS errors, {self.hits} cache hits, '
                f'{self.retries} retries, {time.monotonic()-self.started:.1f}s elapsed')


def load_cache(path):
    """Compatibility snapshot for inspection; normal lookup uses indexed queries."""
    db_path = sqlite_path(path)
    if not db_path.exists():
        return legacy_cache(Path(path))
    with closing(sqlite3.connect(db_path)) as db:
        return {d:dict(status=s, checked_at=t) for d,s,t in db.execute('SELECT * FROM domains')}
