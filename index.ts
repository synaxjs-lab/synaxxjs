export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
}

const ROOM_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export { SignalRoom } from './SignalRoom';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'synax-share', fileStorage: false });
    }

    if (url.pathname.startsWith('/signal/')) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      const roomId = url.pathname.slice('/signal/'.length).split('/')[0] || '';
      const role = url.searchParams.get('role');
      if (!ROOM_PATTERN.test(roomId)) return new Response('Invalid share link', { status: 400 });
      if (role !== 'send' && role !== 'receive') return new Response('Invalid connection role', { status: 400 });
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
