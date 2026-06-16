// api/proxy.js — Vercel Serverless Proxy
// HLS stream এবং M3U playlist উভয়ই এই proxy দিয়ে fetch করা হবে
// CORS ও Mixed Content সমস্যা দূর করে

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter required' });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // শুধু http/https allow করা হবে
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Only http/https allowed' });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': targetUrl,
        'Origin': new URL(targetUrl).origin,
      },
      redirect: 'follow',
    });

    // Content-Type নির্ধারণ
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    // CORS headers সেট করা
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store');

    // M3U8 playlist হলে — ভেতরের segment URL গুলোও proxy করা হবে
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegURL') ||
      targetUrl.includes('.m3u8')
    ) {
      let text = await upstream.text();
      const base = new URL(targetUrl);

      // Relative URL গুলো absolute এ রূপান্তর করে proxy দিয়ে রাউট করা
      text = text.replace(/(^[^#\n][^\n]+\.ts[^\n]*)/gm, (match) => {
        let absUrl = match.trim();
        if (!absUrl.startsWith('http')) {
          absUrl = new URL(absUrl, base.href).href;
        }
        return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
      });

      // Nested m3u8 (adaptive streams) proxy করা
      text = text.replace(/(URI=")([^"]+)(")/g, (match, p1, uri, p3) => {
        let absUrl = uri.trim();
        if (!absUrl.startsWith('http')) {
          absUrl = new URL(absUrl, base.href).href;
        }
        return `${p1}/api/proxy?url=${encodeURIComponent(absUrl)}${p3}`;
      });

      return res.status(upstream.status).send(text);
    }

    // Binary stream (TS segments, video) — buffer হিসেবে পাঠানো
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).send(buffer);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).json({ error: 'Upstream fetch failed', detail: err.message });
  }
}
