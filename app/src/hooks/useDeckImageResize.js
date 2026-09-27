import { useState, useCallback, useEffect } from 'react';
import { useDeckStore } from '../store/useDeckStore';

/**
 * Manages the resizable deck image height and the show-in-cards toggle
 * for deck resource images in the CardList view.
 *
 * @param {object} deckMetadata - Parsed metadata object for the current deck
 * @param {object} currentDeck  - Current deck object (for updateDeckMetadata calls)
 */
export function useDeckImageResize(deckMetadata, currentDeck) {
  const getMetaImageHeight = useCallback(() => {
    return deckMetadata.imageHeight || 220;
  }, [deckMetadata]);

  const [imageHeight, setImageHeight] = useState(getMetaImageHeight);

  // Sync imageHeight when deck changes
  useEffect(() => {
    setImageHeight(getMetaImageHeight());
  }, [getMetaImageHeight]);

  const saveImageHeight = useCallback(async (h) => {
    if (!currentDeck) return;
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...deckMetadata, imageHeight: h });
  }, [currentDeck, deckMetadata]);

  const startResizeDrag = useCallback((e) => {
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = imageHeight;

    const onMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const newH = Math.max(80, Math.min(800, startH + (clientY - startY)));
      setImageHeight(newH);
    };

    const onUp = (ev) => {
      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const finalH = Math.max(80, Math.min(800, startH + (clientY - startY)));
      saveImageHeight(Math.round(finalH));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [imageHeight, saveImageHeight]);

  const handleToggleShowInCards = async (targetImg, isChecked) => {
    if (!currentDeck) return;
    let metadata = { resources: [] };
    if (currentDeck.metadata) {
      metadata = typeof currentDeck.metadata === 'string'
        ? JSON.parse(currentDeck.metadata)
        : currentDeck.metadata;
    }
    const updatedResources = (metadata.resources || []).map(r => {
      if (r === targetImg || (r.type === 'image' && (r.url === targetImg.url || r.path === targetImg.path))) {
        return { ...r, show_in_cards: isChecked };
      }
      return r;
    });
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...metadata, resources: updatedResources });
  };

  return { imageHeight, startResizeDrag, handleToggleShowInCards };
}
