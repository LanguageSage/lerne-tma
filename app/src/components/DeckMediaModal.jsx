import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, Volume2, Video, Link2, Trash2, Plus, Globe } from 'lucide-react';
import { useDeckStore } from '../store/useDeckStore';
import { useUiStore } from '../store/useUiStore';
import { useMediaUpload } from '../hooks/useMediaUpload';

export const DeckMediaModal = ({ isOpen, onClose }) => {
  const { currentDeck, updateDeckMetadata } = useDeckStore();
  const { showToast, loading } = useUiStore();
  const { uploadDeckResource } = useMediaUpload();

  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);

  if (!isOpen || !currentDeck) return null;

  // Parse current metadata
  let metadata = { resources: [] };
  if (currentDeck.metadata) {
    metadata = typeof currentDeck.metadata === 'string'
      ? JSON.parse(currentDeck.metadata)
      : currentDeck.metadata;
  }
  const resources = metadata.resources || [];

  const handleFileUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await uploadDeckResource(file, type, currentDeck.id);
      // Reset input
      e.target.value = '';
    } catch (err) {
      showToast('Ошибка при загрузке файла');
    }
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim()) {
      showToast('Введите ссылку URL');
      return;
    }

    try {
      const newResource = {
        type: 'link',
        url: linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`,
        title: linkTitle.trim() || 'Ссылка'
      };

      const updatedResources = [...resources, newResource];
      const newMetadata = { ...metadata, resources: updatedResources };

      await updateDeckMetadata(currentDeck.id, newMetadata);
      showToast('Ссылка добавлена в ресурсы', 'success');
      
      setLinkUrl('');
      setLinkTitle('');
      setShowLinkForm(false);
    } catch (err) {
      showToast('Не удалось добавить ссылку');
    }
  };

  const handleDeleteResource = async (indexToDelete) => {
    if (!window.confirm('Удалить этот ресурс из колоды?')) return;

    try {
      const updatedResources = resources.filter((_, idx) => idx !== indexToDelete);
      const newMetadata = { ...metadata, resources: updatedResources };

      await updateDeckMetadata(currentDeck.id, newMetadata);
      showToast('Ресурс удален', 'success');
    } catch (err) {
      showToast('Не удалось удалить ресурс');
    }
  };

  const getResourceIcon = (type) => {
    switch (type) {
      case 'image': return <ImageIcon size={18} color="#c084fc" />;
      case 'audio': return <Volume2 size={18} color="#38bdf8" />;
      case 'video': return <Video size={18} color="#fb7185" />;
      case 'link': return <Link2 size={18} color="#34d399" />;
      default: return <Globe size={18} />;
    }
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="settings-modal"
          onClick={e => e.stopPropagation()}
          style={{ maxWidth: '440px', width: '90%' }}
        >
          <div className="settings-header">
            <h2>Ресурсы колоды</h2>
            <button className="close-btn" onClick={onClose} disabled={loading}>
              <X size={24} />
            </button>
          </div>

          <div className="settings-content" style={{ maxHeight: '75vh', overflowY: 'auto', padding: '16px' }}>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 16px 0', textAlign: 'center' }}>
              Прикрепленные медиафайлы и ссылки будут доступны всем карточкам в этой колоде.
            </p>

            {/* Resources List */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '10px', color: '#f1f5f9' }}>
                Текущие ресурсы ({resources.length})
              </h3>

              {resources.length === 0 ? (
                <div style={{
                  padding: '24px 16px',
                  borderRadius: '12px',
                  border: '1px dashed rgba(255, 255, 255, 0.1)',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.9rem'
                }}>
                  Нет прикрепленных ресурсов
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {resources.map((res, idx) => (
                    <div
                      key={idx}
                      className="glass"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        background: 'rgba(255, 255, 255, 0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        {getResourceIcon(res.type)}
                        <span style={{
                          fontSize: '0.85rem',
                          color: '#e2e8f0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 500
                        }} title={res.title || res.url || res.path}>
                          {res.title || (res.type === 'link' ? res.url : res.path?.split('/').pop())}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteResource(idx)}
                        disabled={loading}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#f43f5e',
                          padding: '4px',
                          cursor: 'pointer',
                          marginLeft: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          opacity: 0.8
                        }}
                        onMouseOver={e => e.currentTarget.style.opacity = '1'}
                        onMouseOut={e => e.currentTarget.style.opacity = '0.8'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Resource Buttons */}
            {!showLinkForm && (
              <div style={{ marginBottom: '15px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '10px', color: '#f1f5f9' }}>
                  Добавить ресурс
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px'
                }}>
                  {/* Image input trigger */}
                  <label className="btn" style={{
                    background: 'rgba(192, 132, 252, 0.1)',
                    border: '1px solid rgba(192, 132, 252, 0.3)',
                    color: '#e9d5ff',
                    fontSize: '0.8rem',
                    padding: '10px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}>
                    <ImageIcon size={16} />
                    <span>Картинка</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => handleFileUpload(e, 'image')}
                      disabled={loading}
                    />
                  </label>

                  {/* Audio input trigger */}
                  <label className="btn" style={{
                    background: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#e0f2fe',
                    fontSize: '0.8rem',
                    padding: '10px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}>
                    <Volume2 size={16} />
                    <span>Аудио</span>
                    <input
                      type="file"
                      accept="audio/*"
                      style={{ display: 'none' }}
                      onChange={e => handleFileUpload(e, 'audio')}
                      disabled={loading}
                    />
                  </label>

                  {/* Video input trigger */}
                  <label className="btn" style={{
                    background: 'rgba(251, 113, 133, 0.1)',
                    border: '1px solid rgba(251, 113, 133, 0.3)',
                    color: '#ffe4e6',
                    fontSize: '0.8rem',
                    padding: '10px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}>
                    <Video size={16} />
                    <span>Видео</span>
                    <input
                      type="file"
                      accept="video/*"
                      style={{ display: 'none' }}
                      onChange={e => handleFileUpload(e, 'video')}
                      disabled={loading}
                    />
                  </label>

                  {/* Link Form toggle */}
                  <button
                    className="btn"
                    onClick={() => setShowLinkForm(true)}
                    disabled={loading}
                    style={{
                      background: 'rgba(52, 211, 153, 0.1)',
                      border: '1px solid rgba(52, 211, 153, 0.3)',
                      color: '#d1fae5',
                      fontSize: '0.8rem',
                      padding: '10px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <Link2 size={16} />
                    <span>Ссылка</span>
                  </button>
                </div>
              </div>
            )}

            {/* Add Link Form */}
            {showLinkForm && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass"
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(0, 0, 0, 0.15)',
                  marginBottom: '15px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#10b981' }}>Прикрепить ссылку</h4>
                  <button
                    onClick={() => setShowLinkForm(false)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <input
                    placeholder="URL (например: google.com)"
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    style={{ fontSize: '0.85rem', padding: '8px' }}
                    disabled={loading}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <input
                    placeholder="Название ссылки (необязательно)"
                    value={linkTitle}
                    onChange={e => setLinkTitle(e.target.value)}
                    style={{ fontSize: '0.85rem', padding: '8px' }}
                    disabled={loading}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary btn-tiny"
                    onClick={handleAddLink}
                    disabled={loading}
                    style={{ flex: 1, height: '32px', fontSize: '0.8rem', padding: 0 }}
                  >
                    Добавить
                  </button>
                  <button
                    className="btn-secondary btn-tiny"
                    onClick={() => setShowLinkForm(false)}
                    disabled={loading}
                    style={{ flex: 1, height: '32px', fontSize: '0.8rem', padding: 0 }}
                  >
                    Отмена
                  </button>
                </div>
              </motion.div>
            )}

            {/* Footer */}
            <div className="modal-footer-actions" style={{ marginTop: '20px' }}>
              <button className="btn btn-primary btn-full" onClick={onClose} disabled={loading}>
                Готово
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
