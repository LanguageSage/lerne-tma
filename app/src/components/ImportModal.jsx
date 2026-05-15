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
    if (!shareId) return;
    const fetchInfo = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/share/info/${shareId}`);
        setShareInfo(res.data);
      } catch (err) {
        setError("Не удалось загрузить информацию. Возможно, ссылка недействительна.");
      } finally {
        setLoading(false);
      }
    };
    fetchInfo();
  }, [shareId]);

  const handleImport = async (resolution = null) => {
    setImporting(true);
    setError(null);
    try {
      const res = await api.post('/share/import', { share_id: shareId, resolution });
      
      if (res.data.status === 'conflict') {
        setConflict(res.data);
        return;
      }

      if (res.data.status === 'ok') {
        const msg = res.data.type === 'deck'
          ? (res.data.merged ? `✅ Колода объединена!` : `✅ ${res.data.cards_added} карточек добавлено!`)
          : '✅ Карточка добавлена во Входящие!';
        showToast(msg);
        await fetchDecks(useUiStore.getState().userProfile?.user_id);
        onImportSuccess();
      } else if (res.data.status === 'skipped' || res.data.status === 'cancelled') {
        onClose();
      }
    } catch (err) {
      setError("Произошла ошибка при добавлении.");
    } finally {
      setImporting(false);
    }
  };

  if (!shareId) return null;

  const isCard = shareInfo?.type === 'card';

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal-content"
          style={{ maxWidth: 380 }}
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={e => e.stopPropagation()}
        >
          <button className="modal-close" onClick={onClose}><X size={24} /></button>

          <div className="modal-body" style={{ textAlign: 'center', padding: '30px 20px' }}>
            {loading ? (
              <div style={{ padding: '20px', color: '#94a3b8' }}>Загрузка...</div>
            ) : error && !shareInfo ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#fca5a5' }}>
                <AlertCircle size={40} />
                <p>{error}</p>
              </div>
            ) : shareInfo && (
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
                      от <strong style={{ color: 'white' }}>{shareInfo.creator_name}</strong>
                    </span>
                  </div>
                )}

                {/* Title */}
                <div>
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 6 }}>
                    Вам отправили {isCard ? 'карточку' : 'колоду'}:
                  </p>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', margin: 0 }}>
                    {isCard ? shareInfo.front_text : shareInfo.name}
                  </h3>
                  {!isCard && shareInfo.level && (
                    <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 4 }}>
                      {shareInfo.level} · {shareInfo.topic}
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
                        ? `Такая карточка уже есть в колоде «${conflict.existing_deck_name}». Что сделать?`
                        : `Колода с названием «${conflict.name}» уже существует. Что сделать?`
                      }
                    </p>
                  </div>
                ) : (
                  /* Inbox info */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(99,102,241,0.08)', padding: '12px 16px',
                    borderRadius: 14, border: '1px solid rgba(99,102,241,0.2)',
                    width: '100%', boxSizing: 'border-box'
                  }}>
                    <Inbox size={18} color="#818cf8" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', textAlign: 'left' }}>
                      {isCard
                        ? 'Карточка попадёт в колоду «📥 Входящие»'
                        : 'Все карточки колоды попадут в «📥 Входящие»'}
                      <br />
                      <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Потом можно переместить в любую колоду</span>
                    </span>
                  </div>
                )}

                {error && <p style={{ color: '#fca5a5', fontSize: '0.85rem' }}>{error}</p>}
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ flexDirection: conflict ? 'column' : 'row', gap: conflict ? 10 : 0 }}>
            {conflict ? (
              <>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%' }} 
                  onClick={() => handleImport(isCard ? 'skip' : 'cancel')}
                  disabled={importing}
                >
                  {isCard ? 'Пропустить (не добавлять)' : 'Отмена'}
                </button>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%' }} 
                  onClick={() => handleImport(isCard ? 'replace' : 'replace')}
                  disabled={importing}
                >
                  {isCard ? 'Заменить (удалить старую)' : 'Заменить всё'}
                </button>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)' }} 
                  onClick={() => handleImport(isCard ? 'add' : 'merge')}
                  disabled={importing}
                >
                  {isCard ? 'Оставить обе (добавить копию)' : 'Объединить (добавить только новые)'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={onClose} disabled={importing}>Отмена</button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleImport()}
                  disabled={loading || importing || !shareInfo}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <Download size={18} />
                  {importing ? 'Сохранение...' : 'Добавить во Входящие'}
                </button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
