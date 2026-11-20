// Pineapple AI web tools: search the web and read web pages.
// Deploy as a Supabase Edge Function named "web".
// Secrets (Edge Functions → Secrets): TAVILY_API_KEY (required), EXA_API_KEY (optional backup),
// FINNHUB_API_KEY (optional, better stock quotes).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_LIMITS: Record<string, number> = { search: 40, open: 150, quote: 200 };
const MAX_PAGE_BYTES = 2_000_000;
const MAX_PAGE_CHARS = 12_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clip(s: unknown, n: number) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

async function search(query: string, news: boolean) {
  if (!query.trim()) throw new Error("Empty search");
  const problems: string[] = [];

  const tavily = Deno.env.get("TAVILY_API_KEY");
  if (tavily) {
    try {
      const r = await fetchWithTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavily}` },
        body: JSON.stringify({
          query,
          max_results: 5,
          search_depth: "basic",
          topic: news ? "news" : "general",
          include_answer: "basic",
        }),
      }, 15000);
      if (!r.ok) throw new Error(`Tavily returned ${r.status}`);
      const d = await r.json();
      return {
        provider: "tavily",
        answer: clip(d.answer || "", 800),
        results: (d.results || []).map((x: any) => ({
          title: clip(x.title, 200),
          url: String(x.url || ""),
          snippet: clip(x.content, 700),
        })),
      };
    } catch (e) {
      problems.push(String((e as Error)?.message || e));
    }
  }

  const exa = Deno.env.get("EXA_API_KEY");
  if (exa) {
    try {
      const r = await fetchWithTimeout("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": exa },
        body: JSON.stringify({
          query,
          numResults: 5,
          type: "auto",
          contents: { text: { maxCharacters: 700 } },
        }),
      }, 15000);
      if (!r.ok) throw new Error(`Exa returned ${r.status}`);
      const d = await r.json();
      return {
        provider: "exa",
        results: (d.results || []).map((x: any) => ({
          title: clip(x.title || x.url, 200),
          url: String(x.url || ""),
          snippet: clip(x.text || x.summary || "", 700),
        })),
      };
    } catch (e) {
      problems.push(String((e as Error)?.message || e));
    }
  }

  throw new Error(problems.length ? `Search failed: ${problems.join("; ")}` : "No search service is set up. Add TAVILY_API_KEY in Edge Function secrets.");
}

async function quote(raw: string) {
  const q = raw.trim().replace(/^\$/, "");
  if (!q) throw new Error("No stock symbol given");
  const finnhub = Deno.env.get("FINNHUB_API_KEY");
  let symbol = q.toUpperCase();

  if (finnhub) {
    const getQuote = async (sym: string) => {
      const r = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${finnhub}`, {}, 10000);
      if (!r.ok) return null;
      const d = await r.json();
      return d && Number(d.c) > 0 ? d : null;
    };
    const lookup = async () => {
      const r = await fetchWithTimeout(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${finnhub}`, {}, 10000);
      const d = r.ok ? await r.json() : null;
      const hit = (d?.result || []).find((x: any) => x.type === "Common Stock" && !String(x.symbol).includes(".")) || d?.result?.[0];
      return hit?.symbol ? String(hit.symbol) : null;
    };
    let d = /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) ? await getQuote(symbol) : null;
    if (!d) {
      const found = await lookup();
      if (found) {
        symbol = found;
        d = await getQuote(found);
      }
    }
    if (d) {
      return {
        symbol,
        price: d.c,
        change: d.d,
        changePercent: d.dp,
        open: d.o,
        high: d.h,
        low: d.l,
        previousClose: d.pc,
        time: d.t ? new Date(d.t * 1000).toISOString() : null,
        source: "Finnhub",
        url: `https://finnhub.io/`,
      };
    }
  }

  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) throw new Error("Use a ticker symbol like NVDA");
  const stooqSymbol = symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
  const r = await fetchWithTimeout(`https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`, {}, 10000);
  if (!r.ok) throw new Error(`Quote service returned ${r.status}`);
  const [header, row] = (await r.text()).trim().split(/\r?\n/);
  const cols = (row || "").split(",");
  if (!header || cols.length < 7 || cols.includes("N/D")) throw new Error(`No quote found for ${symbol}`);
  const [, date, time, open, high, low, close] = cols;
  return {
    symbol,
    price: Number(close),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    time: `${date} ${time}`,
    note: "May be delayed by about 15 minutes.",
    source: "Stooq",
    url: `https://stooq.com/q/?s=${encodeURIComponent(stooqSymbol)}`,
  };
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html: string) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|aside|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n");
}

function isBlockedHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return true;
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h);
}

async function readCapped(r: Response, maxBytes: number) {
  const reader = r.body?.getReader();
  if (!reader) return "";
  const charset = (r.headers.get("content-type") || "").match(/charset=([^;]+)/i)?.[1]?.trim() || "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder("utf-8"); }
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

async function openUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That isn't a valid link"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links can be opened");
  if (isBlockedHost(u.hostname)) throw new Error("That address can't be opened");

  const r = await fetchWithTimeout(u.href, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PineappleAI/1.0; +https://yijianxiao2023-netizen.github.io/PineappleAIrepo/)",
      Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
      "Accept-Language": "en-US,en;q=0.8",
    },
  }, 12000);
  if (!r.ok) throw new Error(`The page returned an error (${r.status})`);
  const finalUrl = new URL(r.url || u.href);
  if (isBlockedHost(finalUrl.hostname)) throw new Error("That address can't be opened");
  const type = r.headers.get("content-type") || "";
  if (!/text\/|json|xml/i.test(type)) throw new Error("That link isn't a web page (it may be a PDF, image, or download)");

  const body = await readCapped(r, MAX_PAGE_BYTES);
  const isHtml = /html|xml/i.test(type);
  const title = isHtml ? clip(decodeEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""), 200) : "";
  const text = isHtml ? htmlToText(body) : body;
  return {
    url: finalUrl.href,
    title: title || finalUrl.hostname,
    text: text.length > MAX_PAGE_CHARS ? text.slice(0, MAX_PAGE_CHARS) + "…" : text,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server is missing Supabase settings" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Please sign in to use web search." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const action = body?.action;
  if (!(action in DAILY_LIMITS)) return json({ error: "Unknown action" }, 400);

  const { data: allowed, error: limitError } = await admin.rpc("bump_web_usage", {
    p_user: user.id,
    p_kind: action,
    p_limit: DAILY_LIMITS[action],
  });
  if (limitError) console.warn("Usage limit check failed", limitError.message);
  else if (allowed === false) {
    const what = action === "search" ? "web search" : action === "open" ? "page reading" : "stock quote";
    return json({ error: `Daily ${what} limit reached. Try again tomorrow.` }, 429);
  }

  try {
    if (action === "search") return json(await search(String(body.query || "").slice(0, 300), body.news === true));
    if (action === "quote") return json(await quote(String(body.symbol || "").slice(0, 60)));
    return json(await openUrl(String(body.url || "")));
  } catch (e) {
    return json({ error: clip((e as Error)?.message || e, 300) }, 502);
  }
});
