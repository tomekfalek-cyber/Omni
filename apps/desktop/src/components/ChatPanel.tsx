import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, WsMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface ChatPanelProps {
  onSendMessage: (message: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onSendMessage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Nasłuchiwanie wiadomości WebSocket
    const handleWsMessage = (event: CustomEvent<WsMessage>) => {
      const msg = event.detail;

      if (msg.type === 'chat.token') {
        setIsStreaming(true);
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'agent' && lastMsg.isStreaming) {
            // Aktualizuj istniejącą wiadomość
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, content: lastMsg.content + (msg.token || '') }
            ];
          } else {
            // Nowa wiadomość agenta
            return [
              ...prev,
              {
                id: uuidv4(),
                role: 'agent',
                content: msg.token || '',
                timestamp: Date.now(),
                isStreaming: true
              }
            ];
          }
        });
      } else if (msg.type === 'chat.done') {
        setIsStreaming(false);
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'agent') {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, content: msg.fullText || '', isStreaming: false }
            ];
          }
          return prev;
        });
      }
    };

    window.addEventListener('ws_message', handleWsMessage as EventListener);
    return () => {
      window.removeEventListener('ws_message', handleWsMessage as EventListener);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-100'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.isStreaming && (
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Napisz wiadomość..."
            disabled={isStreaming}
            className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="bg-blue-600 text-white rounded-lg px-6 py-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Wyślij
          </button>
        </div>
      </form>
    </div>
  );
};
