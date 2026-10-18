interface SocketAttachment {
  role: 'send' | 'receive';
  joinedAt: number;
}

type Role = 'send' | 'receive';

function sendJson(socket: WebSocket, value: unknown): void {
  try {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  } catch {
    // The other peer may have disconnected between the state check and send.
  }
}

export class SignalRoom {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    if (role !== 'send' && role !== 'receive') {
      return new Response('Invalid connection role', { status: 400 });
    }

    const sockets = this.state.getWebSockets();
    const activeRoles = sockets.map((socket) => {
      try { return (socket.deserializeAttachment() as SocketAttachment | null)?.role; }
      catch { return undefined; }
    });
    if (activeRoles.includes(role as Role)) {
      return new Response('This side is already connected. Close the other tab and create a new share link if needed.', { status: 409 });
    }
    if (sockets.length >= 2) {
      return new Response('This share is already in use. Ask the sender for a new link.', { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ role, joinedAt: Date.now() } satisfies SocketAttachment);

    const otherSockets = this.state.getWebSockets().filter((socket) => socket !== server);
    for (const other of otherSockets) {
      sendJson(other, { type: 'peer-joined', role });
    }
    sendJson(server, { type: 'joined', role, peerPresent: otherSockets.length > 0 });

    const alarm = await this.state.storage.getAlarm();
    if (alarm === null) await this.state.storage.setAlarm(Date.now() + 12 * 60 * 60 * 1000);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    if (typeof rawMessage !== 'string' || rawMessage.length > 128_000) {
      sendJson(socket, { type: 'error', message: 'Invalid or oversized connection message.' });
      try { socket.close(1009, 'Message too large'); } catch {}
      return;
    }

    let message: { type?: unknown; payload?: unknown };
    try { message = JSON.parse(rawMessage) as { type?: unknown; payload?: unknown }; }
    catch {
      sendJson(socket, { type: 'error', message: 'Invalid connection message.' });
      return;
    }

    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || (attachment.role !== 'send' && attachment.role !== 'receive')) {
      try { socket.close(1008, 'Missing connection role'); } catch {}
      return;
    }

    if (message.type === 'ping') {
      sendJson(socket, { type: 'pong', at: Date.now() });
      return;
    }

    if (message.type !== 'signal' || !message.payload || typeof message.payload !== 'object') {
      sendJson(socket, { type: 'error', message: 'Unsupported connection message.' });
      return;
    }

    const payload = message.payload as Record<string, unknown>;
    const kind = payload.kind;
    const allowed = kind === 'candidate' || (attachment.role === 'send' && kind === 'offer') || (attachment.role === 'receive' && kind === 'answer');
    if (!allowed) {
      sendJson(socket, { type: 'error', message: 'This connection message is not allowed for your side.' });
      return;
    }

    for (const other of this.state.getWebSockets()) {
      if (other === socket) continue;
      const otherAttachment = other.deserializeAttachment() as SocketAttachment | null;
      if (otherAttachment && otherAttachment.role !== attachment.role) {
        sendJson(other, { type: 'signal', role: attachment.role, payload });
      }
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    for (const other of this.state.getWebSockets()) {
      if (other === socket) continue;
      sendJson(other, { type: 'peer-left', role: attachment?.role ?? 'unknown' });
    }
    try { socket.close(code, reason); } catch {}
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    for (const other of this.state.getWebSockets()) {
      if (other === socket) continue;
      sendJson(other, { type: 'peer-left', role: attachment?.role ?? 'unknown' });
    }
    try { socket.close(1011, 'Connection error'); } catch {}
  }

  async alarm(): Promise<void> {
    for (const socket of this.state.getWebSockets()) {
      sendJson(socket, { type: 'error', message: 'This share link has expired. Ask the sender to create a new one.' });
      try { socket.close(4000, 'Share link expired'); } catch {}
    }
    await this.state.storage.deleteAll();
  }
}
