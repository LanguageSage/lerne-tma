import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Package, Upload, Download, FolderOpen, Layers, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { tr } from '../i18n/locale';
import { useInterfaceLocale } from '../i18n/useInterfaceLocale';
import { useDeckStore } from '../store/useDeckStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { getExportableMaterialsTree } from './materialArchive.js';
import {
  cancelPendingArchiveImport,
  confirmArchiveImport,
  exportSelectedMaterialsZip,
  inspectArchiveWebFile,
  isNativeMaterialArchiveAvailable,
  pickArchiveForImportNative,
} from './materialArchiveTransport.js';

const SUPPORTED_TARGET_LANGS = new Set(['de', 'en', 'no']);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export const StandaloneMaterialsSection = ({ onMaterialsChanged = null }) => {
  useInterfaceLocale();
  const showToast = useUiStore(state => state.showToast);
  const fileInputRef = useRef(null);

  const [tree, setTree] = useState(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState(() => new Set());
  const [selectedDeckIds, setSelectedDeckIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const pendingImportRef = useRef(null);

  useEffect(() => {
    pendingImportRef.current = pendingImport;
  }, [pendingImport]);

  const refreshTree = useCallback(async () => {
    try {
      const nextTree = await getExportableMaterialsTree();
      setTree(nextTree);
      setSelectedFolderIds(prev => new Set([...prev].filter(id => nextTree.rootFolders.some(f => f.id === id))));
      setSelectedDeckIds(prev => new Set([...prev].filter(id => nextTree.unfiledDecks.some(d => d.id === id))));
    } catch (error) {
      console.warn('[StandaloneMaterials] Failed to load export tree:', error);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => () => {
    if (pendingImportRef.current) {
      void cancelPendingArchiveImport(pendingImportRef.current);
      pendingImportRef.current = null;
    }
  }, []);

  const handlePickArchive = async () => {
    if (busy) return;
    setErrorMessage('');
    setStatusMessage('');

    if (isNativeMaterialArchiveAvailable()) {
      setBusy(true);
      try {
        if (pendingImport) {
          const prev = pendingImport;
          pendingImportRef.current = null;
          setPendingImport(null);
          await cancelPendingArchiveImport(prev);
        }
        const res = await pickArchiveForImportNative();
        if (!res || res.cancelled) {
          setStatusMessage(tr('Выбор архива отменён.'));
          return;
        }
        if (!res.ok) {
          setErrorMessage(res.error || tr('Архив материалов не прошёл проверку.'));
          return;
        }
        pendingImportRef.current = res;
        setPendingImport(res);
      } catch (error) {
        setErrorMessage(error?.message || tr('Не удалось открыть выбранный ZIP-архив.'));
      } finally {
        setBusy(false);
      }
      return;
    }

    fileInputRef.current?.click();
  };

  const handleWebArchiveSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;

    setBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    if (pendingImport) {
      const prev = pendingImport;
      pendingImportRef.current = null;
      setPendingImport(null);
      await cancelPendingArchiveImport(prev);
    }

    try {
      const inspected = await inspectArchiveWebFile(file);
      if (!inspected.ok) {
        setErrorMessage(inspected.error || tr('Архив материалов не прошёл проверку.'));
        return;
      }
      pendingImportRef.current = inspected;
      setPendingImport(inspected);
    } catch (error) {
      setErrorMessage(error?.message || tr('Не удалось прочитать выбранный ZIP-архив.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelImport = async () => {
    if (!pendingImport || busy) return;
    const toCancel = pendingImport;
    pendingImportRef.current = null;
    setPendingImport(null);
    await cancelPendingArchiveImport(toCancel);
    setStatusMessage(tr('Импорт отменён. Существующие материалы не изменены.'));
  };

  const handleConfirmImport = async () => {
    if (!pendingImport || busy) return;
    setBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const result = await confirmArchiveImport(pendingImport);
      pendingImportRef.current = null;
      setPendingImport(null);

      const importedLangs = Array.isArray(result.languages) ? result.languages : [];
      if (importedLangs.length === 1 && SUPPORTED_TARGET_LANGS.has(importedLangs[0])) {
        const currentLang = useLanguageStore.getState().activeLanguage;
        if (currentLang !== importedLangs[0]) {
          await useLanguageStore.getState().setLanguage(importedLangs[0], true);
        }
      }

      useSessionStore.getState().resetSession();
      useDeckStore.getState().resetDeckStore();
      await useDeckStore.getState().fetchDecks(true);
      await refreshTree();
      onMaterialsChanged?.();

      const totalDecks = result.importedDecks + result.updatedDecks;
      const totalCards = result.importedCards + result.updatedCards;
      const msg = tr('Материалы импортированы: колод — {{p0}}, карточек — {{p1}}, медиа — {{p2}}.', {
        p0: totalDecks,
        p1: totalCards,
        p2: result.mediaCount,
      });
      setStatusMessage(msg);
      showToast(tr('Учебные материалы импортированы'), 'success');
    } catch (error) {
      const msg = error?.message || tr('Не удалось импортировать архив материалов.');
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFolder = (folderId) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleDeck = (deckId) => {
    setSelectedDeckIds((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!tree) return;
    setSelectedFolderIds(new Set(tree.rootFolders.map(f => f.id)));
    setSelectedDeckIds(new Set(tree.unfiledDecks.map(d => d.id)));
  };

  const handleClearSelection = () => {
    setSelectedFolderIds(new Set());
    setSelectedDeckIds(new Set());
  };

  const selectionSummary = useMemo(() => {
    if (!tree) return { folderCount: 0, deckCount: 0, cardCount: 0 };
    let deckCount = 0;
    let cardCount = 0;
    for (const folder of tree.rootFolders) {
      if (selectedFolderIds.has(folder.id)) {
        deckCount += folder.deckCount;
        cardCount += folder.cardCount;
      }
    }
    for (const deck of tree.unfiledDecks) {
      if (selectedDeckIds.has(deck.id)) {
        deckCount += 1;
        cardCount += deck.cardCount;
      }
    }
    return {
      folderCount: selectedFolderIds.size,
      deckCount,
      cardCount,
    };
  }, [tree, selectedFolderIds, selectedDeckIds]);

  const hasSelection = selectedFolderIds.size > 0 || selectedDeckIds.size > 0;

  const handleExportZip = async () => {
    if (busy || !hasSelection) return;
    setBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const res = await exportSelectedMaterialsZip({
        folderIds: [...selectedFolderIds],
        deckIds: [...selectedDeckIds],
      });
      if (res?.cancelled) {
        setStatusMessage(tr('Сохранение архива материалов отменено.'));
        return;
      }
      const counts = res?.summary?.counts || {};
      const msg = tr('Архив сохранён: {{p0}} (колод: {{p1}}, карточек: {{p2}}, медиа: {{p3}}).', {
        p0: res.fileName || 'lerne-materials.zip',
        p1: counts.deck ?? selectionSummary.deckCount,
        p2: counts.card ?? selectionSummary.cardCount,
        p3: res?.summary?.mediaCount ?? 0,
      });
      setStatusMessage(msg);
      showToast(tr('Архив материалов сохранён'), 'success');
    } catch (error) {
      const msg = error?.message || tr('Не удалось экспортировать архив материалов.');
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const preview = pendingImport?.inspection?.preview || null;
  const rootFolders = tree?.rootFolders || [];
  const unfiledDecks = tree?.unfiledDecks || [];

  return (
    <div className="standalone-materials-panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
      <div
        className="link-telegram-section glass"
        style={{
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          background: 'rgba(15, 23, 42, 0.88)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.96rem' }}>
            <Package size={18} color="#818cf8" aria-hidden="true" />
            <span>{tr('Учебные материалы (ZIP)')}</span>
          </h4>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '3px 9px',
              borderRadius: '999px',
              background: 'rgba(99, 102, 241, 0.16)',
              color: '#c7d2fe',
              fontWeight: 600,
            }}
          >
            lerne-materials v3/v4
          </span>
        </div>

        <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.45 }}>
          {tr('Импортируйте ZIP-архив из Lerne Admin с папками, карточками V2, изображениями и аудио, либо экспортируйте выбранные материалы обратно в архив.')}
        </p>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          disabled={busy}
          onClick={handlePickArchive}
          data-testid="standalone-import-materials-btn"
        >
          <Upload size={17} aria-hidden="true" />
          <span>{tr('Импортировать материалы (ZIP)')}</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          style={{ display: 'none' }}
          onChange={handleWebArchiveSelected}
          data-testid="standalone-import-materials-input"
        />

        {preview && (
          <div
            data-testid="standalone-import-confirm-card"
            style={{
              marginTop: '12px',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              background: 'rgba(56, 189, 248, 0.08)',
              fontSize: '0.82rem',
              color: '#e0f2fe',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <strong style={{ fontSize: '0.88rem' }}>{tr('Подтвердите импорт архива')}</strong>
            {preview.fileName && (
              <div style={{ overflowWrap: 'anywhere' }}>
                {tr('Файл: {{p0}} (формат v{{p1}})', { p0: preview.fileName, p1: preview.archiveVersion })}
              </div>
            )}
            <div>
              {tr('Папок: {{p0}}, колод: {{p1}}, карточек: {{p2}}, медиа: {{p3}} ({{p4}}).', {
                p0: preview.totalFolders,
                p1: preview.totalDecks,
                p2: preview.totalCards,
                p3: preview.mediaCount,
                p4: formatBytes(preview.mediaBytes),
              })}
            </div>
            {preview.languages.length > 0 && (
              <div>
                {tr('Языки: {{p0}}', { p0: preview.languages.join(', ').toUpperCase() })}
              </div>
            )}
            {preview.isReimport && (
              <div style={{ color: '#fde68a', fontWeight: 600 }}>
                {tr('Повторный импорт: материалы будут обновлены без дубликатов, а сохранённый прогресс SRS ({{p0}} записей) останется нетронутым.', {
                  p0: preview.preservedProgressCount,
                })}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: '1 1 160px', minHeight: '44px' }}
                disabled={busy}
                onClick={handleConfirmImport}
                data-testid="standalone-import-confirm-btn"
              >
                {tr('Импортировать')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: '1 1 120px', minHeight: '44px' }}
                disabled={busy}
                onClick={handleCancelImport}
                data-testid="standalone-import-cancel-btn"
              >
                {tr('Отмена')}
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(148, 163, 184, 0.16)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>{tr('Выборочный экспорт в ZIP')}</strong>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: '40px', padding: '6px 10px', fontSize: '0.78rem' }}
                disabled={busy || (rootFolders.length === 0 && unfiledDecks.length === 0)}
                onClick={handleSelectAll}
                data-testid="standalone-export-select-all-btn"
              >
                {tr('Выбрать все')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: '40px', padding: '6px 10px', fontSize: '0.78rem' }}
                disabled={busy || !hasSelection}
                onClick={handleClearSelection}
                data-testid="standalone-export-clear-btn"
              >
                {tr('Снять выбор')}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '220px',
              overflowY: 'auto',
              paddingRight: '2px',
            }}
          >
            {rootFolders.map(folder => (
              <label
                key={`export-folder-${folder.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  minHeight: '44px',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  background: selectedFolderIds.has(folder.id) ? 'rgba(99, 102, 241, 0.14)' : 'rgba(15, 23, 42, 0.4)',
                  border: `1px solid ${selectedFolderIds.has(folder.id) ? 'rgba(129, 140, 248, 0.45)' : 'rgba(148, 163, 184, 0.16)'}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedFolderIds.has(folder.id)}
                  onChange={() => toggleFolder(folder.id)}
                  data-testid={`standalone-export-folder-${folder.id}`}
                  style={{ width: '18px', height: '18px', flexShrink: 0 }}
                />
                <FolderOpen size={16} color={folder.color || '#ffd043'} style={{ flexShrink: 0 }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#f8fafc', overflowWrap: 'anywhere' }}>
                    {folder.name}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    {tr('Колод: {{p0}}, карточек: {{p1}}, медиа: {{p2}}', {
                      p0: folder.deckCount,
                      p1: folder.cardCount,
                      p2: folder.mediaCount,
                    })}
                  </div>
                </div>
              </label>
            ))}

            {unfiledDecks.map(deck => (
              <label
                key={`export-deck-${deck.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  minHeight: '44px',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  background: selectedDeckIds.has(deck.id) ? 'rgba(99, 102, 241, 0.14)' : 'rgba(15, 23, 42, 0.4)',
                  border: `1px solid ${selectedDeckIds.has(deck.id) ? 'rgba(129, 140, 248, 0.45)' : 'rgba(148, 163, 184, 0.16)'}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedDeckIds.has(deck.id)}
                  onChange={() => toggleDeck(deck.id)}
                  data-testid={`standalone-export-deck-${deck.id}`}
                  style={{ width: '18px', height: '18px', flexShrink: 0 }}
                />
                <Layers size={16} color="#818cf8" style={{ flexShrink: 0 }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#f8fafc', overflowWrap: 'anywhere' }}>
                    {deck.name}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    {tr('Карточек: {{p0}}, медиа: {{p1}}', {
                      p0: deck.cardCount,
                      p1: deck.mediaCount,
                    })}
                  </div>
                </div>
              </label>
            ))}

            {rootFolders.length === 0 && unfiledDecks.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', padding: '6px 0' }}>
                {tr('Нет доступных колод или папок для экспорта.')}
              </div>
            )}
          </div>

          <div style={{ marginTop: '10px', fontSize: '0.78rem', color: '#94a3b8' }}>
            {hasSelection
              ? tr('Выбрано папок: {{p0}}, колод: {{p1}}, карточек: {{p2}}.', {
                p0: selectionSummary.folderCount,
                p1: selectionSummary.deckCount,
                p2: selectionSummary.cardCount,
              })
              : tr('Отметьте папки или колоды для экспорта в архив.')}
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', minHeight: '44px', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            disabled={busy || !hasSelection}
            onClick={handleExportZip}
            data-testid="standalone-export-materials-btn"
          >
            <Download size={17} aria-hidden="true" />
            <span>{tr('Экспортировать выбранное (ZIP)')}</span>
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="standalone-materials-error"
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              borderRadius: '12px',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#fecaca',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
            <span style={{ overflowWrap: 'anywhere' }}>{errorMessage}</span>
          </div>
        )}

        {statusMessage && !errorMessage && (
          <div
            role="status"
            data-testid="standalone-materials-status"
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              borderRadius: '12px',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#a7f3d0',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
            <span style={{ overflowWrap: 'anywhere' }}>{statusMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
