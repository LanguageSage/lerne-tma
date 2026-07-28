import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { 
  RotateCw, RotateCcw, FlipHorizontal, FlipVertical, 
  ZoomIn, ZoomOut, Check, X, RefreshCw, Crop 
} from 'lucide-react';

export const ImageEditorModal = ({
  isOpen,
  onClose,
  imageSrc,
  onSave,
  title = "Редактирование фото"
}) => {
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [aspectRatio, setAspectRatio] = useState('1:1'); // '1:1', '4:3', '16:9', 'free'
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const touchStartDistRef = useRef(null);

  const resetTransforms = useCallback(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Load image whenever imageSrc changes
  useEffect(() => {
    if (!imageSrc) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    if (typeof imageSrc === 'string') {
      img.src = imageSrc;
    } else if (imageSrc instanceof File || imageSrc instanceof Blob) {
      img.src = URL.createObjectURL(imageSrc);
    }

    img.onload = () => {
      imageRef.current = img;
      setImgLoaded(true);
      resetTransforms();
    };

    return () => {
      if (imageSrc instanceof File || imageSrc instanceof Blob) {
        URL.revokeObjectURL(img.src);
      }
    };
  }, [imageSrc, resetTransforms]);

  const handleRotateRight = () => setRotation((r) => (r + 90) % 360);
  const handleRotateLeft = () => setRotation((r) => (r - 90 + 360) % 360);
  const handleFlipH = () => setFlipH((f) => !f);
  const handleFlipV = () => setFlipV((f) => !f);

  const handleZoomChange = (newZoom) => {
    const clamped = Math.min(Math.max(newZoom, 0.5), 4);
    setZoom(clamped);
  };

  // Mouse & Touch Pan controls
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch support for mobile pan & pinch-zoom
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - pan.x,
        y: e.touches[0].clientY - pan.y
      });
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
    }
  };

  const handleTouchMove = (e) => {
    if (isDragging && e.touches.length === 1) {
      setPan({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleDelta = dist / touchStartDistRef.current;
      setZoom((z) => Math.min(Math.max(z * scaleDelta, 0.5), 4));
      touchStartDistRef.current = dist;
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartDistRef.current = null;
  };

  // Draw current preview onto canvas
  useEffect(() => {
    if (!imgLoaded || !imageRef.current || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = containerRef.current;

    const containerWidth = container.clientWidth || 320;
    const containerHeight = container.clientHeight || 320;

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Move origin to center of canvas
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.translate(centerX + pan.x, centerY + pan.y);

    // Apply rotation
    ctx.rotate((rotation * Math.PI) / 180);

    // Apply flips
    const scaleX = flipH ? -1 : 1;
    const scaleY = flipV ? -1 : 1;
    ctx.scale(scaleX, scaleY);

    // Apply zoom
    const img = imageRef.current;
    const isSwapped = rotation === 90 || rotation === 270;
    const effWidth = isSwapped ? img.naturalHeight : img.naturalWidth;
    const effHeight = isSwapped ? img.naturalWidth : img.naturalHeight;

    // Fit image to canvas area
    const fitScale = Math.min(
      (canvas.width * 0.85) / effWidth,
      (canvas.height * 0.85) / effHeight
    );
    const renderWidth = img.naturalWidth * fitScale * zoom;
    const renderHeight = img.naturalHeight * fitScale * zoom;

    ctx.drawImage(
      img,
      -renderWidth / 2,
      -renderHeight / 2,
      renderWidth,
      renderHeight
    );

    ctx.restore();
  }, [rotation, flipH, flipV, zoom, pan, imgLoaded, aspectRatio]);

  // Export edited image to File
  const handleApply = () => {
    if (!imageRef.current) return;

    const img = imageRef.current;

    // Create high-res offscreen canvas
    const offCanvas = document.createElement('canvas');
    const ctx = offCanvas.getContext('2d');

    const isSwapped = rotation === 90 || rotation === 270;
    const targetW = isSwapped ? img.naturalHeight : img.naturalWidth;
    const targetH = isSwapped ? img.naturalWidth : img.naturalHeight;

    // Determine output resolution (max 1200px)
    const maxDim = 1200;
    let outW = targetW;
    let outH = targetH;
    if (outW > maxDim || outH > maxDim) {
      const ratio = Math.min(maxDim / outW, maxDim / outH);
      outW = Math.round(outW * ratio);
      outH = Math.round(outH * ratio);
    }

    // Adjust according to aspect ratio if set
    if (aspectRatio === '1:1') {
      const side = Math.min(outW, outH);
      outW = side;
      outH = side;
    } else if (aspectRatio === '4:3') {
      outH = Math.round(outW * (3 / 4));
    } else if (aspectRatio === '16:9') {
      outH = Math.round(outW * (9 / 16));
    }

    offCanvas.width = outW;
    offCanvas.height = outH;

    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.scale(zoom, zoom);

    // Calculate draw offset considering panning
    const drawW = isSwapped ? outH : outW;
    const drawH = isSwapped ? outW : outH;

    const panFactorX = pan.x / (canvasRef.current?.width || 1);
    const panFactorY = pan.y / (canvasRef.current?.height || 1);

    ctx.drawImage(
      img,
      -drawW / 2 + panFactorX * drawW,
      -drawH / 2 + panFactorY * drawH,
      drawW,
      drawH
    );
    ctx.restore();

    offCanvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `edited_${Date.now()}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now()
        });
        onSave(file);
        onClose();
      },
      'image/jpeg',
      0.9
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="image-picker-overlay"
        onClick={onClose}
        style={{ zIndex: 9999 }}
      >
        <div
          className="image-editor-dialog glass"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="image-picker-header">
            <h3>
              <Crop size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {title}
            </h3>
            <button
              type="button"
              className="image-picker-close"
              onClick={onClose}
              title="Закрыть"
            >
              <X size={18} />
            </button>
          </div>

          {/* Interactive Canvas Workspace */}
          <div
            ref={containerRef}
            className="image-editor-canvas-container"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <canvas ref={canvasRef} className="image-editor-canvas" />

            {/* Crop Overlay Grid */}
            <div className={`crop-overlay-box crop-ratio-${aspectRatio.replace(':', '-')}`}>
              <div className="crop-grid-line h1" />
              <div className="crop-grid-line h2" />
              <div className="crop-grid-line v1" />
              <div className="crop-grid-line v2" />
            </div>

            <div className="canvas-drag-hint">
              <span>Перетаскивайте фото или щипком меняйте масштаб</span>
            </div>
          </div>

          {/* Toolbar 1: Rotation & Flips */}
          <div className="image-editor-toolbar">
            <div className="toolbar-group">
              <button
                type="button"
                className="btn-editor-action"
                onClick={handleRotateLeft}
                title="Повернуть против часовой (-90°)"
              >
                <RotateCcw size={18} />
                <span>-90°</span>
              </button>
              <button
                type="button"
                className="btn-editor-action"
                onClick={handleRotateRight}
                title="Повернуть по часовой (+90°)"
              >
                <RotateCw size={18} />
                <span>+90°</span>
              </button>
              <button
                type="button"
                className={`btn-editor-action ${flipH ? 'active' : ''}`}
                onClick={handleFlipH}
                title="Отразить по горизонтали"
              >
                <FlipHorizontal size={18} />
              </button>
              <button
                type="button"
                className={`btn-editor-action ${flipV ? 'active' : ''}`}
                onClick={handleFlipV}
                title="Отразить по вертикали"
              >
                <FlipVertical size={18} />
              </button>
              <button
                type="button"
                className="btn-editor-action"
                onClick={resetTransforms}
                title="Сбросить все изменения"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>

          {/* Toolbar 2: Zoom & Scale slider */}
          <div className="image-editor-zoom-row">
            <button
              type="button"
              className="btn-zoom"
              onClick={() => handleZoomChange(zoom - 0.2)}
              title="Уменьшить"
            >
              <ZoomOut size={16} />
            </button>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="zoom-slider"
            />
            <button
              type="button"
              className="btn-zoom"
              onClick={() => handleZoomChange(zoom + 0.2)}
              title="Увеличить"
            >
              <ZoomIn size={16} />
            </button>
            <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          </div>

          {/* Toolbar 3: Aspect Ratio selector */}
          <div className="image-editor-ratios">
            <span className="ratio-label">Формат:</span>
            {['1:1', '4:3', '16:9', 'free'].map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`btn-ratio ${aspectRatio === ratio ? 'active' : ''}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio === 'free' ? 'Свободный' : ratio}
              </button>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="image-editor-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary" onClick={handleApply}>
              <Check size={18} /> Применить
            </button>
          </div>
        </div>
      </div>
    </AnimatePresence>
  );
};
