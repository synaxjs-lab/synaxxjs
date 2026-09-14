import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  const [showMobileHeader, setShowMobileHeader] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);

  // Auto-scroll on new message
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    let ticking = false;

    const updateHeader = () => {
      ticking = false;
      if (window.innerWidth >= 768) {
        if (!showMobileHeader) setShowMobileHeader(true);
        return;
      }

      const currentTop = container.scrollTop;
      const lastTop = lastScrollTopRef.current;
      const delta = currentTop - lastTop;

      if (currentTop <= 8) {
        setShowMobileHeader(true);
      } else if (delta >= 6) {
        setShowMobileHeader(false);
      } else if (delta <= -6) {
        setShowMobileHeader(true);
      }

      lastScrollTopRef.current = currentTop;
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateHeader);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [showMobileHeader]);

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
      className="relative z-10 w-full h-[100dvh] min-h-0 flex flex-col bg-[#04060c]/80 backdrop-blur-sm text-slate-100 overflow-hidden select-none"
    >
      {/* =====================================================
          MOBILE COMPACT CHROME
          - No large TimeBanner on mobile
          - One compact row only
          - Slides away while reading / messaging
          - Returns smoothly when scrolling upward
      ====================================================== */}
      <AnimatePresence initial={false}>
        {showMobileHeader && (
          <motion.div
            key="mobile-chat-header"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="md:hidden shrink-0 relative z-40 bg-slate-950 border-b border-slate-800/80"
          >
            <div className="w-full min-w-0 h-[62px] px-1.5 flex items-center gap-1">
              {/* PFP */}
              <div className="relative shrink-0 w-9 h-9 rounded-full overflow-hidden border-2 border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.2)]">
                <img
                  src={
                    otherUser.pfpUrl ||
                    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200'
                  }
                  alt={otherUser.name}
                  className="block w-full h-full object-cover object-center"
                />
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                    otherPresence.isOnline
                      ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                      : 'bg-slate-500'
                  }`}
                />
              </div>

              {/* Name + logo */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center min-w-0 gap-1">
                  <h2 className="min-w-0 max-w-[70px] xs:max-w-[92px] truncate text-[11px] font-bold text-white font-cinzel tracking-anime-header text-shadow-anime-glow">
                    {otherUser.nickname || otherUser.name}
                  </h2>
                  <div className="shrink-0 flex items-center justify-center">
                    <LogoMark
                      logo={otherUser.logo}
                      size="sm"
                      glow={false}
                      className="opacity-75 scale-90"
                    />
                  </div>
                </div>
                <p className="text-[9px] text-slate-400 truncate tracking-wide">
                  {isOtherTyping ? (
                    <span className="text-indigo-400 animate-pulse">typing...</span>
                  ) : otherPresence.isOnline ? (
                    <span className="text-emerald-400">Online</span>
                  ) : (
                    formatLastSeen(otherPresence.lastSeen)
                  )}
                </p>
              </div>

              {/* Timer: dedicated non-overlapping space */}
              {timeStatus && (
                <div className="shrink-0 flex items-center justify-center min-w-[70px]">
                  <TimeRemainingPill
                    secondsLeft={timeStatus.remainingSeconds}
                    isExpired={timeStatus.isExpired}
                  />
                </div>
              )}

              {/* Compact controls */}
              <div className="shrink-0 flex items-center gap-0.5">
                {settings.featuresEnabled.voiceCalls && (
                  <button
                    id="start-voice-call-btn-mobile"
                    type="button"
                    onClick={() => onStartCall('voice')}
                    disabled={!!(timeStatus?.isExpired && settings.restrictionsOnExpire.disableVoiceCalls)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-900 border border-slate-700/80 text-indigo-300 disabled:opacity-40"
                    title="Voice call"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                )}

                {settings.featuresEnabled.videoCalls && (
                  <button
                    id="start-video-call-btn-mobile"
                    type="button"
                    onClick={() => onStartCall('video')}
                    disabled={!!(timeStatus?.isExpired && settings.restrictionsOnExpire.disableVideoCalls)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-900 border border-slate-700/80 text-pink-300 disabled:opacity-40"
                    title="Video call"
                  >
                    <Video className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsSearching((prev) => !prev)}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                    isSearching
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                  title="Search"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>

                <button
                  id="open-profile-settings-btn-mobile"
                  type="button"
                  onClick={onOpenProfile}
                  className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0"
                  title="Profile settings"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>

                <button
                  id="user-logout-btn-mobile"
                  type="button"
                  onClick={onLogout}
                  className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0"
                  title="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================
          DESKTOP CHROME - unchanged layout
      ====================================================== */}
      <div className="hidden md:block shrink-0 relative z-40">
        <TimeBanner timeStatus={timeStatus} />

        <header className="w-full px-4 sm:px-6 py-3 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <img
                src={otherUser.pfpUrl || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200'}
                alt={otherUser.name}
                className="w-10 h-10 rounded-full object-cover border-2 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
              />
              <span
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${
                  otherPresence.isOnline
                    ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                    : 'bg-slate-500'
                }`}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="truncate text-sm sm:text-base font-bold text-white font-cinzel tracking-anime-header text-shadow-anime-glow">
                  {otherUser.nickname || otherUser.name}
                </h2>
                <div title={`Personal Mark: ${otherUser.logo.name}`} className="shrink-0">
                  <LogoMark
                    logo={otherUser.logo}
                    size="sm"
                    glow={false}
                    className="opacity-70 hover:opacity-100"
                  />
                </div>
              </div>

              <p className="text-[11px] font-sans-celestial flex items-center gap-1.5 tracking-wide">
                {isOtherTyping ? (
                  <span className="text-indigo-400 animate-pulse font-medium">typing...</span>
                ) : otherPresence.isOnline ? (
                  <span className="text-emerald-400">Online</span>
                ) : (
                  <span className="text-slate-400">{formatLastSeen(otherPresence.lastSeen)}</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {timeStatus && (
              <div className="relative z-50 shrink-0">
                <TimeRemainingPill
                  secondsLeft={timeStatus.remainingSeconds}
                  isExpired={timeStatus.isExpired}
                />
              </div>
            )}

            {settings.featuresEnabled.voiceCalls && (
              <button
                id="start-voice-call-btn"
                type="button"
                onClick={() => onStartCall('voice')}
                disabled={!!(timeStatus?.isExpired && settings.restrictionsOnExpire.disableVoiceCalls)}
                className="p-2 sm:px-3 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-700/80 hover:border-indigo-500/50 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
                title="Start encrypted voice call"
              >
                <Phone className="w-4 h-4 text-indigo-400" />
                <span>Call</span>
              </button>
            )}

            {settings.featuresEnabled.videoCalls && (
              <button
                id="start-video-call-btn"
                type="button"
                onClick={() => onStartCall('video')}
                disabled={!!(timeStatus?.isExpired && settings.restrictionsOnExpire.disableVideoCalls)}
                className="p-2 sm:px-3 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-pink-300 border border-slate-700/80 hover:border-pink-500/50 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
                title="Start private video call"
              >
                <Video className="w-4 h-4 text-pink-400" />
                <span>Video</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsSearching(!isSearching)}
              className={`p-2 rounded-xl border transition-all ${
                isSearching
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Search conversation"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              id="open-profile-settings-btn"
              type="button"
              onClick={onOpenProfile}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
              title="Change your PFP & Profile"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              id="user-logout-btn"
              type="button"
              onClick={onLogout}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
              title="Lock & Exit Sanctuary"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
      </div>

      {/* Search Input Filter Bar */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full bg-slate-900/90 border-b border-slate-800 px-4 py-2 flex items-center gap-2 z-10"
          >
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search private messages..."
              autoFocus
              className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-white text-xs">
                Clear
              </button>
            )}
            <button onClick={() => setIsSearching(false)} className="text-slate-400 hover:text-white p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pinned Message Bar */}
      {pinnedMessage && (
        <div className="w-full bg-slate-950/60 border-b border-indigo-500/20 px-4 py-2 flex items-center justify-between text-xs text-indigo-200 backdrop-blur-md z-10">
          <div className="flex items-center gap-2 truncate">
            <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
            <span className="font-semibold text-slate-300">Pinned:</span>
            <span className="truncate italic">"{pinnedMessage.text}"</span>
          </div>
          <button
            onClick={() => handlePin(pinnedMessage.id)}
            className="text-[11px] text-slate-400 hover:text-white shrink-0 ml-2"
          >
            Unpin
          </button>
        </div>
      )}

      {/* Chat Messages Flow Stage - this is the only scrolling region */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 py-4 space-y-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Welcome Universe Card */}
        <div className="w-full max-w-lg mx-auto my-6 p-6 rounded-3xl bg-slate-950/60 border border-slate-800/80 text-center shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-center gap-4 mb-3">
            <LogoMark logo={currentUser.logo} size="sm" glow={true} />
            <span className="text-indigo-400 text-xs">✦</span>
            <LogoMark logo={otherUser.logo} size="sm" glow={true} />
          </div>
          <h3 className="text-lg font-bold text-white font-cinzel tracking-anime-title text-shadow-cinematic mb-1">
            {settings.worldTitle || 'SYNAX'}
          </h3>
          <p className="text-xs text-slate-300/80 italic font-sans-celestial tracking-wide">
            {settings.welcomeMessage || 'Welcome to your private sanctuary. Every conversation belongs solely to you two.'}
          </p>
        </div>

        {/* Render Chat Messages */}
        {filteredMessages.map((msg) => {
          const sender = msg.senderId === currentUser.id ? currentUser : otherUser;
          return (
            <MessageItem
              key={msg.id}
              message={msg}
              currentUserId={currentUser.id}
              senderName={sender.name}
              senderPfp={sender.pfpUrl}
              onReact={handleReact}
              onReply={(m) => setReplyingTo(m)}
              onPin={handlePin}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOpenImage={(url) => setLightboxImage(url)}
            />
          );
        })}

        {/* Typing indicator bubble */}
        {isOtherTyping && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-2 text-xs text-slate-400"
          >
            <img
              src={
                otherUser.pfpUrl ||
                'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100'
              }
              alt={otherUser.name}
              className="w-6 h-6 rounded-full object-cover"
            />
            <div className="flex gap-1 items-center px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer at Bottom */}
      <div
        className="fixed md:static left-0 right-0 bottom-0 z-50 md:z-auto w-full md:shrink-0"
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

      {/* Image Lightbox Modal */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxImage(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
          >
            <img
              src={lightboxImage}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-6 right-6 p-2 rounded-full bg-slate-900/80 text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
