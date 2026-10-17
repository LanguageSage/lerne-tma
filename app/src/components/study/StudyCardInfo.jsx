import React from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { SUPPORTED_TARGET_LANGUAGES } from '../../constants/languageConstants';
import { getLevelInfo, getSavedCefr } from '../../utils/levelUtils';

export function StudyCardInfo({ card, language, deckName, source, id }) {
  const locale = useInterfaceLocale();
  const level = getLevelInfo(card)?.level;
  const cefr = getSavedCefr(card);
  const explanation = cefr?.reason || card.reason || cefr?.reason_short || card.reason_short;
  const languageName = SUPPORTED_TARGET_LANGUAGES.find(item => item.code === language)?.name || language;
  const formatDate = value => {
    if (!value) return tr('Нет данных');
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? tr('Нет данных') : date.toLocaleDateString(locale);
  };
  const rows = [
    [tr('Автор'), card.creator_name || tr('Нет данных')],
    // Card coauthorship needs its own API contract; deck collaborators are not card authors.
    [tr('Соавторы'), tr('Пока недоступно')],
    [tr('Дата создания'), formatDate(card.created_at)],
    ...(card.updated_at ? [[tr('Дата изменения'), formatDate(card.updated_at)]] : []),
    [tr('Язык'), languageName || tr('Нет данных')],
    ...(deckName ? [[tr('Колода'), deckName]] : []),
    [tr('Уровень'), level ? [level, explanation].filter(Boolean).join(' · ') : tr('Нет данных')],
    [tr('Источник'), source || tr('Нет данных')],
  ];

  return (
    <section id={id} className="study-card-info" aria-label={tr('Информация о карточке')}>
      <h3>{tr('Информация о карточке')}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div className="study-card-info-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
