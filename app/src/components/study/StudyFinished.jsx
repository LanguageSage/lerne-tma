import React from 'react';
import { CheckCircle } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';

export const StudyFinished = ({ deck, nextDeck, isLastDeck, alreadyDone, nextReview, onContinue, onRepeat, onGoToDecks }) => {
  const locale = useInterfaceLocale();
  return (
    <div className="finished-view glass">
      <CheckCircle className="study-finished-icon" size={56} aria-hidden="true" />
      <h2>{alreadyDone ? tr('На сегодня всё выполнено') : isLastDeck ? tr('Тема завершена') : tr('Колода завершена')}</h2>
      <p className="study-finished-deck">{deck?.name}</p>
      {!alreadyDone && isLastDeck && <p>{tr('Вы прошли последнюю колоду этой темы.')}</p>}
      {alreadyDone && nextReview && <p>{tr('Следующее повторение: {{date}}', { date: new Date(nextReview).toLocaleDateString(locale) })}</p>}
      <div className="finished-actions">
        {nextDeck && <button className="btn btn-primary" onClick={onContinue}>{tr('Продолжить → {{name}}', { name: nextDeck.name })}</button>}
        <button className={`btn ${nextDeck ? 'btn-secondary' : 'btn-primary'}`} onClick={onRepeat}>
          {alreadyDone ? tr('↻ Повторить колоду сейчас') : tr('↻ Повторить эту колоду')}
        </button>
        <button className="btn btn-secondary" onClick={onGoToDecks}>{tr('К колодам темы')}</button>
      </div>
    </div>
  );
};
