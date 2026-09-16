import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { CosmicBackground } from './components/CosmicBackground';
import { CinematicIntro } from './components/CinematicIntro';
import { IdentitySelect } from './components/IdentitySelect';
import { PasswordModal } from './components/PasswordModal';
import { ChatRoom } from './components/ChatRoom';
import { AdminPanel } from './components/AdminPanel';
import { AdminLoginModal } from './components/AdminLoginModal';
import { UserProfileModal } from './components/UserProfileModal';
import { CallModal, ActiveCallState } from './components/CallModal';
import { UserProfile, AppSettings, TimeStatus, ChatMessage } from './types';
import { ApiService } from './services/api';
import { socketService } from './services/socket';
import { SoundEffects } from './services/sound';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [viewState, setViewState] = useState<'loading' | 'intro' | 'select' | 'password' | 'chat' | 'admin'>('loading');
  const [selectedUserId, setSelectedUserId] = useState<'person_1' | 'person_2' | null>(null);
  const [activeSide, setActiveSide] = useState<'left' | 'right' | 'both' | null>('both');

  // Entities
  const [person1, setPerson1] = useState<UserProfile | null>(null);
  const [person2, setPerson2] = useState<UserProfile | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [timeStatus, setTimeStatus] = useState<TimeStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Modals
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);

  // Initial Load
  useEffect(() => {
    const initApp = async () => {
      try {
        const config = await ApiService.getConfig();
        setPerson1(config.person1);
        setPerson2(config.person2);
        setSettings(config.settings);
        setTimeStatus(config.timeStatus);

        // Check if existing valid user session
        const storedToken = localStorage.getItem('synax_user_token');
        if (storedToken) {
          try {
            const meRes = await ApiService.getMe();
            setCurrentUser(meRes.user);

            if (meRes.user.id === 'person_1') {
              setPerson1(meRes.user);
              if (meRes.otherUser) setPerson2(meRes.otherUser);
            } else {
              setPerson2(meRes.user);
              if (meRes.otherUser) setPerson1(meRes.otherUser);
            }

            setSettings(meRes.settings);
            setTimeStatus(meRes.timeStatus);

            // Connect socket
            socketService.connect(storedToken);

            // Load initial messages
            const msgs = await ApiService.getMessages();
            setMessages(msgs);

            setViewState('chat');
            return;
          } catch (e) {
            // Token expired or invalid
            localStorage.removeItem('synax_user_token');
          }
        }

        // Check if intro has been seen this session
        const introSeen = sessionStorage.getItem('synax_intro_seen');
        if (introSeen === 'true') {
          setViewState('select');
        } else {
          setViewState('intro');
        }
      } catch (err) {
        console.error('Failed to initialize Synax:', err);
        setViewState('select');
      }
    };

    initApp();
  }, []);

  // Global WebSocket event listeners (Time ticks, incoming calls, locks)
  useEffect(() => {
    const unsubTime = socketService.on('time:tick', (data) => {
      if (data.timeStatus) {
        setTimeStatus(data.timeStatus);
      }
    });

    const handleIncomingCall = (data: any) => {
      const callerId =
        data.fromUserId ||
        data.callerId ||
        (currentUser?.id === 'person_1' ? 'person_2' : 'person_1');

      const callerProfile =
        callerId === 'person_1' ? person1 : person2;

      setActiveCall({
        role: 'callee',
        status: 'ringing',
        callType: data.callType || 'voice',
        otherUserId: callerId,
        otherUserName:
          callerProfile?.nickname ||
          callerProfile?.name ||
          'Unknown Caller',
        otherUserPfp: callerProfile?.pfpUrl || '',
        offerSdp: data.sdp,
      });
    };

    const unsubIncomingCall = socketService.on('call:incoming', handleIncomingCall);
    const unsubOfferCall = socketService.on('call:offer', handleIncomingCall);

    const unsubCallEnd = socketService.on('call:end', () => {
      setActiveCall((prev) => (prev ? { ...prev, status: 'ended' } : null));
      setTimeout(() => setActiveCall(null), 1200);
    });

    const unsubCallReject = socketService.on('call:reject', () => {
      setActiveCall((prev) => (prev ? { ...prev, status: 'ended' } : null));
      setTimeout(() => setActiveCall(null), 1200);
    });

    const unsubSettings = socketService.on('settings:updated', (data) => {
      if (data.settings) {
        setSettings(data.settings);
      }
    });

    const unsubLockout = socketService.on('session:lockout', (data) => {
      // User was locked out or emergency lockdown initiated
      if (viewState === 'chat') {
        alert(data.reason || 'Sanctuary session terminated by Administrator');
        handleLogout();
      }
    });

    return () => {
      unsubTime();
      unsubIncomingCall();
      unsubOfferCall();
      unsubCallEnd();
      unsubCallReject();
      unsubSettings();
      unsubLockout();
    };
  }, [currentUser, person1, person2, viewState]);

  // Handlers
  const handleIntroComplete = () => {
    sessionStorage.setItem('synax_intro_seen', 'true');
    setViewState('select');
  };

  const handleSelectUser = (userId: 'person_1' | 'person_2') => {
    SoundEffects.playAtmosphereChime();
    setSelectedUserId(userId);
    setViewState('password');
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!selectedUserId) return;
    const loginRes = await ApiService.login(selectedUserId, password);
    setCurrentUser(loginRes.user);

    // The authenticated response contains the complete other-user profile,
    // including the PFP. Keep the shared profile state in sync so ChatRoom
    // never falls back to the placeholder/logo.
    if (loginRes.user.id === 'person_1') {
      setPerson1(loginRes.user);
      if (loginRes.otherUser) setPerson2(loginRes.otherUser);
    } else {
      setPerson2(loginRes.user);
      if (loginRes.otherUser) setPerson1(loginRes.otherUser);
    }

    setSettings(loginRes.settings);
    setTimeStatus(loginRes.timeStatus);

    // Connect WebSocket
    socketService.connect(loginRes.token);

    // Fetch conversation
    const msgs = await ApiService.getMessages();
    setMessages(msgs);

    SoundEffects.playSent();
    setViewState('chat');
  };

  const handleLogout = async () => {
    await ApiService.logout();
    socketService.disconnect();
    setCurrentUser(null);
    setSelectedUserId(null);
    setViewState('select');
  };

  const handleStartCall = (callType: 'voice' | 'video') => {
    const other = currentUser?.id === 'person_1' ? person2 : person1;
    if (!other) return;

    setActiveCall({
      role: 'caller',
      status: 'calling',
      callType,
      otherUserId: other.id,
      otherUserName: other.name,
      otherUserPfp: other.pfpUrl,
    });
  };

  if (viewState === 'loading' || !person1 || !person2) {
    return (
      <div className="fixed inset-0 bg-[#03050a] flex flex-col items-center justify-center text-slate-100 select-none">
        <CosmicBackground theme={settings?.theme || 'celestial'} />
        <div className="relative z-10 flex flex-col items-center gap-5">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border border-indigo-400/30 flex items-center justify-center bg-slate-950/70 backdrop-blur-xl shadow-[0_0_30px_rgba(99,102,241,0.35)]">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-300" />
            </div>
            <div className="absolute -inset-2.5 rounded-full border border-indigo-400/15 animate-pulse pointer-events-none" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-base font-bold uppercase tracking-anime-wide font-cinzel text-transparent bg-clip-text bg-gradient-to-b from-white via-indigo-100 to-indigo-300 text-shadow-anime-glow">
              SYNAX
            </h2>
            <p className="text-[11px] uppercase tracking-anime-pill font-sans-celestial text-slate-400 font-light text-shadow-subtle">
              Where Two Worlds Meet
            </p>
          </div>
        </div>
      </div>
    );
  }

  const otherUser = currentUser?.id === 'person_1' ? person2 : person1;
  const selectedUser = selectedUserId === 'person_1' ? person1 : person2;

  return (
    <div className="min-h-screen bg-[#03050a] text-slate-100 font-sans-celestial antialiased selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      {/* Dynamic Cosmic Universe Background Canvas */}
      <CosmicBackground
        theme={settings?.theme || 'celestial'}
        activeSide={
          viewState === 'password'
            ? selectedUserId === 'person_1'
              ? 'left'
              : 'right'
            : activeSide
        }
      />

      {/* Main View Router */}
      <AnimatePresence mode="wait">
        {/* VIEW 1: CINEMATIC TWO-PERSON OPENING ANIMATION */}
        {viewState === 'intro' && (
          <CinematicIntro
            key="cinematic-intro"
            person1={{ name: person1.name, logo: person1.logo }}
            person2={{ name: person2.name, logo: person2.logo }}
            worldTitle={settings?.worldTitle || 'SYNAX'}
            worldSubtitle={settings?.worldSubtitle || 'Where Two Worlds Meet.'}
            onComplete={handleIntroComplete}
          />
        )}

        {/* VIEW 2: USER SELECTION SCREEN */}
        {viewState === 'select' && (
          <IdentitySelect
            key="identity-select"
            person1={person1 as any}
            person2={person2 as any}
            worldTitle={settings?.worldTitle || 'SYNAX'}
            worldSubtitle={settings?.worldSubtitle || 'Where Two Worlds Meet.'}
            onSelect={handleSelectUser}
            onOpenAdmin={() => setShowAdminLogin(true)}
            onReplayIntro={() => setViewState('intro')}
            onHoverRealm={setActiveSide}
          />
        )}

        {/* VIEW 3: PASSWORD SCREEN */}
        {viewState === 'password' && selectedUser && (
          <PasswordModal
            key="password-modal"
            userId={selectedUser.id as any}
            name={selectedUser.name}
            username={selectedUser.username}
            logo={selectedUser.logo}
            onSubmit={handlePasswordSubmit}
            onBack={() => {
              setActiveSide('both');
              setViewState('select');
            }}
          />
        )}

        {/* VIEW 4: MAIN SYNAX SANCTUARY CHAT UI */}
        {viewState === 'chat' && currentUser && otherUser && settings && (
          <ChatRoom
            key="chat-room"
            currentUser={currentUser}
            otherUser={otherUser}
            initialMessages={messages}
            settings={settings}
            timeStatus={timeStatus}
            onLogout={handleLogout}
            onOpenProfile={() => setShowProfileModal(true)}
            onStartCall={handleStartCall}
          />
        )}

        {/* VIEW 5: PROTECTED ADMIN PANEL */}
        {viewState === 'admin' && (
          <AdminPanel
            key="admin-panel"
            onExit={() => {
              ApiService.adminLogout();
              setViewState('select');
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: ADMIN MASTER LOGIN */}
      <AdminLoginModal
        isOpen={showAdminLogin}
        onClose={() => setShowAdminLogin(false)}
        onSuccess={() => {
          setShowAdminLogin(false);
          setViewState('admin');
        }}
      />

      {/* MODAL: USER PFP & PROFILE SETTINGS */}
      <AnimatePresence>
        {showProfileModal && currentUser && (
          <UserProfileModal
            user={currentUser}
            onClose={() => setShowProfileModal(false)}
            onProfileUpdated={(updated) => {
              setCurrentUser(updated);
              if (updated.id === 'person_1') setPerson1(updated);
              else setPerson2(updated);
            }}
          />
        )}
      </AnimatePresence>

      {/* MODAL: WEBRTC CALLING INTERFACE */}
      <AnimatePresence>
        {activeCall && (
          <CallModal
            callState={activeCall}
            onClose={() => setActiveCall(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
