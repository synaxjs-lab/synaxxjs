type EventCallback = (data: any) => void;

class SocketService {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: number | null = null;
  private token: string | null = null;
  private isConnecting = false;

  // Calls use authenticated HTTP polling instead of relying on a particular
  // WebSocket/container instance. Chat continues using the normal WebSocket.
  private callPollTimer: number | null = null;
  private callPollInFlight = false;
  private callSignalAfterId = 0;
  private callSignalSince = 0;
  private visibilityHandler: (() => void) | null = null;
  private pendingCallEvents = new Map<string, any[]>();
  private seenCallSignalIds = new Set<number>();

  connect(token: string) {
    const changed = this.token !== token;
    this.token = token;

    if (changed) {
      this.callSignalAfterId = 0;
      this.callSignalSince = Date.now() - 120_000;
      this.seenCallSignalIds.clear();
    }

    this.startCallPolling();

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

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
        } catch (error) {
          console.warn('SYNAX WebSocket message parse failed:', error);
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.emit('connection:closed', { status: 'disconnected' });
        this.scheduleReconnect();
        // Call polling intentionally remains active.
        this.startCallPolling();
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || !this.token) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token) this.connect(this.token);
    }, 3000);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
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
    if (!payload?.callId || !String(payload?.type || '').startsWith('call:')) {
      this.emit('call:error', { error: 'Invalid call signal.' });
      return false;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

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
        signal: controller.signal,
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.emit('call:error', { error: body.error || 'Call signaling failed.' });
        return false;
      }
      return true;
    } catch (error) {
      console.error('SYNAX call signal request failed:', error);
      this.emit('call:error', { error: 'Unable to reach the call signaling service.' });
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async getCallOffer(callId: string): Promise<any | null> {
    const token = this.token;
    if (!token || !callId) return null;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);

    try {
      const url = `/api/call/signals?callId=${encodeURIComponent(callId)}&since=${encodeURIComponent(Date.now() - 120_000)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data.signals) ? data.signals : [];
      return rows.find((row: any) => row?.payload?.type === 'call:offer')?.payload || null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private startCallPolling() {
    if (this.callPollTimer !== null || !this.token) return;

    if (!this.callSignalSince) this.callSignalSince = Date.now() - 120_000;

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') void this.pollCallSignals();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    void this.pollCallSignals();
    this.callPollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.pollCallSignals();
    }, 500);
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

      if (!res.ok) return;

      const data = await res.json();
      const signals = Array.isArray(data.signals) ? data.signals : [];

      for (const row of signals) {
        const rowId = Number(row?.id || 0);
        if (rowId > 0) {
          this.callSignalAfterId = Math.max(this.callSignalAfterId, rowId);
          if (this.seenCallSignalIds.has(rowId)) continue;
          this.seenCallSignalIds.add(rowId);

          if (this.seenCallSignalIds.size > 1000) {
            const first = this.seenCallSignalIds.values().next().value;
            if (typeof first === 'number') this.seenCallSignalIds.delete(first);
          }
        }

        const payload = row?.payload;
        if (!payload?.type?.startsWith('call:')) continue;

        const eventName = payload.type === 'call:offer' ? 'call:incoming' : payload.type;
        this.emit(eventName, {
          ...payload,
          _signalId: rowId || undefined,
          _signalCreatedAt: row?.created_at,
        });
      }
    } catch (error) {
      // Call transport errors must never interrupt the rest of SYNAX.
      console.warn('SYNAX call polling failed:', error);
    } finally {
      this.callPollInFlight = false;
    }
  }

  private stopCallPolling() {
    if (this.callPollTimer !== null) {
      window.clearInterval(this.callPollTimer);
      this.callPollTimer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
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
          try { callback(payload); } catch (error) { console.error(error); }
        }
      }
    }

    return () => this.off(event, callback);
  }

  off(event: string, callback: EventCallback) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit(event: string, data: any) {
    const set = this.listeners.get(event);
    if (set?.size) {
      set.forEach((callback) => {
        try { callback(data); } catch (error) { console.error(`SYNAX ${event} listener error:`, error); }
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
    this.stopCallPolling();
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
