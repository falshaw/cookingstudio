// Plain node:http(s) client. Used instead of global fetch (undici) where undici's fixed 300 s
// headers/body timeouts break things: a 31B model that is still loading can take minutes before
// the first byte. Also used for SSRF-safe page fetches with the resolved IP pinned (no DNS rebinding).
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export class HttpError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

/** Human message for low-level socket errors (never an empty string). */
export function describeNetError(e: unknown, what: string): string {
  const err = e as NodeJS.ErrnoException;
  const code = err?.code ?? "";
  if (code === "ECONNREFUSED") return `${what} is not running (connection refused)`;
  if (code === "ECONNRESET" || /terminated|socket hang up/i.test(err?.message ?? "")) return `${what} dropped the connection (stopped or restarted mid-answer)`;
  if (code === "ETIMEDOUT" || err?.name === "TimeoutError") return `${what} timed out`;
  return `${what}: ${err?.message || err?.name || String(e) || "unknown error"}`;
}

/**
 * POST JSON and stream the NDJSON answer line by line. One overall timeout, no per-chunk or
 * headers timeout (Ollama may think for minutes before the first token).
 */
export function postNdjson(url: string, body: unknown, timeoutMs: number, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const feed = (line: string): boolean => {
      try {
        onLine(line);
        return true;
      } catch (e) {
        done(e); // first failure wins (e.g. an {"error": …} chunk from Ollama)
        req.destroy();
        return false;
      }
    };
    const req = mod.request(u, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      if ((res.statusCode ?? 500) >= 400) {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => done(new HttpError(`HTTP ${res.statusCode}: ${t.slice(0, 200)}`, res.statusCode)));
        return;
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line && !feed(line)) return;
        }
      });
      res.on("end", () => {
        if (buf.trim() && !feed(buf.trim())) return;
        done();
      });
      res.on("error", (e) => done(e));
      res.on("aborted", () => done(Object.assign(new Error("terminated"), { code: "ECONNRESET" })));
    });
    const timer = setTimeout(() => {
      done(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
      req.destroy();
    }, timeoutMs);
    req.on("error", (e) => done(e));
    req.end(payload);
  });
}

/**
 * Not a public unicast address: private (incl. 172.16/12, where Docker networks live), loopback, "this network",
 * link-local, CGNAT, IETF protocol assignments, benchmarking, documentation, multicast and reserved; plus the IPv6
 * equivalents and every IPv6 form that carries an IPv4 inside (mapped, compatible, NAT64, 6to4, Teredo).
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || // 0.0.0.0/8 "this network"
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET-1
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast 224/4, reserved 240/4, broadcast
    );
  }
  if (!net.isIPv6(ip)) return true; // not an IP literal at all: refuse rather than guess
  const l = ip.toLowerCase();
  // IPv4-mapped ::ffff:a.b.c.d, also in its hex form ::ffff:7f00:1 (how the URL parser writes it)
  if (l.startsWith("::ffff:")) {
    const rest = l.slice(7);
    if (net.isIPv4(rest)) return isBlockedIp(rest);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true;
  }
  // IPv4-compatible ::a.b.c.d (deprecated, still parsed): judge the embedded IPv4 the same way.
  if (/^::\d+\.\d+\.\d+\.\d+$/.test(l)) return isBlockedIp(l.slice(2));
  // NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001:0::/32) carry an IPv4 inside.
  if (l.startsWith("64:ff9b:") || l.startsWith("2002:") || l.startsWith("2001:0:") || l.startsWith("2001::")) return true;
  if (l.startsWith("2001:db8:")) return true; // documentation
  return (
    l === "::" ||
    l === "::1" ||
    /^f[cd]/.test(l) || // fc00::/7 unique local (ULA)
    /^fe[89a-f]/.test(l) || // fe80::/10 link-local, fec0::/10 site-local
    l.startsWith("ff") // multicast
  );
}

/**
 * GET a public web page with the IP pinned to the one we validated: every resolved address must
 * be public, and the socket connects to exactly that address (TLS still verifies the hostname).
 * No redirects, 2 MB cap, 20 s idle timeout + 30 s overall deadline (a slow drip cannot hold the worker).
 */
export async function getPublicPage(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError("not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError("only http(s) URLs");
  if (u.username || u.password) throw new HttpError("URLs with credentials are not allowed");
  // IPv6 literals come back bracketed ("[::1]"); strip them so they are judged as IPs, not looked up.
  const host = u.hostname.replace(/^\[(.*)\]$/, "$1");
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dnsLookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new HttpError("refusing a private, loopback or internal address");
  const pinned = addrs[0];
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      u,
      {
        headers: { "User-Agent": "Mozilla/5.0 (kitchen recipe import)", Accept: "text/html" },
        // Node may ask for all addresses ({ all: true }) — answer in both shapes, always the pinned IP.
        lookup: (_h: string, o: { all?: boolean } | undefined, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) =>
          o?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family),
      } as https.RequestOptions,
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300) {
          res.resume();
          return reject(new HttpError(code < 400 ? "the page redirects — paste the final URL" : `page returned ${code}`, code));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > 2_000_000) req.destroy(new HttpError("page larger than 2 MB"));
          else chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.setTimeout(20_000, () => req.destroy(new HttpError("page timed out")));
    const deadline = setTimeout(() => req.destroy(new HttpError("page timed out")), 30_000);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
  });
}
