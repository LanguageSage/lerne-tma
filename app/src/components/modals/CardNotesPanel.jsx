import React, { useEffect, useState } from 'react';
import api from '../../services/api.js';
import { tr } from '../../i18n/locale.js';
import './CardNotes.css';

const NOTE_STATUS = { new: 'Новое', reviewed: 'Рассмотрено', fixed: 'Исправлено', rejected: 'Отклонено' };

export function NoteIndicator({ active, unread }) {
  return active ? <span className={`card-note-dot${unread ? ' unread' : ''}`}
    role="img" aria-label={tr(unread ? 'Есть непросмотренные записи' : 'Есть заметки и предложения')} /> : null;
}

export function CardNotesPanel({ card, notes }) {
  const [kind, setKind] = useState('note');
  const [drafts, setDrafts] = useState({});
  const { text = '', editing = null } = drafts[kind] || {};
  const setDraft = changes => setDrafts(all => ({ ...all, [kind]: { ...all[kind], ...changes } }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const syncError = tr('Не удалось синхронизировать записи. Изменения на устройстве сохранены.');
  const rows = notes.rows.filter(row => row.kind === kind);
  const pending = notes.rows.some(row => row.is_dirty);

  useEffect(() => {
    // Acknowledge only displayed versions in the selected mode. Switching tabs
    // must not consume unseen replies from the other mode.
    for (const row of notes.rows.filter(row => row.kind === kind && row.revision > row.seen_revision)) {
      api.put(`/card-notes/${card.id}/${row.id}`, { kind: row.kind, seen_revision: row.revision })
        .then(({ data }) => { if (data.sync_error) setError(syncError); })
        .catch(() => setError(tr('Не удалось сохранить изменения. Повторите попытку.')));
    }
  }, [card.id, kind, notes.rows, syncError]);

  const save = async (event) => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/card-notes/${card.id}/${editing || crypto.randomUUID()}`, { kind, text });
      setDraft({ text: '', editing: null });
      if (data.sync_error) setError(syncError);
    } catch { setError(tr('Не удалось сохранить изменения. Повторите попытку.')); }
    finally { setBusy(false); }
  };
  const remove = async row => {
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/card-notes/${card.id}/${row.id}`, { ...row, is_deleted: true });
      if (editing === row.id) setDraft({ text: '', editing: null });
      if (data.sync_error) setError(syncError);
    } catch { setError(tr('Не удалось сохранить изменения. Повторите попытку.')); }
    finally { setBusy(false); }
  };
  return <section className="card-notes" aria-label={tr('Заметки и предложения')}>
    <div className="card-notes-modes" role="group" aria-label={tr('Тип записи')}>
      {['note', 'suggestion'].map(value => <button key={value} type="button" disabled={busy}
        className="btn-secondary" aria-pressed={kind === value}
        onClick={() => setKind(value)}>
        {tr(value === 'note' ? 'Личная заметка' : 'Предложение по улучшению')}
      </button>)}
    </div>
    <p className="card-notes-hint">{tr(kind === 'note' ? 'Видна только вам' : 'Видно вам и администраторам, обрабатывающим замечания')}</p>
    {(error || notes.error) && <p role="alert">{error || tr('Не удалось загрузить записи. Повторите попытку.')}</p>}
    {pending && <p role="status">{tr('Ожидает синхронизации')}</p>}
    <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await notes.reload(); }
      catch { setError(syncError); }
      finally { setBusy(false); }
    }}>{tr('Обновить')}</button>
    {notes.loading ? <p role="status">{tr('Загрузка...')}</p> : !rows.length && <p>{tr('Записей пока нет')}</p>}
    {rows.map(row => <article key={row.id} className="card-notes-entry">
      <p>{row.text}</p>
      {row.kind === 'suggestion' && <small>{tr(NOTE_STATUS[row.status] || NOTE_STATUS.new)}</small>}
      {row.reply && <div className="card-notes-reply"><strong>{tr('Ответ администратора')}</strong><p>{row.reply}</p></div>}
      {row.kind === 'note' && <div className="card-notes-entry-actions">
        <button type="button" className="btn-secondary" disabled={busy}
          onClick={() => setDraft({ editing: row.id, text: row.text })}>{tr('Редактировать')}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => remove(row)}>{tr('Удалить')}</button>
      </div>}
    </article>)}
    <form onSubmit={save}>
      <label htmlFor="card-note-text">{tr(editing ? 'Редактировать запись' : 'Новая запись')}</label>
      <textarea id="card-note-text" value={text} maxLength={10000} rows={4} required disabled={busy}
        onChange={event => setDraft({ text: event.target.value })} />
      <div className="card-notes-entry-actions">
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{tr('Сохранить')}</button>
        {editing && <button type="button" className="btn-secondary" disabled={busy}
          onClick={() => setDraft({ editing: null, text: '' })}>{tr('Отмена')}</button>}
      </div>
    </form>
  </section>;
}
