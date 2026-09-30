import React from 'react';
import { Session } from '../types';

interface SessionListProps {
  sessions: Session[];
}

export const SessionList: React.FC<SessionListProps> = ({ sessions }) => {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-4">📋 Sesje</h2>
      {sessions.length === 0 ? (
        <p className="text-gray-500">Brak zapisanych sesji.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800">
              <div className="font-medium">{s.title}</div>
              <div className="text-sm text-gray-400 truncate">{s.lastMessage}</div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(s.updatedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
