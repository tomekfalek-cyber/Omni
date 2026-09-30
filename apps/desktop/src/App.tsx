import React, { useState, useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { VoiceRecorder } from './components/VoiceRecorder';
import { SessionList } from './components/SessionList';
import { SettingsPanel } from './components/SettingsPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { Session } from './types';

type View = 'chat' | 'sessions' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('chat');
  const [sessions, setSessions] = useState<Session[]>([]);
  const { connected, connect, sendMessage } = useWebSocket();

  useEffect(() => {
    // Automatyczne połączenie z Gateway przy starcie
    const savedConfig = localStorage.getItem('gateway_config');
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      connect(config.url, config.token);
    }
  }, [connect]);

  const handleSendMessage = async (message: string) => {
    await sendMessage(message);
  };

  const handleRecordingComplete = async (audioPath: string) => {
    console.log('Nagranie zapisane:', audioPath);
    // W pełnej implementacji: wyślij do Gateway do transkrypcji
  };

  return (
    <div
      className="flex h-screen text-gray-100 bg-cover bg-center"
      style={{ backgroundImage: "url('/background.png')" }}
    >
      {/* Sidebar */}
      <div className="w-64 bg-[#05091A]/85 backdrop-blur border-r border-[#1B2B4D] flex flex-col">
        <div className="p-4 border-b border-[#1B2B4D]">
          <div className="flex items-center space-x-3">
            <img
              src="/logo.png"
              alt="Omni Agent"
              className="w-10 h-10 rounded-full ring-2 ring-[#3D7BFD]/60"
            />
            <div>
              <h1 className="text-lg font-bold text-[#7FD8FF] leading-tight">Omni Agent</h1>
              <div className="mt-1 flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-gray-400">
                  {connected ? 'Połączono' : 'Rozłączono'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setCurrentView('chat')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              currentView === 'chat'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            💬 Rozmowa
          </button>
          <button
            onClick={() => setCurrentView('sessions')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              currentView === 'sessions'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            🗂️ Historia
          </button>
          <button
            onClick={() => setCurrentView('settings')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              currentView === 'settings'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            ⚙️ Ustawienia
          </button>
        </nav>

        <div className="p-4 border-t border-[#1B2B4D]">
          <VoiceRecorder onRecordingComplete={handleRecordingComplete} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col backdrop-blur-[2px]">
        {currentView === 'chat' && (
          <ChatPanel onSendMessage={handleSendMessage} />
        )}
        {currentView === 'sessions' && (
          <SessionList sessions={sessions} />
        )}
        {currentView === 'settings' && (
          <SettingsPanel onConnect={connect} />
        )}
      </div>
    </div>
  );
}

export default App;
