import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useDeckStore } from '../../store/useDeckStore';
import { useUiStore } from '../../store/useUiStore';
import { parseCardTextUpdate } from '../../utils/cardTextUpdateParser';
import { previewCardTextUpdate, applyCardTextUpdate, readPendingTextUpdate } from '../../services/cardTextUpdate';
import './DeckTextUpdateModal.css';

const issueMessages = {
  duplicate_metadata: 'Служебный маркер указан несколько раз.',
  invalid_identifier: 'Некорректный ID. Используйте ID из экспорта.',
  duplicate_card_id: 'Один ID карточки повторяется в файле.',
  duplicate_section: 'Секция FRONT, BACK или CONTEXT повторяется.',
  invalid_sections: 'Нет непустого FRONT или повреждены границы секций.',
  unclosed_syntax: 'Незакрытый или лишний маркер упражнения.',
  invalid_exercise: 'Упражнение не распознаётся текущим парсером.',
  wrong_deck: 'Файл относится к другой колоде.',
  foreign_card_id: 'ID карточки не принадлежит выбранной колоде.',
  empty_file: 'В файле нет карточек.',
  missing_deck_id: 'Для обновления папки у каждой карточки нужен deck_id из экспорта.',
  missing_deck: 'Колода с указанным ID не найдена.',
  deck_outside_folder: 'Колода не входит в выбранную папку или её вложенные папки.',
  readonly_deck: 'Нет права редактировать эту колоду.',
  too_many_cards: 'В файле больше 5000 карточек. Разделите файл на части.'
};
const fieldLabels = { front: 'Лицевая сторона', back: 'Обратная сторона', context: 'Заметка', level: 'Уровень', topics: 'Тема' };

function requestError(error, folder = false) {
  const detail = error.response?.data?.detail;
  if (detail?.code === 'preview_changed') return tr(folder ? 'Затронутые колоды папки изменились после предпросмотра. Обновите предпросмотр перед применением.' : 'Колода изменилась после предпросмотра. Обновите предпросмотр перед применением.');
  if (detail?.code === 'request_changed') return tr('Запрос уже использован с другими данными. Загрузите файл заново.');
  if (detail?.code === 'invalid_update') return tr('Сервер отклонил карточки. Обновите предпросмотр и исправьте ошибки.');
  if (error.response?.status === 403) return tr(folder ? 'Нет права редактировать папку или одну из её колод.' : 'Нет права редактировать эту колоду.');
  if (Array.isArray(detail)) return tr('Сервер отклонил формат карточек. Исправьте файл и загрузите заново.');
  return typeof detail === 'string' ? detail : error.message || tr('Не удалось обновить колоду.');
}

