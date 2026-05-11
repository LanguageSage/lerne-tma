import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const ImportModal = ({ shareId, onClose, onImportSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [shareInfo, setShareInfo] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  
  const { decks, fetchDecks } = useDeckStore();
  const { showToast } = useUiStore();

  useEffect(() => {
    if (!shareId) return;
    
    const fetchInfo = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/share/info/${shareId}`);
        setShareInfo(res.data);
      } catch (err) {
        console.error("Error fetching share info:", err);
        setError("Не удалось загрузить информацию о материале. Возможно, ссылка недействительна.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchInfo();
  }, [shareId]);

  const handleImport = async () => {
    if (shareInfo?.type === 'card' && !selectedDeckId) {
      setError("Выберите колоду для сохранения карточки.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const payload = { share_id: shareId };
      if (shareInfo?.type === 'card') {
        payload.target_deck_id = selectedDeckId;
      }
      
      const res = await api.post('/share/import', payload);
      if (res.data.status === 'ok') {
        showToast("Успешно добавлено!");
        await fetchDecks(useUiStore.getState().userProfile?.user_id);
        onImportSuccess();
      }
    } catch (err) {
      console.error("Import error:", err);
      setError("Произошла ошибка при добавлении.");
    } finally {
      setImporting(false);
    }
  };

  if (!shareId) return null;

  return (
    <AnimatePresence>
      <motion.div 
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div 
          className="modal-content"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <button className="modal-close" onClick={onClose}>
            <X size={24} />
          </button>
          
          <div className="modal-header">
            <h2>Добавление материалов</h2>
          </div>

          <div className="modal-body" style={{ textAlign: 'center' }}>
            {loading ? (
              <div style={{ padding: '20px' }}>Загрузка информации...</div>
            ) : error && !shareInfo ? (
              <div className="error-message">
                <AlertCircle size={24} />
                <p>{error}</p>
              </div>
            ) : shareInfo && (
              <div className="share-info-container">
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '5px' }}>Вам отправили {shareInfo.type === 'deck' ? 'колоду' : 'карточку'}:</p>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                    {shareInfo.type === 'deck' ? shareInfo.name : shareInfo.front_text}
                  </h3>
                </div>

                <div className="creator-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: 'var(--bg-secondary)', padding: '10px 15px', borderRadius: '20px', marginBottom: '20px' }}>
                  {shareInfo.creator_avatar ? (
                    <img src={shareInfo.creator_avatar} alt="avatar" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                      {shareInfo.creator_name?.charAt(0) || '?'}
                    </div>
                  )}
                  <span>от <strong>{shareInfo.creator_name}</strong></span>
                </div>

                {shareInfo.type === 'card' && (
                  <div className="form-group" style={{ textAlign: 'left' }}>
                    <label>Куда сохранить карточку?</label>
                    <select 
                      className="form-input" 
                      value={selectedDeckId} 
                      onChange={(e) => setSelectedDeckId(e.target.value)}
                    >
                      <option value="">-- Выберите колоду --</option>
                      {decks.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    {error && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '5px' }}>{error}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose} disabled={importing}>Отмена</button>
            <button 
              className="btn btn-primary" 
              onClick={handleImport} 
              disabled={loading || importing || (!shareInfo)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Download size={18} />
              {importing ? 'Сохранение...' : 'Сохранить себе'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
