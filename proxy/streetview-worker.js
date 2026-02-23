/**
 * Cloudflare Worker proxy for Google Street View Static API.
 *
 * Configure a Worker secret named GOOGLE_STREETVIEW_API_KEY:
 *   wrangler secret put GOOGLE_STREETVIEW_API_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/streetview') {
      return new Response('Not found', { status: 404 });
    }

    const lat = url.searchParams.get('lat');
    const lon = url.searchParams.get('lon');
    if (!lat || !lon) {
      return new Response('Missing lat/lon', { status: 400 });
    }

    const upstream = new URL('https://maps.googleapis.com/maps/api/streetview');
    upstream.searchParams.set('size', url.searchParams.get('size') || '900x420');
    upstream.searchParams.set('location', `${lat},${lon}`);
    upstream.searchParams.set('fov', url.searchParams.get('fov') || '80');
    upstream.searchParams.set('pitch', url.searchParams.get('pitch') || '0');
    upstream.searchParams.set('source', url.searchParams.get('source') || 'outdoor');
    upstream.searchParams.set('key', env.GOOGLE_STREETVIEW_API_KEY);

    const upstreamResp = await fetch(upstream.toString(), {
      headers: {
        'User-Agent': 'heritage-atlas-streetview-proxy',
      },
    });

    if (!upstreamResp.ok) {
      return new Response('Upstream Street View request failed', { status: upstreamResp.status });
    }

    return new Response(upstreamResp.body, {
      status: 200,
      headers: {
        'Content-Type': upstreamResp.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
