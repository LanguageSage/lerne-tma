import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload, ShieldCheck, AlertTriangle, CheckCircle2, Smartphone } from 'lucide-react';
import { tr } from '../i18n/locale';
import { useInterfaceLocale } from '../i18n/useInterfaceLocale';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { STANDALONE_APPLICATION_ID } from '../utils/standaloneMode.js';
import { STANDALONE_PACK_ID, STANDALONE_PACK_VERSION } from './standalonePack.js';
import {
  exportProgressBackup,
  recordBackupExportMeta,
  inspectProgressBackup,
  applyProgressBackup,
  getStandaloneBackupStatus,
} from './progressBackup.js';
import {
  isNativeBackupPickerAvailable,
  saveBackupFile,
  openBackupFileFromNative,
} from './progressBackupTransport.js';

function formatTimestamp(isoString, locale) {
  if (!isoString) return tr('Ещё не выполнялось');
  const parsed = Date.parse(isoString);
  if (!Number.isFinite(parsed)) return isoString;
  return new Date(parsed).toLocaleString(locale || undefined);
}

export const StandaloneBackupSection = () => {
  const locale = useInterfaceLocale();
  const showToast = useUiStore(state => state.showToast);
  const fileInputRef = useRef(null);

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingRestore, setPendingRestore] = useState(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getStandaloneBackupStatus();
      setStatus(next);
    } catch (error) {
      console.warn('[StandaloneBackup] Status load failed:', error);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const { json, fileName, backup, summary } = await exportProgressBackup({ recordMeta: false });
      const saveResult = await saveBackupFile({ fileName, content: json });
      if (saveResult?.cancelled) {
        setStatusMessage(tr('Сохранение файла отменено.'));
        return;
      }
      await recordBackupExportMeta({ exportedAt: backup.exported_at, summary });
      await refreshStatus();
      const targetName = saveResult?.fileName || fileName;
      const msg = tr('Резервная копия сохранена: {{p0}} (карточек с прогрессом: {{p1}}).', {
        p0: targetName,
        p1: summary.total_records,
      });
      setStatusMessage(msg);
      showToast(tr('Резервная копия прогресса сохранена'), 'success');
    } catch (error) {
      const msg = error?.message || tr('Не удалось сохранить резервную копию.');
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inspectRawFileText = async (rawText, fileName = '') => {
    setErrorMessage('');
    setStatusMessage('');
    setPendingRestore(null);
    const inspection = await inspectProgressBackup(rawText);
    if (!inspection.ok) {
      setErrorMessage(inspection.error || tr('Файл резервной копии не прошёл проверку.'));
      return;
    }
    setPendingRestore({
      ...inspection,
      fileName: fileName || tr('выбранный файл'),
    });
  };

  const handlePickRestoreFile = async () => {
    if (busy) return;
    setErrorMessage('');
    setStatusMessage('');
    if (isNativeBackupPickerAvailable()) {
      setBusy(true);
      try {
        const picked = await openBackupFileFromNative();
        if (!picked || picked.cancelled) {
          setStatusMessage(tr('Выбор файла отменён.'));
          return;
        }
        await inspectRawFileText(picked.content || '', picked.fileName || '');
      } catch (error) {
        setErrorMessage(error?.message || tr('Не удалось прочитать выбранный файл.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleWebFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      await inspectRawFileText(text, file.name);
    } catch (error) {
      setErrorMessage(error?.message || tr('Не удалось прочитать выбранный файл.'));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore?.backup || busy) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await applyProgressBackup(pendingRestore.backup);
      useSessionStore.getState().resetSession();
      useDeckStore.getState().resetDeckStore();
      await useDeckStore.getState().fetchDecks(true);
      await refreshStatus();
      setPendingRestore(null);
      const msg = tr('Прогресс восстановлен (записей: {{p0}}, изученных: {{p1}}).', {
        p0: result.restoredRecords,
        p1: result.restoredReviewed,
      });
      setStatusMessage(msg);
      showToast(tr('Личный прогресс успешно восстановлен'), 'success');
    } catch (error) {
      const msg = error?.message || tr('Не удалось восстановить прогресс из резервной копии.');
      setErrorMessage(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="standalone-pilot-panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div
        className="link-telegram-section glass"
        style={{
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(56, 189, 248, 0.32)',
          background: 'rgba(15, 23, 42, 0.88)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.96rem' }}>
            <Smartphone size={18} color="#38bdf8" aria-hidden="true" />
            <span>{tr('Автономный офлайн-пилот')}</span>
          </h4>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '3px 9px',
              borderRadius: '999px',
              background: 'rgba(16, 185, 129, 0.16)',
              color: '#6ee7b7',
              fontWeight: 600,
            }}
          >
            {STANDALONE_APPLICATION_ID}
          </span>
        </div>

        <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.45 }}>
          {tr('Приложение работает полностью без сервера, авторизации и фоновой синхронизации. Весь прогресс SRS хранится локально на устройстве.')}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '8px',
            fontSize: '0.78rem',
            color: '#94a3b8',
            background: 'rgba(15, 23, 42, 0.35)',
            padding: '10px 12px',
            borderRadius: '12px',
          }}
        >
          <div>
            <div>{tr('Набор колод')}</div>
            <strong style={{ color: '#f8fafc', overflowWrap: 'anywhere' }}>{STANDALONE_PACK_ID} (v{STANDALONE_PACK_VERSION})</strong>
          </div>
          <div>
            <div>{tr('Колод / карточек')}</div>
            <strong style={{ color: '#f8fafc' }}>{status ? `${status.deckCount} / ${status.cardCount}` : '—'}</strong>
          </div>
          <div>
            <div>{tr('Изучено карточек')}</div>
            <strong style={{ color: '#f8fafc' }}>{status ? `${status.reviewedCount} (${status.progressCount} в SRS)` : '—'}</strong>
          </div>
          <div>
            <div>{tr('Последний экспорт')}</div>
            <strong style={{ color: '#f8fafc', overflowWrap: 'anywhere' }}>{formatTimestamp(status?.lastBackupAt, locale)}</strong>
          </div>
        </div>
      </div>

      <div
        className="link-telegram-section glass"
        style={{
          padding: '16px',
          borderRadius: '16px',
          border: '1px solid rgba(16, 185, 129, 0.32)',
          background: 'rgba(15, 23, 42, 0.88)',
        }}
      >
        <h4 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.96rem' }}>
          <ShieldCheck size={18} color="#34d399" aria-hidden="true" />
          <span>{tr('Резервная копия и восстановление прогресса')}</span>
        </h4>
        <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.45 }}>
          {tr('Экспортируйте файл прогресса в память устройства или Google Диск через системный выбор файлов Android. При восстановлении проверяются формат, целостность и ID карточек.')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            disabled={busy}
            onClick={handleExport}
            data-testid="standalone-export-progress-btn"
          >
            <Download size={17} aria-hidden="true" />
            <span>{tr('Экспортировать прогресс (JSON)')}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            disabled={busy}
            onClick={handlePickRestoreFile}
            data-testid="standalone-restore-progress-btn"
          >
            <Upload size={17} aria-hidden="true" />
            <span>{tr('Восстановить из файла')}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleWebFileSelected}
            data-testid="standalone-restore-file-input"
          />
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="standalone-backup-error"
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
            <span>{errorMessage}</span>
          </div>
        )}

        {statusMessage && !errorMessage && (
          <div
            role="status"
            data-testid="standalone-backup-status"
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
            <span>{statusMessage}</span>
          </div>
        )}

        {pendingRestore && (
          <div
            data-testid="standalone-restore-confirm-card"
            style={{
              marginTop: '12px',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              background: 'rgba(245, 158, 11, 0.1)',
              fontSize: '0.82rem',
              color: '#fef3c7',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <strong style={{ fontSize: '0.88rem' }}>{tr('Подтвердите восстановление прогресса')}</strong>
            <div>
              {tr('Файл: {{p0}}', { p0: pendingRestore.fileName })}
            </div>
            <div>
              {tr('Дата резервной копии: {{p0}}', { p0: formatTimestamp(pendingRestore.preview.exportedAt, locale) })}
            </div>
            <div>
              {tr('В файле: {{p0}} записей ({{p1}} изучено).', {
                p0: pendingRestore.preview.backupProgressCount,
                p1: pendingRestore.preview.backupReviewedCount,
              })}
            </div>
            {pendingRestore.preview.willOverwriteLocalProgress && (
              <div style={{ color: '#fcd34d', fontWeight: 600 }}>
                {tr('Внимание: на этом устройстве уже есть локальный прогресс ({{p0}} записей). Подтверждение перезапишет его данными из файла.', {
                  p0: pendingRestore.preview.currentProgressCount,
                })}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: '1 1 160px', minHeight: '44px' }}
                disabled={busy}
                onClick={handleConfirmRestore}
                data-testid="standalone-restore-confirm-btn"
              >
                {tr('Подтвердить восстановление')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: '1 1 120px', minHeight: '44px' }}
                disabled={busy}
                onClick={() => setPendingRestore(null)}
                data-testid="standalone-restore-cancel-btn"
              >
                {tr('Отмена')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
