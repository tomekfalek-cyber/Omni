import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { WsMessage, GatewayConfig } from '../types';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<GatewayConfig>({ url: '', token: '' });

  useEffect(() => {
    // Nasłuchiwanie zdarzeń WebSocket z Tauri backend
    const unlisten = listen<WsMessage>('ws_message', (event) => {
      const msg = event.payload;
      
      if (msg.type === 'auth.ok') {
        setConnected(true);
      } else if (msg.type === 'auth.fail') {
        setConnected(false);
        console.error('Auth failed:', msg.error);
      }
      
      // Emituj dalej do komponentów
      window.dispatchEvent(new CustomEvent('ws_message', { detail: msg }));
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const connect = useCallback(async (url: string, token: string) => {
    try {
      await invoke('connect_to_gateway', { url, token });
      setConfig({ url, token });
    } catch (error) {
      console.error('Connection error:', error);
    }
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    try {
      await invoke('send_chat_message', { message });
    } catch (error) {
      console.error('Send message error:', error);
    }
  }, []);

  return { connected, config, connect, sendMessage };
}
