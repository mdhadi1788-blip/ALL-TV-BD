// api/proxy.js
// Vercel Serverless Function.
// Fetches an http:// (or https://) stream/playlist server-side and returns it
// over https, so the browser never has to make a direct http request from
// an https page (which it would otherwise block as "mixed content").
//
// Usage from the frontend: /api/proxy?url=<encoded original stream url>

export default async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    res.status(400).send('Missing "url" query parameter');
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream error: ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist =
      targetUrl.toLowerCase().includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    if (isPlaylist) {
      // Playlists contain relative/absolute URLs to segments (.ts) and
      // sometimes to other playlists (variant streams) or key files.
      // Every one of those needs to be rewritten to go back through this
      // same proxy, or the browser will try to fetch them directly (and
      // hit the same http/mixed-content or hotlink-protection problem).
      const text = await upstream.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const proxyBase = `${proto}://${req.headers.host}/api/proxy?url=`;

      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();

          if (!trimmed) return line;

          // Rewrite URI="..." inside tags like #EXT-X-KEY or #EXT-X-MAP
          if (trimmed.startsWith('#')) {
            if (trimmed.includes('URI="')) {
              return trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
                const abs = resolveUrl(uri, baseUrl);
                return `URI="${proxyBase}${encodeURIComponent(abs)}"`;
              });
            }
            return line;
          }

          // Plain lines (not starting with #) are segment/playlist URLs
          const abs = resolveUrl(trimmed, baseUrl);
          return `${proxyBase}${encodeURIComponent(abs)}`;
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.status(200).send(rewritten);
    } else {
      // Binary passthrough for .ts segments, keys, or direct video files
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType || 'video/mp2t');
      res.status(200).send(buffer);
    }
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
}

function resolveUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
