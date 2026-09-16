import React, { useState, useEffect, useRef } from 'react';
import {
  UserProfile,
  ChatMessage,
  AppSettings,
  TimeStatus,
} from '../types';
import { MessageItem } from './MessageItem';
import { MessageComposer } from './MessageComposer';
import { TimeBanner, TimeRemainingPill } from './TimeBanner';
import { LogoMark } from './LogoMark';
import {
  Phone,
  Video,
  Search,
  Pin,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { socketService } from '../services/socket';
import { SoundEffects } from '../services/sound';

interface ChatRoomProps {
  currentUser: UserProfile;
  otherUser: UserProfile;
  initialMessages: ChatMessage[];
  settings: AppSettings;
  timeStatus: TimeStatus | null;
  onLogout: () => void;
  onOpenProfile: () => void;
  onStartCall: (callType: 'voice' | 'video') => void;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({
  currentUser,
  otherUser,
  initialMessages,
  settings,
  timeStatus,
  onLogout,
  onOpenProfile,
  onStartCall,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages || []);
  const [otherPresence, setOtherPresence] = useState<{ isOnline: boolean; lastSeen: number }>({
    isOnline: false,
    lastSeen: otherUser.lastActiveTimestamp || Date.now(),
  });
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const [displayedTimeStatus, setDisplayedTimeStatus] = useState<TimeStatus | null>(timeStatus);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const lastScrollTopRef = useRef(0);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({
      behavior,
      block: 'end',
    });
  };


  // Keep a live 1-second countdown between authoritative server ticks.
  // Server timestamps remain the source of truth; this only makes the UI smooth.
  useEffect(() => {
    setDisplayedTimeStatus(timeStatus);
  }, [timeStatus]);

  useEffect(() => {
    if (!timeStatus) return;

    const interval = window.setInterval(() => {
      setDisplayedTimeStatus((previous) => {
        if (!previous || previous.isExpired) return previous;

        const elapsedSinceServerTick = Math.max(
          0,
          Math.floor((Date.now() - previous.serverTimestamp) / 1000)
        );

        const nextRemaining = Math.max(
          0,
          previous.remainingSeconds - elapsedSinceServerTick
        );

        return {
          ...previous,
          remainingSeconds: nextRemaining,
          isExpired: nextRemaining <= 0,
        };
      });
    }, 250);

    return () => window.clearInterval(interval);
  }, [timeStatus]);

  useEffect(() => {
    scrollToBottom('auto');
  }, []);

  // Follow the latest message only when the user is already at the bottom.
  // Use an instant scroll so mobile never gets the laggy animation.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distanceFromBottom < 180) {
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages.length, isOtherTyping]);

  // Real-time WebSocket Listeners
  useEffect(() => {
    const unsubMsg = socketService.on('chat:new_message', (data) => {
      if (data.message) {
        setMessages((prev) => {
          // Guard against duplicates
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });

        if (data.message.senderId === otherUser.id) {
          SoundEffects.playReceived();
          ApiService.markMessagesAsRead();
          socketService.sendMarkRead();
        }
      }
    });

    const unsubRead = socketService.on('chat:messages_read', (data) => {
      if (data.readerId === otherUser.id) {
        setMessages((prev) =>
          prev.map((m) => (m.senderId === currentUser.id ? { ...m, status: 'read' } : m))
        );
      }
    });

    const unsubDelivered = socketService.on('chat:messages_delivered', (data) => {
      if (data.recipientId === otherUser.id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.senderId === currentUser.id && m.status === 'sent' ? { ...m, status: 'delivered' } : m
          )
        );
      }
    });

    const unsubReaction = socketService.on('chat:reaction_update', (data) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m))
      );
    });

    const unsubEdit = socketService.on('chat:message_edited', (data) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, text: data.text, isEdited: true } : m
        )
      );
    });

    const unsubDelete = socketService.on('chat:message_deleted', (data) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, deleted: true, text: 'This message was deleted' } : m
        )
      );
    });

    const unsubPin = socketService.on('chat:message_pinned', (data) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m))
      );
    });

    const unsubTyping = socketService.on('typing:update', (data) => {
      if (data.userId === otherUser.id) {
        setIsOtherTyping(!!data.isTyping);
      }
    });

    const unsubPresence = socketService.on('presence:update', (data) => {
      if (data.presence) {
        const isOnline = otherUser.id === 'person_1' ? data.presence.person_1 : data.presence.person_2;
        const lastSeen = otherUser.id === 'person_1' ? data.presence.lastSeen_1 : data.presence.lastSeen_2;
        setOtherPresence({ isOnline, lastSeen });
      }
    });

    const unsubCleared = socketService.on('chat:history_cleared', () => {
      setMessages([
        {
          id: `msg_clr_${Date.now()}`,
          senderId: 'system',
          type: 'system',
          text: '✦ Chat history was cleared by the Administrator. A fresh chapter begins.',
          timestamp: Date.now(),
          status: 'read',
          reactions: {},
        },
      ]);
    });

    // Mark any existing unread messages from partner as read on mount
    ApiService.markMessagesAsRead();
    socketService.sendMarkRead();

    return () => {
      unsubMsg();
      unsubRead();
      unsubDelivered();
      unsubReaction();
      unsubEdit();
      unsubDelete();
      unsubPin();
      unsubTyping();
      unsubPresence();
      unsubCleared();
    };
  }, [otherUser.id]);

  // Message Send Handlers
  const handleSendMessage = async (payload: any) => {
    try {
      const newMsg = await ApiService.sendMessage({
        ...payload,
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              text: replyingTo.text || 'Attachment',
              senderName: replyingTo.senderId === currentUser.id ? 'You' : otherUser.name,
            }
          : undefined,
      });
      setReplyingTo(null);
      SoundEffects.playSent();

      // Put a newly-sent message at the latest position immediately.
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err: any) {
      console.error('Failed to send message:', err);
    }
  };

  const handleTyping = (isTyping: boolean) => {
    socketService.sendTyping(isTyping);
  };

  const handleUpload = async (file: File | Blob, name?: string) => {
    return await ApiService.uploadFile(file, name);
  };

  const handleReact = async (messageId: string, emoji: string) => {
    await ApiService.toggleReaction(messageId, emoji);
  };

  const handlePin = async (messageId: string) => {
    await ApiService.togglePin(messageId);
  };

  const handleEdit = async (messageId: string, text: string) => {
    await ApiService.editMessage(messageId, text);
  };

  const handleDelete = async (messageId: string) => {
    await ApiService.deleteMessage(messageId);
  };

  // Filter messages if search query active
  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const pinnedMessage = messages.find((m) => m.isPinned && !m.deleted);

  const formatLastSeen = (timestamp: number) => {
    if (!timestamp) return 'Recently';
    const d = new Date(timestamp);
    return `Last seen ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };


  return (
    <div
      id="synax-chat-room"
      className="fixed inset-0 z-10 w-full h-[100dvh] overflow-hidden bg-[#04060c] text-slate-100 select-none"
    >
      {/* Server timer visibility is controlled by Admin. */}
      {(settings as AppSettings & { showTimerToUsers?: boolean }).showTimerToUsers !== false &&
        displayedTimeStatus && (
          <div className="hidden md:block shrink-0">
            <TimeBanner timeStatus={displayedTimeStatus} />
          </div>
        )}

      {/* Fixed header. It does not animate or move while scrolling. */}
      <header className="absolute inset-x-0 top-0 z-40 w-full bg-slate-950 border-b border-slate-800/80">
        <div className="w-full min-w-0 px-2 sm:px-4 md:px-6 py-2">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            {/* Other user */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden border-2 border-indigo-500/50 shrink-0">
                <img
                  src={otherUser.pfpUrl || ''}
                  alt={otherUser.name}
                  className="block w-full h-full object-cover object-center"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = 'none';
                    const fallback = img.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div
                  className="absolute inset-0 hidden items-center justify-center bg-slate-900 text-indigo-200 font-semibold text-sm"
                  aria-hidden="true"
                >
                  {(otherUser.nickname || otherUser.name || '?').charAt(0).toUpperCase()}
                </div>
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                    otherPresence.isOnline
                      ? 'bg-emerald-500'
                      : 'bg-slate-500'
                  }`}
                />
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h2 className="min-w-0 max-w-[100px] sm:max-w-[220px] truncate text-sm sm:text-base font-bold text-white font-cinzel tracking-anime-header">
                    {otherUser.nickname || otherUser.name}
                  </h2>

                  <div className="shrink-0" title={`Personal Mark: ${otherUser.logo.name}`}>
                    <LogoMark
                      logo={otherUser.logo}
                      size="sm"
                      glow={false}
                      className="opacity-75"
                    />
                  </div>
                </div>

                <p className="text-[9px] sm:text-[11px] truncate">
                  {isOtherTyping ? (
                    <span className="text-indigo-400">typing...</span>
                  ) : otherPresence.isOnline ? (
                    <span className="text-emerald-400">Online</span>
                  ) : (
                    <span className="text-slate-400">
                      {formatLastSeen(otherPresence.lastSeen)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Controls: compact enough to stay visible on narrow phones */}
            <div className="shrink-0 flex items-center gap-1 md:gap-0">
              {(settings as AppSettings & { showTimerToUsers?: boolean }).showTimerToUsers !== false &&
                displayedTimeStatus && (
                  <div className="shrink-0 min-w-[72px] sm:min-w-[82px] md:hidden">
                    <TimeRemainingPill
                      secondsLeft={displayedTimeStatus.remainingSeconds}
                      isExpired={displayedTimeStatus.isExpired}
                    />
                  </div>
                )}

              {settings.featuresEnabled.voiceCalls && (
                <button
                  id="start-voice-call-btn-mobile"
                  type="button"
                  onClick={() => onStartCall('voice')}
                  disabled={
                    !!(
                      timeStatus?.isExpired &&
                      settings.restrictionsOnExpire.disableVoiceCalls
                    )
                  }
                  className="md:hidden w-9 h-9 rounded-xl bg-slate-900 border border-slate-700/80 text-indigo-300 flex items-center justify-center shrink-0 disabled:opacity-40"
                  title="Voice call"
                >
                  <Phone className="w-4 h-4" />
                </button>
              )}

              {settings.featuresEnabled.videoCalls && (
                <button
                  id="start-video-call-btn-mobile"
                  type="button"
                  onClick={() => onStartCall('video')}
                  disabled={
                    !!(
                      timeStatus?.isExpired &&
                      settings.restrictionsOnExpire.disableVideoCalls
                    )
                  }
                  className="md:hidden w-9 h-9 rounded-xl bg-slate-900 border border-slate-700/80 text-pink-300 flex items-center justify-center shrink-0 disabled:opacity-40"
                  title="Video call"
                >
                  <Video className="w-4 h-4" />
                </button>
              )}

              {/* Mobile profile settings replaces search for easier access on phones. */}
              <button
                id="open-profile-settings-btn-mobile"
                type="button"
                onClick={onOpenProfile}
                className="md:hidden w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-center shrink-0"
                title="Profile settings"
                aria-label="Profile settings"
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Mobile logout only. It is hidden on desktop to avoid duplicate controls. */}
              <button
                id="user-logout-btn-mobile"
                type="button"
                onClick={onLogout}
                className="md:hidden w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-center shrink-0 hover:text-red-400"
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>

              {/* Desktop controls are shown only at md+ so they cannot duplicate the compact controls. */}
              <div className="hidden md:flex items-center gap-2 ml-1">
                <button
                  id="start-voice-call-btn"
                  type="button"
                  onClick={() => onStartCall('voice')}
                  disabled={
                    !!(
                      timeStatus?.isExpired &&
                      settings.restrictionsOnExpire.disableVoiceCalls
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-indigo-300 flex items-center gap-1.5 text-xs disabled:opacity-40"
                  title="Start encrypted voice call"
                >
                  <Phone className="w-4 h-4" />
                  Call
                </button>

                <button
                  id="start-video-call-btn"
                  type="button"
                  onClick={() => onStartCall('video')}
                  disabled={
                    !!(
                      timeStatus?.isExpired &&
                      settings.restrictionsOnExpire.disableVideoCalls
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-pink-300 flex items-center gap-1.5 text-xs disabled:opacity-40"
                  title="Start private video call"
                >
                  <Video className="w-4 h-4" />
                  Video
                </button>

                <button
                  id="open-profile-settings-btn"
                  type="button"
                  onClick={onOpenProfile}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400"
                  title="Profile settings"
                >
                  <Settings className="w-4 h-4" />
                </button>

                <button
                  id="user-logout-btn"
                  type="button"
                  onClick={onLogout}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400"
                  title="Lock & Exit Sanctuary"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Mobile search */}
          {isSearching && (
            <div className="mt-2 w-full flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="min-w-0 flex-1 bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-[16px] text-white placeholder-slate-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-slate-400 shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Only this area scrolls */}
      <main
        ref={messagesContainerRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 pt-[66px] md:pt-[122px] pb-[108px] md:pb-[92px]"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {pinnedMessage && (
          <div className="w-full bg-slate-950 border-b border-indigo-500/20 px-3 py-2 flex items-center justify-between text-[10px] sm:text-xs text-indigo-200">
            <div className="flex min-w-0 items-center gap-2 truncate">
              <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
              <span className="font-semibold text-slate-300 shrink-0">Pinned:</span>
              <span className="truncate italic">"{pinnedMessage.text}"</span>
            </div>
            <button
              type="button"
              onClick={() => handlePin(pinnedMessage.id)}
              className="text-[11px] text-slate-400 shrink-0 ml-2"
            >
              Unpin
            </button>
          </div>
        )}

        <div className="min-h-full pb-2">
          {/* Smaller mobile welcome card */}
          <div className="w-full max-w-lg mx-auto mt-2 mb-4 sm:my-6 px-4 py-3 sm:p-6 rounded-2xl sm:rounded-3xl bg-slate-950/75 border border-slate-800/80 text-center shadow-xl">
            <div className="flex items-center justify-center gap-2.5 sm:gap-4 mb-2 sm:mb-3">
              <LogoMark logo={currentUser.logo} size="sm" glow={true} />
              <span className="text-indigo-400 text-xs">✦</span>
              <LogoMark logo={otherUser.logo} size="sm" glow={true} />
            </div>

            <h3 className="text-base sm:text-lg font-bold text-white font-cinzel tracking-anime-title mb-1">
              {settings.worldTitle || 'SYNAX'}
            </h3>

            <p className="text-[10px] sm:text-xs leading-relaxed text-slate-300/80 italic">
              {settings.welcomeMessage ||
                'Welcome to your private sanctuary. Every conversation belongs solely to you two.'}
            </p>
          </div>

          {filteredMessages.map((msg) => {
            const sender =
              msg.senderId === currentUser.id
                ? currentUser
                : otherUser;

            return (
              <MessageItem
                key={msg.id}
                message={msg}
                currentUserId={currentUser.id}
                senderName={sender.name}
                senderPfp={
                  sender.pfpUrl ||
                  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                }
                onReact={handleReact}
                onReply={(m) => setReplyingTo(m)}
                onPin={handlePin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onOpenImage={(url) => setLightboxImage(url)}
              />
            );
          })}

          {isOtherTyping && (
            <div className="flex items-center gap-2 px-2.5 sm:px-4 py-2 text-xs text-slate-400">
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                <img
                  src={
                    otherUser.pfpUrl ||
                    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100'
                  }
                  alt={otherUser.name}
                  className="block w-full h-full object-cover"
                />
              </div>
              <div className="flex gap-1 items-center px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-px" />
        </div>
      </main>

      {/* Fixed composer. Safe-area is filled with the same dark background, so no strip shows. */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 w-full bg-slate-950"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <MessageComposer
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          onUpload={handleUpload}
          isExpired={timeStatus?.isExpired}
          settings={settings}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90"
          onClick={() => setLightboxImage(null)}
        >
          <img
            src={lightboxImage}
            alt="Preview"
            className="max-w-full max-h-[90vh] object-contain rounded-2xl"
          />
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 p-2 rounded-full bg-slate-900 text-white"
            aria-label="Close preview"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
};
