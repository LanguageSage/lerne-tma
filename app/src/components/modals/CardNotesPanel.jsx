import React, { useState } from 'react';
import api from '../../services/api.js';
import { tr } from '../../i18n/locale.js';
import './CardNotes.css';

export function NoteIndicator({ active }) {
  return active ? <span className="card-note-dot" role="img" aria-label={tr('Есть личные заметки')} /> : null;
}

export function CardNotesPanel({ card, notes }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = notes.rows.some(row => row.is_dirty);

  const save = async event => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/card-notes/${card.id}/${editing || crypto.randomUUID()}`, { text });
      setText(''); setEditing(null);
      if (data.sync_error) setError(tr('Не удалось синхронизировать записи. Изменения на устройстве сохранены.'));
    } catch { setError(tr('Не удалось сохранить изменения. Повторите попытку.')); }
    finally { setBusy(false); }
  };
  const remove = async row => {
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/card-notes/${card.id}/${row.id}`, { is_deleted: true });
      if (editing === row.id) { setText(''); setEditing(null); }
      if (data.sync_error) setError(tr('Не удалось синхронизировать записи. Изменения на устройстве сохранены.'));
    } catch { setError(tr('Не удалось сохранить изменения. Повторите попытку.')); }
    finally { setBusy(false); }
  };

  return <section className="card-notes" aria-label={tr('Мои заметки')}>
    <p className="card-notes-hint">{tr('Видны только вам')}</p>
    {(error || notes.error) && <p role="alert">{error || tr('Не удалось загрузить записи. Повторите попытку.')}</p>}
    {pending && <p role="status">{tr('Ожидает синхронизации')}</p>}
    <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await notes.reload(); }
      catch { setError(tr('Не удалось синхронизировать записи. Изменения на устройстве сохранены.')); }
      finally { setBusy(false); }
    }}>{tr('Обновить')}</button>
    {!notes.rows.length && <p>{tr('Записей пока нет')}</p>}
    {notes.rows.map(row => <article key={row.id} className="card-notes-entry">
      <p>{row.text}</p>
      <div className="card-notes-entry-actions">
        <button type="button" className="btn-secondary" disabled={busy}
          onClick={() => { setEditing(row.id); setText(row.text); }}>{tr('Редактировать')}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => remove(row)}>{tr('Удалить')}</button>
      </div>
    </article>)}
    <form onSubmit={save}>
      <label htmlFor="card-note-text">{tr(editing ? 'Редактировать запись' : 'Новая запись')}</label>
      <textarea id="card-note-text" value={text} maxLength={100000} rows={4} required disabled={busy}
        onChange={event => setText(event.target.value)} />
      <div className="card-notes-entry-actions">
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{tr('Сохранить')}</button>
        {editing && <button type="button" className="btn-secondary" disabled={busy}
          onClick={() => { setEditing(null); setText(''); }}>{tr('Отмена')}</button>}
      </div>
    </form>
  </section>;
}