export function DeckTextUpdateModal() {
  useInterfaceLocale();
  const reducedMotion = useReducedMotion();
  const deck = useUiStore(state => state.textUpdateDeck);
  const folder = useUiStore(state => state.textUpdateFolder);
  const isFolder = Boolean(folder);
  const target = folder || deck;
  const close = () => useUiStore.getState().setTextUpdateDeck(null);
  const [rawText, setRawText] = useState('');
  const [filename, setFilename] = useState('');
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [includeNew, setIncludeNew] = useState(false);
  const busy = useUiStore(state => state.textUpdateBusy);
  const setBusy = useUiStore(state => state.setTextUpdateBusy);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const running = useRef(false);
  const closeRef = useRef(null);

  useEffect(() => {
    let active = true;
    readPendingTextUpdate(target.id, { folder: isFolder }).then(attempt => {
      if (active && attempt) {
        setPending(attempt);
        setFilename(attempt.filename);
        setRawText(attempt.rawText);
        setParsed(parseCardTextUpdate(attempt.rawText, { requireDeckId: isFolder }));
      }
    }).catch(failure => { if (active) setError(requestError(failure, isFolder)); })
      .finally(() => { if (active) { setBusy(false); requestAnimationFrame(() => closeRef.current?.focus()); } });
    return () => { active = false; };
  }, [target.id, isFolder, setBusy]);

  const buildPreview = async (text = rawText) => {
    const next = parseCardTextUpdate(text, { requireDeckId: isFolder });
    setParsed(next);
    setPreview(null);
    if (next.cards.length && next.total <= 5000) setPreview(await previewCardTextUpdate(target.id, next.cards, { folder: isFolder }));
  };

  const loadFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || running.current || pending) return;
    running.current = true;
    setBusy(true);
    setError('');
    setPreview(null);
    setParsed(null);
    setRawText('');
    setIncludeNew(false);
    setResult(null);
    setFilename(file.name);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(tr('Файл слишком большой. Максимум 5 МБ.'));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setRawText(text);
      await buildPreview(text);
    } catch (failure) { setError(requestError(failure, isFolder)); }
    finally { setBusy(false); running.current = false; }
  };

  const refreshPreview = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await buildPreview(); }
    catch (failure) { setError(requestError(failure, isFolder)); }
    finally { setBusy(false); running.current = false; }
  };

  const apply = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const attempt = pending || {
      filename, rawText,
      payload: { cards: parsed.cards, preview_token: preview.preview_token,
        request_id: crypto.randomUUID(), include_new: includeNew }
    };
    setPending(attempt);
    try {
      const saved = await applyCardTextUpdate(target.id, attempt, { folder: isFolder });
      setResult(saved);
      setPending(null);
      setPreview(null);
      // Content committed. A refresh failure must never cause another apply request.
      try {
        if (isFolder) {
          const affected = new Set(saved.decks.filter(row => row.updated || row.created).map(row => row.deck_id));
          useDeckStore.setState(state => ({ cardsByDeck: Object.fromEntries(
            Object.entries(state.cardsByDeck).filter(([id]) => !affected.has(Number(id)))) }));
          const currentId = useDeckStore.getState().currentDeck?.id;
          if (affected.has(currentId)) await useDeckStore.getState().fetchDeckCards(currentId);
        } else await useDeckStore.getState().fetchDeckCards(target.id);
        await useDeckStore.getState().fetchDecks(true);
      } catch {
        useUiStore.getState().showToast(tr('Обновление сохранено. Обновите список карточек при восстановлении связи.'), 'info');
      }
    } catch (failure) {
      setError(requestError(failure, isFolder));
      if ([403, 404, 409, 422].includes(failure.response?.status)) {
        setPending(null);
        setPreview(null);
      } else {
        try { setPending(await readPendingTextUpdate(target.id, { folder: isFolder })); }
        catch { setPending(attempt); }
      }
    } finally { setBusy(false); running.current = false; }
  };

  const issues = [
    ...(parsed?.errors || []),
    ...(preview?.cards || []).flatMap(card => card.errors.map(code => ({ number: card.number, deck_id: card.deck_id, code })))
  ];
  const canApply = preview?.can_apply && !issues.length && !error
    && (preview.updated > 0 || (includeNew && preview.new > 0));
  const renderCards = cards => cards.filter(card => ['update', 'new', 'missing'].includes(card.status)).map(card => <details className="text-update-card" key={card.number}>
    <summary>{tr('Карточка {{number}}', { number: card.number })}{card.card_id ? ` (ID ${card.card_id})` : ''} — {tr(card.status === 'update' ? 'Изменена' : card.status === 'new' ? 'Новая' : 'ID не найден')}</summary>
    {(card.status === 'update' ? card.changed_fields : ['front', 'back']).map(field => <div className="text-update-field" key={field}>
      <h3>{tr(fieldLabels[field])}</h3><div className="text-update-comparison">
        {card.before && <div><span>{tr('Было')}</span><pre>{card.before[field] || '—'}</pre></div>}
        <div><span>{tr('Стало')}</span><pre>{card.after[field] || '—'}</pre></div>
      </div>
    </div>)}
  </details>);

  return (
    <div className="settings-overlay" onClick={() => !busy && close()}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="text-update-title"
        className="settings-modal deck-text-update-modal"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape' && !busy) close();
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled):not([hidden]), summary')];
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <div className="text-update-header">
          <div><h2 id="text-update-title">{tr(isFolder ? 'Обновить папку из файла' : 'Обновить колоду из файла')}</h2><p>{target.name}</p></div>
          <button ref={closeRef} type="button" className="btn-icon" aria-label={tr('Закрыть')} disabled={busy} onClick={close}><X size={22} /></button>
        </div>
        <div className="text-update-body">
          {!result && <p>{tr(isFolder ? 'Колоды и карточки сопоставляются по ID. Отсутствующие в файле элементы, названия и структура папки сохраняются. Прогресс обучения сохранится.' : 'Карточки сопоставляются по ID. Отсутствующие в файле карточки останутся в колоде. Прогресс обучения сохранится.')}</p>}
          {!result && !pending && <div className="text-update-file">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={18} />{tr('Выбрать файл')}</button>
            <span>{filename || tr('Текстовый файл UTF-8 (.txt или .md)')}</span>
            <input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" aria-label={tr(isFolder ? 'Файл для обновления папки' : 'Файл для обновления колоды')} onChange={loadFile} hidden />
          </div>}
          {busy && <p className="text-update-status" role="status"><Loader2 size={18} className="spin" />{tr('Проверка и обработка...')}</p>}
          {error && <p className="text-update-error" role="alert">{error}</p>}
          {pending && !result && <p role="status">{tr('Результат запроса пока неизвестен. Повторите тот же запрос — новые копии не появятся.')}</p>}
          {parsed && !result && <dl className="text-update-summary">
            {[
              ...(isFolder ? [['Колоды в файле', parsed.deck_ids.length]] : []),
              [isFolder ? 'Карточек в файле' : 'В файле', parsed.total], ['Будет обновлено', preview?.updated ?? '—'], ['Без изменений', preview?.unchanged ?? '—'],
              ['Новых', preview?.new ?? '—'], ['Ошибок', issues.length], ['Не найдено ID', preview?.missing ?? '—']
            ].map(([label, count]) => <div key={label}><dt>{tr(label)}</dt><dd>{count}</dd></div>)}
          </dl>}
          {issues.length > 0 && <ul className="text-update-errors" role="alert">{issues.map((issue, index) =>
            <li key={`${issue.number}-${issue.code}-${index}`}>
              {isFolder && issue.number > 0 && `${tr(issue.deck_id ? 'Колода ID {{id}}' : 'Колода не указана', { id: issue.deck_id })}, `}
              {tr(issue.number > 0 ? 'Карточка {{number}}' : 'Файл', { number: issue.number })}: {tr(issueMessages[issue.code] || 'Не удалось обновить колоду.')}</li>)}</ul>}
          {preview?.missing > 0 && <p className="text-update-error">{tr('Некоторые ID не найдены. Исправьте файл; для намеренного создания новой карточки удалите её card_id.')}</p>}
          {preview?.new > 0 && !pending && <label className="text-update-new">
            <input type="checkbox" checked={includeNew} disabled={busy} onChange={event => setIncludeNew(event.target.checked)} />
            {tr('Добавить новые карточки без ID ({{count}})', { count: preview.new })}
          </label>}
          {isFolder ? preview?.decks.map(group => <details className="text-update-deck" key={group.deck_id ?? 'missing'}>
            <summary>{group.deck_name || tr(group.deck_id ? 'Колода ID {{id}}' : 'Колода не указана', { id: group.deck_id })}
              <span>{tr('Изменений: {{updated}}. Без изменений: {{unchanged}}. Новых: {{new}}. Ошибок: {{errors}}. Не найдено ID: {{missing}}.', group)}</span>
            </summary>
            {renderCards(group.cards)}
          </details>) : renderCards(preview?.cards || [])}
          {result && <div className="text-update-result" role="status"><CheckCircle2 size={24} />
            <p>{tr('Обновлено: {{updated}}. Добавлено: {{created}}. Без изменений: {{unchanged}}.', result)}</p>
          </div>}
        </div>
        <div className="text-update-footer">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{tr(result ? 'Готово' : 'Отмена')}</button>
          {!result && rawText && !pending && <button type="button" className="btn btn-secondary" disabled={busy} onClick={refreshPreview}>{tr('Обновить предпросмотр')}</button>}
          {!result && <button type="button" className="btn btn-primary" disabled={busy || (!pending && !canApply)} onClick={apply}>
            {tr(pending ? 'Проверить результат и повторить' : 'Применить изменения')}
          </button>}
        </div>
      </motion.section>
    </div>
  );
}
