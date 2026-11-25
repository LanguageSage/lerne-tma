import { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useMediaResolvers } from '../../card-ui/MediaResolverContext.jsx';

export function CardAudioAttachments({
  cardData,
  setCardData,
  disabled,
  onBusyChange,
  uploadAudioFile,
  allowOfflineUpload = false,
  getSessionIdentity,
  resolveAudioUrl,
}) {
  const { resolveAudioUrl: contextResolveAudioUrl } = useMediaResolvers();
  const resolveAudio = resolveAudioUrl || contextResolveAudioUrl;
  const resolveIdentity = getSessionIdentity || (() => 'default');
  const [selection, setSelection] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const generation = useRef(0);
  const latest = useRef(cardData);
  latest.current = cardData;

  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);

  useEffect(() => {
    setSelection(null); setBusy(false); setError(''); setMessage('');
    return () => { generation.current += 1; onBusyChange(false); };
  }, [cardData.id, onBusyChange]);
  useEffect(() => {
    if (!selection) { setPreview(''); return; }
    const url = URL.createObjectURL(selection.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);

  const upload = async () => {
    if (!selection || !uploadAudioFile || busy || disabled || (!allowOfflineUpload && !navigator.onLine)) return;
    const attempt = ++generation.current;
    const identity = resolveIdentity();
    const { side, file } = selection;
    const field = side === 'front' ? 'audio_path' : 'audio_back_path';
    const urlField = side === 'front' ? 'audio_url' : 'audio_back_url';
    const snapshot = latest.current;
    const unchanged = current => current?.id === snapshot.id && current?.revision === snapshot.revision
      && current?.[field] === snapshot[field];
    setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try {
      const uploaded = await uploadAudioFile(file);
      if (attempt !== generation.current || identity !== resolveIdentity()) return;
      if (!unchanged(latest.current)) throw new Error(tr('Карточка или аудио изменились. Выберите файл ещё раз.'));
      setCardData(current => unchanged(current) ? { ...current, [field]: uploaded.path, [urlField]: uploaded.url } : current);
      setSelection(null);
      setMessage(tr('Аудио прикреплено к черновику. Сохраните карточку.'));
    } catch (failure) {
      if (attempt === generation.current && identity === resolveIdentity()) {
        setError(failure.response?.data?.detail || failure.message);
      }
    } finally {
      if (attempt === generation.current) { setBusy(false); onBusyChange(false); }
    }
  };

  return <div className="card-audio-attachments">
    <p>{tr(allowOfflineUpload ? 'Готовое аудио: MP3 или PCM WAV, до 20 МБ. Файл сохраняется локально на устройстве.' : 'Готовое аудио: MP3 или PCM WAV, до 20 МБ. Загрузка доступна при подключении к сети.')}</p>
    {['front', 'back'].map(side => {
      const path = cardData[side === 'front' ? 'audio_path' : 'audio_back_path'];
      const previewUrl = cardData[side === 'front' ? 'audio_url' : 'audio_back_url'] || resolveAudio(path);
      const label = side === 'front' ? tr('Аудио для вопроса') : tr('Аудио для ответа');
      return <fieldset key={side} disabled={disabled || busy}>
        <legend>{label}</legend>
        {path && <audio key={path} controls preload="none" src={previewUrl} aria-label={label}
          onError={() => setError(tr('Не удалось воспроизвести аудио. Проверьте файл и подключение.'))} />}
        <label className="card-audio-file">{path ? tr('Выбрать замену') : tr('Выбрать файл')}
          <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" aria-label={label}
            onChange={event => {
              const file = event.target.files?.[0]; event.target.value = '';
              setError(''); setMessage('');
              if (!file) return;
              if (!file.size || file.size > 20 * 1024 * 1024) {
                setSelection(null); setError(tr('Выберите MP3 или PCM WAV до 20 МБ.')); return;
              }
              setSelection({ side, file });
            }} />
        </label>
        {selection?.side === side && <div className="card-audio-candidate">
          <p>{selection.file.name}</p>
          <audio key={preview} controls preload="metadata" src={preview || undefined} aria-label={tr('Предпрослушивание файла')}
            onError={() => setError(tr('Файл не воспроизводится. Поддерживаются MP3 и PCM WAV.'))} />
          <button type="button" className="btn-secondary" onClick={upload} disabled={!allowOfflineUpload && !online}>
            {busy ? tr('Загрузка аудио…') : tr('Прикрепить аудио')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelection(null)}>{tr('Отмена выбора')}</button>
        </div>}
      </fieldset>;
    })}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
