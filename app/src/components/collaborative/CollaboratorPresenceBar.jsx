import React, { useState } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const CollaboratorPresenceBar = ({ collaborators = [], onlineCount = 0, isShared = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isShared || !collaborators || collaborators.length <= 1) {
    return null;
  }

  return (
    <div
      className="collaborator-presence-bar glass"
      onClick={() => setIsExpanded(!isExpanded)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 14px',
        borderRadius: '16px',
        marginBottom: '14px',
        background: 'rgba(30, 41, 59, 0.7)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        userSelect: 'none'
      }}
    >
      {/* Top Header Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justify: 'space-between',
        width: '100%',
        gap: 10
      }}>
        {/* Left Title & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.9)', flexShrink: 0 }}>
          <Users size={16} color="#818cf8" />
          <span>Участники ({collaborators.length})</span>
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

        {/* Right Avatars List / Toggle Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, justifyContent: 'flex-end' }}>
          {!isExpanded && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {collaborators.map((c) => {
                const isOnline = !!c.is_online;
                const name = c.first_name || c.username || `User #${c.user_id}`;
                const initial = name.charAt(0).toUpperCase();

                return (
                  <div
                    key={c.user_id}
                    title={`${name} ${isOnline ? '(В сети)' : '(Оффлайн)'}`}
                    style={{
                      position: 'relative',
                      width: 28,
                      height: 28,
                      flexShrink: 0
                    }}
                  >
                    {c.photo_url ? (
                      <img
                        src={c.photo_url}
                        alt={name}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.25)',
                          boxShadow: isOnline ? '0 0 8px rgba(34, 197, 94, 0.6)' : 'none'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: isOnline ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : '#475569',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.25)',
                        boxShadow: isOnline ? '0 0 8px rgba(34, 197, 94, 0.6)' : 'none'
                      }}>
                        {initial}
                      </div>
                    )}

                    {isOnline && (
                      <span style={{
                        position: 'absolute',
                        bottom: -1,
                        right: -1,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#22c55e',
                        border: '1.5px solid #1e293b'
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ color: 'rgba(255, 255, 255, 0.5)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>
      </div>

      {/* Expanded Participant Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              {collaborators.map((c) => {
                const isOnline = !!c.is_online;
                const name = c.first_name || c.username || `User #${c.user_id}`;
                const initial = name.charAt(0).toUpperCase();

                return (
                  <div
                    key={c.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      gap: 8
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
                        {c.photo_url ? (
                          <img
                            src={c.photo_url}
                            alt={name}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              objectFit: 'cover',
                              border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.2)'
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
                            border: isOnline ? '2px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.2)'
                          }}>
                            {initial}
                          </div>
                        )}

                        {isOnline && (
                          <span style={{
                            position: 'absolute',
                            bottom: -1,
                            right: -1,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: '#22c55e',
                            border: '1px solid #1e293b'
                          }} />
                        )}
                      </div>

                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{
                          fontSize: '0.84rem',
                          fontWeight: isOnline ? 600 : 400,
                          color: isOnline ? '#ffffff' : 'rgba(255, 255, 255, 0.7)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {name}
                        </span>
                        {c.username && (
                          <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.4)' }}>
                            @{c.username}
                          </span>
                        )}
                      </div>
                    </div>

                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '8px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      background: isOnline ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      color: isOnline ? '#4ade80' : 'rgba(255, 255, 255, 0.5)'
                    }}>
                      {isOnline ? 'в сети' : 'оффлайн'}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
