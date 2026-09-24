type EventCallback = (data: any) => void;

type PollVisibilityHandler = () => void;

class SocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimer: number | null = null;
  private token: string | null = null;
  private isConnecting = false;

  // WebRTC signaling is HTTP/Supabase-backed and must work even when the
  // WebSocket transport is unavailable on a mobile network.
  private callPollTimer: number | null = null;
  private callPollInFlight = false;
  private callSignalAfterId = 0;
  private callSignalSince = 0;
  private callPollVisibilityHandler: PollVisibilityHandler | null = null;
  private pendingCallEvents: Map<string, any[]> = new Map();
  private seenCallSignalIds = new Set<number>();

  connect(token: string) {
    const tokenChanged = this.token !== token;
    this.token = token;

    if (tokenChanged) {
      // Start a little before "now" so a call created during page startup is not
      // missed, while still keeping the mailbox bounded.
      this.callSignalSince = Date.now() - 30_000;
      this.callSignalAfterId = 0;
      this.seenCallSignalIds.clear();
    }

    // IMPORTANT: Start call polling independently of WebSocket.
    // Some mobile browsers/networks can block or delay WebSocket connections,
    // but HTTPS fetch polling still works, so incoming calls remain deliverable.
    this.startCallSignalPolling();

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        if (this.reconnectTimer !== null) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.send({ type: 'auth', token: this.token });
        this.emit('connection:open', { status: 'connected' });
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type) this.emit(payload.type, payload);
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.emit('connection:closed', { status: 'disconnected' });
        this.scheduleReconnect();
        // Keep HTTP call polling alive; do not stop it with WS failures.
        this.startCallSignalPolling();
      };

      this.ws.onerror = (err) => {
        this.isConnecting = false;
        console.warn('WS socket error:', err);
      };
    } catch (e) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token) this.connect(this.token);
    }, 3000);
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  sendTyping(isTyping: boolean) {
    this.send({ type: 'typing', isTyping });
  }

  sendMarkRead() {
    this.send({ type: 'chat:mark_read' });
  }

  async sendCallSignal(payload: any): Promise<boolean> {
    const token = this.token;
    if (!token) {
      this.emit('call:error', { error: 'Not authenticated for calls.' });
      return false;
    }
    if (!payload?.callId || !payload?.type?.startsWith('call:')) {
      this.emit('call:error', { error: 'Invalid call signal.' });
      return false;
    }

    try {
      const res = await fetch('/api/call/signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        keepalive: payload.type === 'call:end' || payload.type === 'call:reject',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.emit('call:error', { error: data.error || 'Call signaling failed.' });
        return false;
      }
      return true;
    } catch (err) {
      console.error('Call signaling request failed:', err);
      this.emit('call:error', { error: 'Unable to reach the call signaling service.' });
      return false;
    }
  }

  async getCallOffer(callId: string): Promise<any | null> {
    const token = this.token;
    if (!token || !callId) return null;

    try {
      const url = `/api/call/signals?callId=${encodeURIComponent(callId)}&since=${encodeURIComponent(Date.now() - 60_000)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data.signals) ? data.signals : [];
      const offer = rows.find((row: any) => row?.payload?.type === 'call:offer');
      return offer?.payload || null;
    } catch {
      return null;
    }
  }

  private startCallSignalPolling() {
    if (this.callPollTimer !== null || !this.token) return;

    if (!this.callSignalSince) this.callSignalSince = Date.now() - 30_000;

    this.callPollVisibilityHandler = () => {
      if (document.visibilityState === 'visible') void this.pollCallSignals();
    };
    document.addEventListener('visibilitychange', this.callPollVisibilityHandler);

    void this.pollCallSignals();
    this.callPollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.pollCallSignals();
    }, 650);
  }

  private async pollCallSignals() {
    if (this.callPollInFlight || !this.token || document.visibilityState !== 'visible') return;
    this.callPollInFlight = true;

    try {
      const url = `/api/call/signals?after=${encodeURIComponent(this.callSignalAfterId)}&since=${encodeURIComponent(this.callSignalSince)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: 'no-store',
      });

      if (res.ok) {
        const data = await res.json();
        const signals = Array.isArray(data.signals) ? data.signals : [];
        for (const row of signals) {
          const rowId = Number(row?.id || 0);
          if (rowId > 0) {
            this.callSignalAfterId = Math.max(this.callSignalAfterId, rowId);
            if (this.seenCallSignalIds.has(rowId)) continue;
            this.seenCallSignalIds.add(rowId);
            if (this.seenCallSignalIds.size > 500) {
              const first = this.seenCallSignalIds.values().next().value;
              if (typeof first === 'number') this.seenCallSignalIds.delete(first);
            }
          }

          const payload = row?.payload;
          if (!payload?.type?.startsWith('call:')) continue;

          // An offer is the only event that opens the incoming call modal.
          // All other signals belong to an already-created call modal.
          const eventName = payload.type === 'call:offer' ? 'call:incoming' : payload.type;
          this.emit(eventName, {
            ...payload,
            _signalId: rowId || undefined,
            _signalCreatedAt: row?.created_at,
          });
        }
      } else if (res.status === 401) {
        // Auth/session recovery is handled by the normal app auth flow.
        return;
      }
    } catch (err) {
      // Never let call polling affect the chat UI.
      console.warn('Call signal polling failed:', err);
    } finally {
      this.callPollInFlight = false;
    }
  }

  private stopCallSignalPolling() {
    if (this.callPollTimer !== null) {
      window.clearInterval(this.callPollTimer);
      this.callPollTimer = null;
    }
    if (this.callPollVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.callPollVisibilityHandler);
      this.callPollVisibilityHandler = null;
    }
    this.callPollInFlight = false;
  }

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);

    if (event.startsWith('call:')) {
      const pending = this.pendingCallEvents.get(event);
      if (pending?.length) {
        this.pendingCallEvents.delete(event);
        for (const payload of pending) {
          try { callback(payload); }
          catch (e) { console.error(`Error replaying buffered call event for ${event}:`, e); }
        }
      }
    }

    return () => this.off(event, callback);
  }

  off(event: string, callback: EventCallback) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) this.listeners.delete(event);
    }
  }

  emit(event: string, data: any) {
    const set = this.listeners.get(event);
    if (set && set.size > 0) {
      set.forEach((cb) => {
        try { cb(data); }
        catch (e) { console.error(`Error in event listener for ${event}:`, e); }
      });
      return;
    }

    if (event.startsWith('call:')) {
      const pending = this.pendingCallEvents.get(event) || [];
      pending.push(data);
      if (pending.length > 20) pending.splice(0, pending.length - 20);
      this.pendingCallEvents.set(event, pending);
    }
  }

  disconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopCallSignalPolling();
    this.pendingCallEvents.clear();
    this.seenCallSignalIds.clear();
    this.token = null;
    this.callSignalAfterId = 0;
    this.callSignalSince = 0;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

export const socketService = new SocketService();
