import type { Status } from "./store";
export interface RdapResult {
  status?: Status;
  error?: string;
  retryable?: boolean;
  throttled?: boolean;
  retryAfter?: number;
  providerFailure?: boolean;
  networkFailure?: boolean;
}
export interface DnsResult {
  outcome: "ns" | "nxdomain" | "no_ns" | "error";
  ttl?: number;
  error?: string;
  throttled?: boolean;
  retryAfter?: number;
}
export type DnsProvider = "cloudflare" | "google";
export function retryAfter(value: string | null) {
  if (!value) return 0;
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, number * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
export function interpretRdap(
  code: number,
  body: string,
  domain: string,
  contentType: string,
  after: string | null = null,
): RdapResult {
  const delay = retryAfter(after);
  if (code === 429)
    return {
      error: "HTTP 429",
      retryable: true,
      throttled: true,
      retryAfter: delay,
    };
  if ([408, 500, 502, 503, 504].includes(code))
    return {
      error: `HTTP ${code}`,
      retryable: true,
      providerFailure: true,
      retryAfter: delay,
    };
  if (![200, 404].includes(code)) return { error: `HTTP ${code}` };
  if (
    code === 404 &&
    !body.trim() &&
    contentType.split(";")[0].trim().toLowerCase() === "application/rdap+json"
  )
    return { status: "possibly available" };
  try {
    const record = JSON.parse(body);
    if (code === 200 && String(record.ldhName || "").toLowerCase() === domain)
      return { status: "registered" };
    if (code === 404 && record.errorCode === 404)
      return { status: "possibly available" };
  } catch {
    /* never turn an invalid response into availability */
  }
  return { error: "Unexpected registry response", retryable: true };
}
export function interpretDns(
  code: number,
  body: unknown,
  domain: string,
  after: string | null = null,
): DnsResult {
  if (code !== 200)
    return {
      outcome: "error",
      error: `HTTP ${code}`,
      throttled: code === 429,
      retryAfter: retryAfter(after),
    };
  try {
    const b = body as {
      Question?: { type: number; name: string }[];
      Status: number;
      TC?: boolean;
      Answer?: { type: number; name: string; data: string; TTL: number }[];
      Authority?: { type: number; TTL: number; data: string }[];
    };
    if (
      !b.Question?.some(
        (q) =>
          q.type === 2 && q.name.toLowerCase().replace(/\.$/, "") === domain,
      ) ||
      b.TC
    )
      throw new Error("Mismatched or truncated DNS response");
    if (![0, 3].includes(b.Status))
      return { outcome: "error", error: `DNS status ${b.Status}` };
    const ns =
      b.Answer?.filter(
        (a) =>
          a.type === 2 &&
          a.name.toLowerCase().replace(/\.$/, "") === domain &&
          typeof a.data === "string" &&
          a.data.trim(),
      ) || [];
    let ttl;
    if (b.Status === 0 && ns.length) {
      ttl = Math.min(...ns.map((a) => a.TTL), 86400);
      if (!Number.isFinite(ttl)) throw new Error("Invalid TTL");
      return { outcome: "ns", ttl: Math.max(0, ttl) };
    }
    const negativeTtls = [300];
    for (const a of b.Authority || [])
      if (a.type === 6)
        negativeTtls.push(a.TTL, Number(a.data.trim().split(/\s+/).at(-1)));
    ttl = Math.min(...negativeTtls);
    if (!Number.isFinite(ttl)) throw new Error("Invalid TTL");
    return {
      outcome: b.Status === 3 ? "nxdomain" : "no_ns",
      ttl: Math.max(0, ttl),
    };
  } catch {
    return { outcome: "error", error: "Unexpected DNS response" };
  }
}
export interface Providers {
  rdap(domain: string, signal: AbortSignal): Promise<RdapResult>;
  dns(
    domain: string,
    provider: DnsProvider,
    signal: AbortSignal,
  ): Promise<DnsResult>;
}
export const liveProviders: Providers = {
  async rdap(domain, signal) {
    try {
      const r = await fetch(
        "https://rdap.verisign.com/com/v1/domain/" + domain,
        {
          headers: { Accept: "application/rdap+json" },
          cache: "no-store",
          signal,
        },
      );
      return interpretRdap(
        r.status,
        await r.text(),
        domain,
        r.headers.get("content-type") || "",
        r.headers.get("retry-after"),
      );
    } catch (e) {
      if (signal.aborted) throw e;
      return {
        error: "Network failure",
        retryable: true,
        networkFailure: true,
      };
    }
  },
  async dns(domain, provider, signal) {
    try {
      const endpoint =
        provider === "google"
          ? "https://dns.google/resolve"
          : "https://cloudflare-dns.com/dns-query";
      const r = await fetch(
        `${endpoint}?name=${encodeURIComponent(domain)}&type=NS`,
        {
          headers: { Accept: "application/dns-json" },
          cache: "no-store",
          signal,
        },
      );
      return interpretDns(
        r.status,
        await r.json(),
        domain,
        r.headers.get("retry-after"),
      );
    } catch (e) {
      if (signal.aborted) throw e;
      return { outcome: "error", error: "DNS network failure" };
    }
  },
};
