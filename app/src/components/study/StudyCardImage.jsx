import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tr } from '../../i18n/locale';
import { RefreshCw, ImageOff } from 'lucide-react';

/**
 * Resilient Image component for study cards.
 * - Resolves race conditions and cold-start failures with auto-retry.
 * - Hides native broken image icons completely.
 * - Shows an elegant loading skeleton while the image is loading.
 * - Provides a manual retry button if all automatic retries fail.
 * - Preserves user resizing functionality.
 */
export const StudyCardImage = React.memo(({
  src,
  height = 220,
  cardId,
  onResizeStart,
  showResizeHandle = true,
}) => {
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [retryCount, setRetryCount] = useState(0);
  const [retryTimestamp, setRetryTimestamp] = useState(null);
  const [prevSrc, setPrevSrc] = useState(src);
  const [prevCardId, setPrevCardId] = useState(cardId);
  const retryTimerRef = useRef(null);

  // Derive state reset during render when props change (avoids useEffect cascading setState)
  if (prevSrc !== src || prevCardId !== cardId) {
    setPrevSrc(src);
    setPrevCardId(cardId);
    setLoadStatus('loading');
    setRetryCount(0);
    setRetryTimestamp(null);
  }

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const handleLoad = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setLoadStatus('loaded');
  }, []);

  const handleError = useCallback(() => {
    if (retryCount < 2) {
      const nextCount = retryCount + 1;
      const delay = nextCount === 1 ? 800 : 1800;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      setLoadStatus('loading');
      setRetryCount(nextCount);
      retryTimerRef.current = setTimeout(() => {
        setRetryTimestamp(Date.now());
      }, delay);
    } else {
      setLoadStatus('error');
    }
  }, [retryCount]);

  const handleManualRetry = useCallback((e) => {
    e.stopPropagation();
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    setLoadStatus('loading');
    setRetryCount(0);
    setRetryTimestamp(Date.now());
  }, []);

  if (!src) return null;

  const effectiveSrc = retryTimestamp
    ? `${src}${src.includes('?') ? '&' : '?'}_retry=${retryCount}&_t=${retryTimestamp}`
    : src;

  return (
    <>
      <div 
        style={{
          width: '100%',
          height: `${height}px`,
          overflow: 'hidden',
          borderRadius: '12px',
          marginBottom: showResizeHandle ? '4px' : '0',
          flexShrink: 0,
          position: 'relative',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Loading skeleton placeholder */}
        {loadStatus === 'loading' && (
          <div 
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-pulse 1.8s ease-in-out infinite',
              zIndex: 1,
            }}
          >
            <RefreshCw size={22} className="spin" style={{ color: 'rgba(168, 85, 247, 0.7)', opacity: 0.8 }} />
            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', userSelect: 'none' }}>
              {tr("Загрузка изображения...")}
            </span>
          </div>
        )}

        {/* Error placeholder with manual retry */}
        {loadStatus === 'error' && (
          <div 
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '12px',
              textAlign: 'center',
              background: 'rgba(239, 68, 68, 0.08)',
              zIndex: 2,
            }}
          >
            <ImageOff size={28} style={{ color: 'rgba(239, 68, 68, 0.7)' }} />
            <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.8)', maxWidth: '240px' }}>
              {tr("Не удалось загрузить изображение")}
            </span>
            <button
              type="button"
              onClick={handleManualRetry}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#fff',
                background: 'rgba(168, 85, 247, 0.6)',
                border: '1px solid rgba(168, 85, 247, 0.8)',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <RefreshCw size={12} />
              <span>{tr("Повторить")}</span>
            </button>
          </div>
        )}

        {/* The actual image — hidden when not loaded to prevent native broken icons */}
        <img
          key={effectiveSrc}
          src={effectiveSrc}
          alt=""
          onLoad={handleLoad}
          onError={handleError}
          style={{
            display: loadStatus === 'loaded' ? 'block' : 'none',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            borderRadius: '12px',
            transition: 'opacity 0.25s ease-in',
            opacity: loadStatus === 'loaded' ? 1 : 0,
          }}
        />
      </div>

      {/* Resize handle (front card only) */}
      {showResizeHandle && onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          title={tr("Потяни чтобы изменить высоту")}
          style={{
            height: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'ns-resize',
            marginBottom: '10px',
            userSelect: 'none',
            touchAction: 'none',
            flexShrink: 0
          }}
        >
          <div 
            style={{
              width: '40px',
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(168, 85, 247, 0.45)',
              transition: 'background 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.9)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.45)'}
          />
        </div>
      )}
    </>
  );
});

StudyCardImage.displayName = 'StudyCardImage';
