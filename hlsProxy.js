const { normalizeSourceUrl } = require('./roomStore');

function registerHlsProxy(app) {
  app.get('/proxy/manifest', async (req, res) => {
    const targetUrl = normalizeSourceUrl(req.query?.url || '');

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing manifest URL.' });
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: '*/*',
        },
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(upstream.status).type('text/plain').send(text);
      }

      const body = await upstream.text();
      const rewritten = body.replace(/https?:\/\/[^\s\"']+/gi, (url) => {
        if (url.includes('.m3u8') || url.includes('.ts') || url.includes('.key')) {
          return `/proxy/stream?url=${encodeURIComponent(url)}`;
        }
        return url;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(rewritten);
    } catch (error) {
      return res.status(500).json({ error: 'Unable to fetch manifest from remote source.' });
    }
  });

  app.get('/proxy/stream', async (req, res) => {
    const targetUrl = normalizeSourceUrl(req.query?.url || '');

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing stream URL.' });
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: new URL(targetUrl).origin + '/',
          Range: req.headers.range || undefined,
        },
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(upstream.status).type('text/plain').send(text);
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (error) {
      return res.status(500).json({ error: 'Unable to fetch stream segment from remote source.' });
    }
  });
}

module.exports = {
  registerHlsProxy,
};
