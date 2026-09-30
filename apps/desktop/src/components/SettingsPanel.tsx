import React, { useState } from 'react';

interface SettingsPanelProps {
  onConnect: (url: string, token: string) => void;
}

interface StoredConfig {
  url?: string;
  token?: string;
}

function readStoredConfig(): StoredConfig {
  try {
    return JSON.parse(localStorage.getItem('gateway_config') || '{}') as StoredConfig;
  } catch {
    return {};
  }
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onConnect }) => {
  const stored = readStoredConfig();
  const [url, setUrl] = useState(stored.url ?? 'ws://127.0.0.1:18789');
  const [token, setToken] = useState(stored.token ?? '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('gateway_config', JSON.stringify({ url, token }));
    onConnect(url, token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">⚙️ Ustawienia</h2>

      <label className="block">
        <span className="text-sm text-gray-400">Adres Gateway (WebSocket)</span>
        <input
          className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://127.0.0.1:18789"
        />
      </label>

      <label className="block">
        <span className="text-sm text-gray-400">Token autoryzacyjny</span>
        <input
          type="password"
          className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="OMNI_AUTH_TOKEN"
        />
      </label>

      <button
        onClick={handleSave}
        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
      >
        {saved ? '✅ Zapisano' : 'Zapisz i połącz'}
      </button>
    </div>
  );
};
