import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

const maxVideoBytes = 80_000_000;
const maxBase64Chars = Math.ceil(maxVideoBytes * 4 / 3) + 4;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

export class VideoMediaResolutionError extends Error {
  constructor() { super("Controlled Video media result cannot be safely resolved"); }
}
function reject(): never { throw new VideoMediaResolutionError(); }

function publicIpv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const [first, second, third] = octets;
  return first !== 0 && first !== 10 && first !== 127
    && first < 224 && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && (second === 168 || second === 0 && third === 0))
    && !(first === 198 && second >= 18 && second <= 19)
    && !(first === 192 && second === 0 && third === 2)
    && !(first === 198 && second === 51 && third === 100)
    && !(first === 203 && second === 0 && third === 113);
}

function verifyMp4(bytes: Buffer): void {
  if (bytes.length < 16 || bytes.length > maxVideoBytes
    || bytes.toString("ascii", 4, 8) !== "ftyp") reject();
}

async function fetchPinned(url: URL, address: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, rejectPromise) => {
    const request = https.request(url, {
      method: "GET", timeout: 30_000, maxHeaderSize: 16_384,
      lookup: (hostname, _options, callback) => {
        if (hostname !== url.hostname) {
          callback(new VideoMediaResolutionError(), "", 4); return;
        }
        callback(null, address, 4);
      },
    }, (response) => {
      const length = Number(response.headers["content-length"] ?? 0);
      const contentType = String(response.headers["content-type"] ?? "")
        .split(";", 1)[0].trim().toLowerCase();
      response.on("error", () => rejectPromise(new VideoMediaResolutionError()));
      if (response.statusCode !== 200
        || !Number.isSafeInteger(length) || length < 0 || length > maxVideoBytes
        || contentType && !["video/mp4", "application/octet-stream"]
          .includes(contentType)) {
        response.destroy(); rejectPromise(new VideoMediaResolutionError()); return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxVideoBytes) {
          response.destroy(); rejectPromise(new VideoMediaResolutionError()); return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("timeout", () => request.destroy(new VideoMediaResolutionError()));
    request.on("error", () => rejectPromise(new VideoMediaResolutionError()));
    request.end();
  });
}

/** URL retrieval is opt-in by exact host; DNS is pinned to the vetted public address. */
export function createVideoMediaResolver(dependencies: {
  allowedHosts: readonly string[];
  lookup(hostname: string): Promise<readonly string[]>;
  fetch(url: URL, address: string): Promise<Buffer>;
}) {
  const hosts = new Set(dependencies.allowedHosts.map((host) => host.toLowerCase()));
  return async (result: string): Promise<string> => {
    if (base64Pattern.test(result)) {
      if (result.length > maxBase64Chars
        || Buffer.from(result, "base64").toString("base64") !== result) reject();
      verifyMp4(Buffer.from(result, "base64"));
      return result;
    }
    let url: URL;
    try { url = new URL(result); }
    catch { return reject(); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash
      || url.port && url.port !== "443"
      || !hosts.has(url.hostname.toLowerCase())
      || net.isIP(url.hostname) !== 0) reject();
    let addresses: readonly string[];
    try { addresses = await dependencies.lookup(url.hostname); }
    catch { return reject(); }
    if (addresses.length === 0 || addresses.some((address) => !publicIpv4(address))) reject();
    let bytes: Buffer;
    try { bytes = await dependencies.fetch(url, addresses[0]); }
    catch { return reject(); }
    verifyMp4(bytes);
    return bytes.toString("base64");
  };
}

export function createDefaultVideoMediaResolver(allowedHosts: readonly string[]) {
  return createVideoMediaResolver({ allowedHosts,
    lookup: async (hostname) => (await dns.lookup(hostname, { all: true, family: 4 }))
      .map((entry) => entry.address),
    fetch: fetchPinned });
}
