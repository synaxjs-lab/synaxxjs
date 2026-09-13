import {
  AuthSession,
  ChatMessage,
  AppSettings,
  UserProfile,
  TimeStatus,
  ActivityLog
} from '../types';

let authToken: string | null = null;
let adminAuthToken: string | null = null;

export const ApiService = {
  setToken(token: string | null) {
    authToken = token;
    if (token) {
      sessionStorage.setItem('synax_token', token);
      localStorage.setItem('synax_user_token', token);
    } else {
      sessionStorage.removeItem('synax_token');
      localStorage.removeItem('synax_user_token');
    }
  },

  setAdminToken(token: string | null) {
    adminAuthToken = token;
    if (token) sessionStorage.setItem('synax_admin_token', token);
    else sessionStorage.removeItem('synax_admin_token');
  },

  getAdminToken(): string | null {
    if (!adminAuthToken && typeof window !== 'undefined') {
      adminAuthToken = sessionStorage.getItem('synax_admin_token');
    }
    return adminAuthToken;
  },

  getToken(): string | null {
    if (!authToken && typeof window !== 'undefined') {
      authToken = sessionStorage.getItem('synax_token') || localStorage.getItem('synax_user_token');
    }
    return authToken;
  },

  async getConfig(): Promise<{
    person1: UserProfile;
    person2: UserProfile;
    settings: AppSettings;
    timeStatus: TimeStatus | null;
  }> {
    const res = await fetch('/api/public/identities');
    if (!res.ok) throw new Error('Failed to load sanctuary configuration');
    const data = await res.json();
    const settings: AppSettings = data.settings || {
      worldTitle: data.worldTitle,
      worldSubtitle: data.worldSubtitle,
      theme: data.theme,
      accentColor: data.accentColor,
      introDurationSeconds: data.introDurationSeconds,
      welcomeMessage: 'Welcome to your private sanctuary. Every conversation belongs solely to you two.',
      chatWallpaper: 'stars',
      timeOverMessage: 'Your time in SYNAX has ended for now. See you again soon ✨',
      timeStrategy: 'continuous',
      warningMinutes: [10, 5, 1],
      restrictionsOnExpire: {
        disableMessaging: true,
        disableVoiceCalls: true,
        disableVideoCalls: true,
        disableImages: true,
        disableFiles: true,
        disableVoiceMessages: true,
        lockSession: false,
      },
      featuresEnabled: {
        messages: true,
        reactions: true,
        imageSharing: true,
        fileSharing: true,
        voiceMessages: true,
        voiceCalls: true,
        videoCalls: true,
        editing: true,
        deleting: true,
      },
    };
    return {
      person1: data.person_1,
      person2: data.person_2,
      settings,
      timeStatus: null,
    };
  },

  async login(userId: 'person_1' | 'person_2', password: string): Promise<AuthSession> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Authentication failed');
    }
    ApiService.setToken(data.token);
    return data;
  },

  async loginUser(userId: 'person_1' | 'person_2', password: string): Promise<AuthSession> {
    return this.login(userId, password);
  },

  async adminLogin(password: string): Promise<{ token: string; role: 'admin'; settings: AppSettings }> {
    const res = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Invalid admin credentials');
    }
    ApiService.setAdminToken(data.token);
    return data;
  },

  async loginAdmin(password: string) {
    return this.adminLogin(password);
  },

  async logout(): Promise<void> {
    const token = ApiService.getToken();
    if (token) {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch {}
    }
    ApiService.setToken(null);
  },

  async adminLogout(): Promise<void> {
    const token = ApiService.getAdminToken();
    if (token) {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch {}
    }
    ApiService.setAdminToken(null);
  },

  async getMe(): Promise<{
    user: UserProfile;
    otherUser: UserProfile;
    settings: AppSettings;
    timeStatus: TimeStatus;
  }> {
    const token = ApiService.getToken();
    if (!token) throw new Error('No auth token available');
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      ApiService.setToken(null);
      throw new Error('Session expired');
    }
    return res.json();
  },

  async getTimeStatus(): Promise<TimeStatus | null> {
    try {
      const me = await ApiService.getMe();
      return me.timeStatus;
    } catch {
      return null;
    }
  },

  async updateOwnProfile(data: { pfpUrl?: string; nickname?: string; bio?: string }): Promise<UserProfile> {
    const token = ApiService.getToken();
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to update profile');
    return result.user;
  },

  async getMessages(): Promise<ChatMessage[]> {
    const token = ApiService.getToken();
    const res = await fetch('/api/messages', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch messages');
    return data.messages;
  },

  async markMessagesAsRead(): Promise<void> {
    const token = ApiService.getToken();
    if (!token) return;
    try {
      await fetch('/api/messages/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (e) {
      console.warn('Failed to mark messages as read:', e);
    }
  },

  async sendMessage(payload: {
    text?: string;
    type?: 'text' | 'image' | 'file' | 'voice';
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    audioDuration?: number;
    replyTo?: { id: string; text: string; senderName: string };
  }): Promise<ChatMessage> {
    const token = ApiService.getToken();
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to send message');
    }
    return data.message;
  },

  async toggleReaction(messageId: string, emoji: string) {
    const token = ApiService.getToken();
    const res = await fetch(`/api/messages/${messageId}/reaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ emoji }),
    });
    return res.json();
  },

  async editMessage(messageId: string, text: string) {
    const token = ApiService.getToken();
    const res = await fetch(`/api/messages/${messageId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to edit message');
    return data.message;
  },

  async deleteMessage(messageId: string) {
    const token = ApiService.getToken();
    const res = await fetch(`/api/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to delete message');
    return res.json();
  },

  async togglePin(messageId: string) {
    const token = ApiService.getToken();
    const res = await fetch(`/api/messages/${messageId}/pin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  async uploadFile(file: File | Blob, originalName?: string): Promise<{ fileUrl: string; fileName: string; fileSize: number }> {
    const token = ApiService.getToken();
    const formData = new FormData();
    formData.append('file', file, originalName || (file as File).name || 'audio.webm');

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'File upload failed');
    return data;
  },

  // ==========================================
  // Admin Service Methods
  // ==========================================
  async adminGetUsers(): Promise<UserProfile[]> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/overview', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load admin users');
    const data = await res.json();
    return [data.users.person_1, data.users.person_2];
  },

  async adminGetSettings(): Promise<AppSettings> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/overview', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load admin settings');
    const data = await res.json();
    return data.settings;
  },

  async adminGetAuditLogs(): Promise<ActivityLog[]> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/logs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || [];
  },

  async adminGetMessages(): Promise<ChatMessage[]> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/messages', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load admin messages');
    const data = await res.json();
    return data.messages || [];
  },

  async adminGetSessions(): Promise<any[]> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/sessions', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load admin sessions');
    const data = await res.json();
    return data.sessions || [];
  },

  async adminUpdateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update settings');
    return data.settings;
  },

  async adminUpdateUser(userId: 'person_1' | 'person_2', data: any) {
    const token = ApiService.getAdminToken();
    const payload: any = {};
    payload[userId] = data;

    const res = await fetch('/api/admin/users', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const resData = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        resData.error || resData.message || 'Failed to update user'
      );
    }

    // If locked status changed
    if (data.isLocked !== undefined) {
      await fetch(`/api/admin/user/${userId}/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isLocked: data.isLocked, lockReason: data.lockReason }),
      });
    }

    return resData;
  },

  async adminAdjustUserTime(
    userId: 'person_1' | 'person_2',
    options: { setMinutes?: number; addMinutes?: number; resetSession?: boolean }
  ): Promise<TimeStatus> {
    const token = ApiService.getAdminToken();
    const res = await fetch(`/api/admin/user/${userId}/reset-time`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(options),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data.error || data.message || 'Failed to adjust user time'
      );
    }
    return data.timeStatus;
  },

  async adminSetTimeLimit(
    userId: 'person_1' | 'person_2',
    minutes: number
  ): Promise<TimeStatus> {
    return ApiService.adminAdjustUserTime(userId, {
      setMinutes: minutes,
    });
  },

  async adminAddTime(
    userId: 'person_1' | 'person_2',
    minutes: number
  ): Promise<TimeStatus> {
    return ApiService.adminAdjustUserTime(userId, {
      addMinutes: minutes,
    });
  },

  async adminRemoveTime(
    userId: 'person_1' | 'person_2',
    minutes: number
  ): Promise<TimeStatus> {
    return ApiService.adminAdjustUserTime(userId, {
      addMinutes: -Math.abs(minutes),
    });
  },

  async adminResetUserUsage(
    userId: 'person_1' | 'person_2'
  ): Promise<TimeStatus> {
    return ApiService.adminAdjustUserTime(userId, {
      resetSession: true,
    });
  },

  async adminGrantExtraTime(minutes: number): Promise<TimeStatus> {
    const first = await ApiService.adminAddTime('person_1', minutes);
    const second = await ApiService.adminAddTime('person_2', minutes);
    return second || first;
  },

  async adminResetTimeUsage(): Promise<TimeStatus> {
    const first = await ApiService.adminResetUserUsage('person_1');
    const second = await ApiService.adminResetUserUsage('person_2');
    return second || first;
  },

  async adminClearMessages() {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/messages/clear', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  async adminUpdatePassword(currentPassword: string, newPassword: string) {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update administrator password');
    return data;
  },

  async adminResetDefaults() {
    const token = ApiService.getAdminToken();
    const res = await fetch('/api/admin/reset-defaults', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Factory reset failed');
    return data;
  },
};
