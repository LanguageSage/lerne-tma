import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, AlertCircle, Inbox, BookOpen } from 'lucide-react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const ImportModal = ({ shareId, onClose, onImportSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [shareInfo, setShareInfo] = useState(null);
  const [conflict, setConflict] = useState(null);
  
  const { fetchDecks } = useDeckStore();
  const { showToast } = useUiStore();

  useEffect(() => {
    console.log("ImportModal mounted with shareId:", shareId);
    if (!shareId) return;
    const fetchInfo = async () => {
      setLoading(true);
      setError(null);
      try {
        console.log("Fetching share info for:", shareId);
        const res = await api.get(`/share/info/${shareId}`);
        console.log("Share info response:", res.data);
        setShareInfo(res.data);
      } catch (err) {
        console.error("Error fetching share info:", err);
        setError("Не удалось загрузить информацию. Возможно, ссылка недействительна.");
      } finally {
        setLoading(false);
      }
    };
    fetchInfo();
  }, [shareId]);

  const handleImport = async (resolution = null) => {
    console.log("handleImport called with resolution:", resolution);
    setImporting(true);
    setError(null);
    try {
      const res = await api.post('/share/import', { share_id: shareId, resolution });
      console.log("Import response:", res.data);
      
      if (res.data.status === 'conflict') {
        console.log("Import conflict detected:", res.data);
        setConflict(res.data);
        return;
      }

      if (res.data.status === 'ok') {
        const msg = res.data.type === 'deck'
          ? (res.data.merged ? `Колода успешно объединена!` : `Колода добавлена! Карточек: ${res.data.cards_added}`)
          : 'Карточка успешно добавлена во Входящие!';
        showToast(msg, 'success');
        await fetchDecks(useUiStore.getState().userProfile?.user_id);
        onImportSuccess();
      } else if (res.data.status === 'skipped' || res.data.status === 'cancelled') {
        onClose();
      }
    } catch (err) {
      console.error("Error during import:", err);
      setError("Произошла ошибка при импорте.");
    } finally {
      setImporting(false);
    }
  };

  if (!shareId) return null;

  const isCard = shareInfo?.type === 'card';

  return (
    <AnimatePresence>
      <motion.div
        className="settings-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="settings-modal"
          style={{ maxWidth: 380 }}
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>
              {conflict ? 'Разрешение конфликта' : (isCard ? 'Добавить карточку' : 'Добавить колоду')}
            </h2>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            {loading ? (
              <div style={{ padding: '20px', color: '#94a3b8' }}>Загрузка...</div>
            ) : error ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fca5a5' }}>
                <AlertCircle size={40} />
                <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.4 }}>{error}</p>
              </div>
            ) : !shareInfo ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fca5a5' }}>
                <AlertCircle size={40} />
                <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.4 }}>Не удалось получить информацию по вашей ссылке</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                {/* Icon */}
                <div style={{
                  width: 64, height: 64, borderRadius: 18,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.25))',
                  border: '1px solid rgba(168,85,247,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <BookOpen size={28} color="#c084fc" />
                </div>

                {/* Sender badge */}
                {shareInfo.creator_name && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                    background: 'rgba(255,255,255,0.05)', padding: '8px 14px',
                    borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)'
                  }}>
                    {shareInfo.creator_avatar
                      ? <img src={shareInfo.creator_avatar} alt="avatar" style={{ width: 26, height: 26, borderRadius: '50%' }} />
                      : <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>
                          {shareInfo.creator_name.charAt(0)}
                        </div>
                    }
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                      От: <strong style={{ color: 'white' }}>{shareInfo.creator_name}</strong>
                    </span>
                  </div>
                )}

                {/* Title */}
                <div>
                  <p style={{ color: '#818cf8', fontSize: '1.05rem', fontWeight: 600, marginBottom: 6 }}>
                    Вам отправили {isCard ? 'карточку' : 'колоду'}:
                  </p>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', margin: 0 }}>
                    {isCard ? shareInfo.front_text : shareInfo.name}
                  </h3>
                  {!isCard && shareInfo.level && (
                    <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 4 }}>
                      {shareInfo.level} • {shareInfo.topic}
                    </p>
                  )}
                </div>

                {conflict ? (
                  <div style={{
                    background: 'rgba(234,179,8,0.1)', padding: '16px',
                    borderRadius: 14, border: '1px solid rgba(234,179,8,0.2)',
                    width: '100%', boxSizing: 'border-box', textAlign: 'left'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#facc15', marginBottom: 8 }}>
                      <AlertCircle size={20} />
                      <strong style={{ fontSize: '0.9rem' }}>Обнаружен дубликат</strong>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: 0 }}>
                      {isCard 
                        ? `Карточка уже существует в колоде <${conflict.existing_deck_name}>. Что сделать?`
                        : `Колода с названием <${conflict.name}> уже существует. Что сделать?`
                      }
                    </p>
                  </div>
                ) : (
                  /* Inbox info */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    background: 'rgba(99,102,241,0.08)', padding: '16px 20px',
                    borderRadius: 16, border: '1px solid rgba(99,102,241,0.2)',
                    width: '100%', boxSizing: 'border-box'
                  }}>
                    <Inbox size={24} color="#818cf8" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '1.05rem', color: '#e2e8f0', textAlign: 'left', lineHeight: 1.4 }}>
                      {isCard
                        ? 'Карточка попадет во «📥 Входящие»'
                        : 'Колода попадет во «📥 Входящие»'}
                      <br />
                      <span style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: 4, display: 'inline-block' }}>
                        Потом можно переместить в любую папку
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ width: '100%', marginTop: 20 }}>
            {error || !shareInfo ? (
              <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={onClose}
                  style={{ width: '100%', padding: '12px' }}
                >
                  Закрыть
                </button>
              </div>
            ) : conflict ? (
              <div className="choice-grid" style={{ width: '100%' }}>
                {isCard ? (
                  <>
                    <button 
                      className="btn btn-secondary choice-btn" 
                      onClick={() => handleImport('replace')}
                      disabled={importing}
                      style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', width: '100%', padding: '14px 18px' }}
                    >
                      🔄 Заменить (удалить старую)
                    </button>
                    <button 
                      className="btn btn-secondary choice-btn" 
                      onClick={() => handleImport('add')}
                      disabled={importing}
                      style={{ width: '100%', padding: '14px 18px' }}
                    >
                      ➕ Оставить обе (добавить копию)
                    </button>
                    <button 
                      className="btn btn-primary choice-btn" 
                      onClick={() => handleImport('skip')}
                      disabled={importing}
                      style={{ width: '100%', padding: '14px 18px' }}
                    >
                      ❌ Пропустить (не добавлять)
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      className="btn btn-secondary choice-btn" 
                      onClick={() => handleImport('replace')}
                      disabled={importing}
                      style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', width: '100%', padding: '14px 18px' }}
                    >
                      🔄 Заменить (удалить старые карточки)
                    </button>
                    <button 
                      className="btn btn-secondary choice-btn" 
                      onClick={() => handleImport('merge')}
                      disabled={importing}
                      style={{ width: '100%', padding: '14px 18px' }}
                    >
                      🔀 Объединить (добавить только новые)
                    </button>
                    <button 
                      className="btn btn-secondary choice-btn" 
                      onClick={() => handleImport('copy')}
                      disabled={importing}
                      style={{ width: '100%', padding: '14px 18px' }}
                    >
                      📂 Создать новую колоду-копию
                    </button>
                    <button 
                      className="btn btn-primary choice-btn" 
                      onClick={() => handleImport('cancel')}
                      disabled={importing}
                      style={{ width: '100%', padding: '14px 18px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', borderColor: 'rgba(255, 255, 255, 0.1)' }}
                    >
                      ❌ Отмена
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', width: '100%' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={onClose} 
                  disabled={importing}
                  style={{ flex: 1, padding: '12px' }}
                >
                  Отмена
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleImport()}
                  disabled={loading || importing || !shareInfo}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1, padding: '12px' }}
                >
                  <Download size={18} />
                  {importing ? 'Сохранение...' : 'Добавить'}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
