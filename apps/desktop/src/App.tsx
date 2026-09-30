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
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-xl font-bold text-blue-400">🤖 Omni Agent</h1>
          <div className="mt-2 flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-400">
              {connected ? 'Połączono' : 'Rozłączono'}
            </span>
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
            💬 Czat
          </button>
          <button
            onClick={() => setCurrentView('sessions')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              currentView === 'sessions'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            📋 Sesje
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

        <div className="p-4 border-t border-gray-800">
          <VoiceRecorder onRecordingComplete={handleRecordingComplete} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
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
