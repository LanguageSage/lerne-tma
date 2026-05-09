import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings, X } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { CardForm } from './common/CardForm';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useAudio } from '../hooks/useAudio';
import { useMediaUpload } from '../hooks/useMediaUpload';

export const CardEditor = ({ startTutorial }) => {
  const { view, setView, setIsSettingsOpen, editorSourceView } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { editingCard, setEditingCard } = useSessionStore();
  const { runAiGenerator, saveCard, generateAudioInternal } = useCardActions();
  const { uploadCardVideo } = useMediaUpload();
  const { playAudio } = useAudio();

  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

  if (view !== 'editor') return null;

  const handleAiGenerate = async () => {
    if (!editingCard?.front) return;
    const result = await runAiGenerator(editingCard.front, true);
    if (result) {
      const updated = {
        ...editingCard,
        front: result.front || editingCard.front,
        back: result.back || editingCard.back,
        context: result.context || editingCard.context
      };
      setEditingCard(updated);
      setTimeout(() => {
        generateAudioInternal(updated, setEditingCard);
      }, 500);
    }
  };

  const handleSave = () => {
    saveCard(null, 'editor');
  };

  return (
    <div className="view-editor">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
          <h2>Правка карточки</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title="Добавить карточку">
              <Plus size={22} />
            </button>
            <HelpButton onClick={() => startTutorial('editor')} />
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={22} />
            </button>
          </div>
        </div>

        <CardForm
          cardData={editingCard}
          setCardData={setEditingCard}
          onSave={handleSave}
          onAiGenerate={handleAiGenerate}
          onGenerateAudio={generateAudioInternal}
          playAudio={playAudio}
          isCreator={false}
        />

        <div className="creator-form glass" style={{ marginTop: '10px' }}>
          <div className="media-edit-group" style={{ display: 'flex', gap: '10px' }}>
             <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '5px' }}>Видео (Лицо)</label>
                {editingCard?.video_front_url && (
                  <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                    <video src={editingCard.video_front_url} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '4px', color: 'white' }} onClick={() => setEditingCard({...editingCard, video_front_path: '', video_front_url: ''})}><X size={10} /></button>
                  </div>
                )}
                <button className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
                  {editingCard?.video_front_url ? 'Заменить' : '+ Видео'}
                </button>
                <input ref={videoFrontRef} type="file" accept="video/mp4" className="hidden-file-input" style={{ display: 'none' }} onChange={e => uploadCardVideo(e.target.files?.[0], editingCard, 'front', true)} />
             </div>
             <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '5px' }}>Видео (Оборот)</label>
                {editingCard?.video_back_url && (
                  <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                    <video src={editingCard.video_back_url} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '4px', color: 'white' }} onClick={() => setEditingCard({...editingCard, video_back_path: '', video_back_url: ''})}><X size={10} /></button>
                  </div>
                )}
                <button className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
                  {editingCard?.video_back_url ? 'Заменить' : '+ Видео'}
                </button>
                <input ref={videoBackRef} type="file" accept="video/mp4" className="hidden-file-input" style={{ display: 'none' }} onChange={e => uploadCardVideo(e.target.files?.[0], editingCard, 'back', true)} />
             </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
