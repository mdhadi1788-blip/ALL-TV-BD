// /api/proxy.js
// Vercel Serverless Function: proxies IPTV streams so that
// 1) http:// streams can be loaded from an https:// site (no more mixed-content block)
// 2) streams that need CORS headers / custom User-Agent / Referer still work
// 3) m3u8 playlists are rewritten so every segment/sub-playlist also goes through this proxy

export default async function handler(req, res) {
  const { url, ua, ref } = req.query;

  if (!url) {
    res.status(400).send('Missing "url" parameter');
    return;
  }

  let target;
  try {
    target = decodeURIComponent(url);
  } catch (e) {
    res.status(400).send('Invalid url parameter');
    return;
  }

  const userAgent = ua
    ? decodeURIComponent(ua)
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const referer = ref ? decodeURIComponent(ref) : target;

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': userAgent,
        'Referer': referer,
        'Accept': '*/*',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream error: ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist =
      target.toLowerCase().includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('vnd.apple.mpegurl');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (isPlaylist) {
      const text = await upstream.text();

      // Base URL used to resolve relative segment/playlist paths
      const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);

      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const proxyPrefix = `${proto}://${host}/api/proxy?ua=${encodeURIComponent(
        userAgent
      )}&ref=${encodeURIComponent(referer)}&url=`;

      const rewritten = text
        .split('\n')
        .map((rawLine) => {
          const line = rawLine.trim();
          if (!line) return rawLine;

          // Rewrite URI="..." inside tags like #EXT-X-KEY or #EXT-X-MAP
          if (line.startsWith('#')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) {
              const abs = uriMatch[1].startsWith('http')
                ? uriMatch[1]
                : baseUrl + uriMatch[1];
              return line.replace(
                uriMatch[1],
                proxyPrefix + encodeURIComponent(abs)
              );
            }
            return rawLine;
          }

          // Plain line = a segment or nested playlist URL
          const absolute = line.startsWith('http') ? line : baseUrl + line;
          return proxyPrefix + encodeURIComponent(absolute);
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.status(200).send(rewritten);
      return;
    }

    // Binary passthrough (.ts segments, keys, etc.)
    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    res.status(502).send('Proxy fetch failed: ' + err.message);
  }
}
