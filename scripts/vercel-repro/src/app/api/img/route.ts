import { NextRequest, NextResponse } from "next/server";

/** T63 — the outlet-picture proxy (esthmr's `/esthmr/api/img?u=` clone).
 *
 *  The outlets the news feed reads (Arab Finance, Al Mal, Al Borsa,
 *  Enterprise, Hapi) all serve their article photos from CDNs that refuse
 *  cross-origin hotlinks — a browser <img> pointing straight at them 403s
 *  even with referrerPolicy=no-referrer, which is why the cloned news screen
 *  showed no pictures at all. The source terminal solves it by proxying every
 *  https image through its own edge route; the route re-fetches the picture
 *  server-side (the outlet sees the server, not the reader), streams the
 *  bytes back, and caches them for a week (`public, max-age=604800,
 *  immutable`), so the second reader costs the outlet nothing.
 *
 *  Security is the same shape the source's route uses: an allowlist of the
 *  outlet image hosts, nothing else. An arbitrary URL is never fetched — a
 *  proxy that follows any link is an SSRF hole, and the route's own host is
 *  refused explicitly so a rewritten URL can never be fed back into it. */

export const dynamic = "force-dynamic";

/** The hosts the five outlets actually serve pictures from.
 *  Anything else — including this app's own origin — is refused. */
const ALLOWED_HOSTS = new Set([
  "www.arabfinance.com",
  "arabfinance.com",
  "media.almalnews.com",
  "almalnews.com",
  "www.almalnews.com",
  "images.alborsaanews.com",
  "alborsaanews.com",
  "www.alborsaanews.com",
  "hapijournal.com",
  "www.hapijournal.com",
  "i0.wp.com",
  "i1.wp.com",
  "i2.wp.com",
  "ent.news",
  "www.amwalalghad.com",
  "amwalalghad.com",
]);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u");
  if (!raw) return new NextResponse("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("bad url", { status: 400 });
  }

  // https only, allowlisted hosts only — never this app's own origin (a URL
  // that has already been through the route must not go through it twice).
  if (target.protocol !== "https:") return new NextResponse("https only", { status: 400 });
  if (!ALLOWED_HOSTS.has(target.hostname)) return new NextResponse("host not allowed", { status: 403 });
  if (req.nextUrl.searchParams.get("u")?.includes("/api/img")) {
    return new NextResponse("already proxied", { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(10_000),
      // images are public content; no credentials ever attached
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("upstream refused", { status: 404 });
    }
    const type = upstream.headers.get("content-type") ?? "";
    // only pictures come back — an HTML error page from a walled CDN must
    // not be served to the client as an "image" it will render broken.
    if (!type.startsWith("image/")) {
      return new NextResponse("not an image", { status: 404 });
    }
    const buf = await upstream.arrayBuffer();
    // a body larger than 8 MB is not a news photo; refuse rather than ferry it.
    if (buf.byteLength > 8 * 1024 * 1024) {
      return new NextResponse("too large", { status: 413 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(buf.byteLength),
        // one week, immutable — the outlets rotate URLs rather than reusing
        // them, so a cached picture is the same picture.
        "cache-control": "public, max-age=604800, immutable",
        "x-content-type-options": "nosniff",
        // the reader's device never talks to the outlet directly
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    // the client <img> onError hides the frame's picture and the designed
    // fallback frame (outlet name + icon) shows through — same rule as the
    // source: a broken image is worse than none.
    return new NextResponse("unreachable", { status: 404 });
  }
}
