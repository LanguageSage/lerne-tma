import React from 'react';
import { Users } from 'lucide-react';

export const CollaboratorPresenceBar = ({ collaborators = [], onlineCount = 0, isShared = false }) => {
  if (!isShared || !collaborators || collaborators.length <= 1) {
    return null;
  }

  return (
    <div className="collaborator-presence-bar glass" style={{
      display: 'flex',
      alignItems: 'center',
      justify: 'space-between',
      padding: '8px 14px',
      borderRadius: '14px',
      marginBottom: '14px',
      background: 'rgba(30, 41, 59, 0.6)',
      border: '1px solid rgba(99, 102, 241, 0.25)',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.15)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)' }}>
        <Users size={16} color="#818cf8" />
        <span>Участники группы</span>
        {onlineCount > 0 && (
          <span style={{
            fontSize: '0.72rem',
            background: 'rgba(34, 197, 94, 0.2)',
            color: '#4ade80',
            padding: '2px 7px',
            borderRadius: '10px',
            fontWeight: 700,
            marginLeft: 4
          }}>
            {onlineCount} в сети
          </span>
        )}
      </div>

      <div className="collaborators-avatars-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {collaborators.map((c) => {
          const isOnline = !!c.is_online;
          const name = c.first_name || c.username || `User #${c.user_id}`;
          const initial = name.charAt(0).toUpperCase();

          return (
            <div
              key={c.user_id}
              className={`collaborator-avatar-item ${isOnline ? 'online' : 'offline'}`}
              title={`${name} ${isOnline ? '(В сети — открыто сейчас)' : '(Оффлайн)'}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity: isOnline ? 1 : 0.45,
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
            >
              <div style={{ position: 'relative', width: 28, height: 28 }}>
                {c.photo_url ? (
                  <img
                    src={c.photo_url}
                    alt={name}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: isOnline ? '0 0 10px rgba(34, 197, 94, 0.6)' : 'none'
                    }}
                  />
                ) : (
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: isOnline ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#475569',
                    color: '#ffffff',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.3)',
                    boxShadow: isOnline ? '0 0 10px rgba(34, 197, 94, 0.6)' : 'none'
                  }}>
                    {initial}
                  </div>
                )}

                {/* Online pulse dot for active user */}
                {isOnline && (
                  <span style={{
                    position: 'absolute',
                    bottom: -1,
                    right: -1,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: '#22c55e',
                    border: '1.5px solid #1e293b',
                    boxShadow: '0 0 6px #22c55e'
                  }} />
                )}
              </div>

              <span style={{
                fontSize: '0.78rem',
                fontWeight: isOnline ? 600 : 400,
                color: isOnline ? '#ffffff' : 'rgba(255, 255, 255, 0.5)'
              }}>
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
