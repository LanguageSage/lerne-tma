import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useSessionStore } from '../../store/useSessionStore';
import { getUserId } from '../../utils/auth';
import './GradeConfirmation.css';

function Confirmation({ cardId, confirmedAt }) {
  const [visible, setVisible] = useState(() => Date.now() - confirmedAt < 1600);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), Math.max(0, confirmedAt + 1600 - Date.now()));
    return () => clearTimeout(timer);
  }, [confirmedAt]);
  return <div className="study-grade-confirmation" role="status" aria-live="polite">
    {visible && <span><Check size={18} aria-hidden="true" />{tr('Оценка карточки №{{p0}} сохранена', { p0: cardId })}</span>}
  </div>;
}

export function GradeConfirmation() {
  const confirmation = useSessionStore(state => state.gradeConfirmation);
  return confirmation?.userId === getUserId()
    ? <Confirmation key={confirmation.id} cardId={confirmation.cardId} confirmedAt={confirmation.confirmedAt} /> : null;
}
