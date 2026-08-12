import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Upload, Camera, Search, X } from 'lucide-react';
import { ImageEditorModal } from './ImageEditorModal';

export const MediaPicker = ({ 
  isOpen, 
  onClose, 
  onImageUpload, 
  searchQuery = '', 
  loading = false
}) => {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [editingFile, setEditingFile] = useState(null);
  
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  
  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
  };

  const closeCamera = () => {
    stopCamera();
    setIsCameraOpen(false);
    setCameraError('');
  };

  const openCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
      cameraStreamRef.current = stream;
      setIsCameraOpen(true);
    } catch (err) {
      console.error('Camera open failed:', err);
      setCameraError('Камера недоступна.');
      cameraInputRef.current?.click();
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      closeCamera();
      setEditingFile(file);
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (isCameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [isCameraOpen]);
  
  // Clean up camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const googleImageUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=isch`;

  const handleSelectFile = (file) => {
    if (!file) return;
    setEditingFile(file);
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && !isCameraOpen && !editingFile && (
          <motion.div
            className="image-picker-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              className="image-picker-dialog"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="image-picker-header">
                <h3>Выбор изображения</h3>
                <button
                  type="button"
                  className="image-picker-close"
                  onClick={onClose}
                  title="Закрыть"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="image-picker-actions">
                <button
                  type="button"
                  className="image-picker-tile"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={loading}
                >
                  <Upload size={24} color="#c084fc" />
                  <span>Галерея</span>
                </button>
                <button
                  type="button"
                  className="image-picker-tile"
                  onClick={openCamera}
                  disabled={loading}
                >
                  <Camera size={24} color="#38bdf8" />
                  <span>Камера</span>
                </button>
                <a
                  href={googleImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="image-picker-tile image-picker-tile-wide"
                  onClick={() => {
                    sessionStorage.setItem('lerne_open_picker_after_google', String(Date.now()));
                    onClose();
                  }}
                >
                  <Search size={22} color="#34d399" />
                  <span>Поиск в Google</span>
                </a>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={e => {
                  if (e.target.files?.[0]) handleSelectFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden-file-input"
                onChange={e => {
                  if (e.target.files?.[0]) handleSelectFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCameraOpen && (
          <div className="camera-overlay" onClick={closeCamera}>
            <div className="camera-capture-dialog" onClick={e => e.stopPropagation()}>
              <div className="image-picker-header">
                <h3>Фото</h3>
                <button
                  type="button"
                  className="image-picker-close"
                  onClick={closeCamera}
                  title="Закрыть"
                >
                  <X size={18} />
                </button>
              </div>
              {cameraError ? (
                <p className="camera-error">{cameraError}</p>
              ) : (
                <video
                  ref={videoRef}
                  className="camera-preview"
                  autoPlay
                  playsInline
                  muted
                />
              )}
              <canvas ref={canvasRef} className="hidden-file-input" />
              <div className="camera-actions">
                <button type="button" className="btn-secondary" onClick={closeCamera}>
                  Отмена
                </button>
                <button type="button" className="btn btn-primary" onClick={capturePhoto} disabled={loading || !!cameraError}>
                  <Camera size={18} /> Снять
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <ImageEditorModal
        isOpen={!!editingFile}
        onClose={() => setEditingFile(null)}
        imageSrc={editingFile}
        onSave={(editedFile) => {
          setEditingFile(null);
          onImageUpload(editedFile);
          onClose();
        }}
        title="Настройка фото"
      />
    </>
  );
};
