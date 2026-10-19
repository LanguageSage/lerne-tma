import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useAuthStore } from '../../store/useAuthStore';
import { useUiStore } from '../../store/useUiStore';
import { getAccessToken } from '../../utils/auth';
import { AuthRequiredModal } from '../modals/AuthRequiredModal';
import './LerneSignIn.css';

export const LerneSignIn = () => {
  useInterfaceLocale();
  const { userProfile, isRestoring, restoreSession, initListeners, lerneSso, loadLerneSso, setAuthModalOpen } = useAuthStore();
  const isAuthOpen = useUiStore(state => state.isAuthModalOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get('request_id') || '';
  const nonce = params.get('nonce') || '';
  const valid = /^[0-9a-f-]{36}$/.test(requestId) && /^no_[A-Za-z0-9_-]{43}$/.test(nonce);
  useEffect(() => {
    restoreSession();
    initListeners();
    loadLerneSso();
  }, [restoreSession, initListeners, loadLerneSso]);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/auth/v2/lerne/confirm', { request_id: requestId, nonce });
      const destination = new URL(response.data.return_url);
      if (destination.origin !== lerneSso.client_origin || destination.pathname !== '/lerne-sso-callback.html') throw new Error();
      window.location.replace(destination.href);
    } catch (err) {
      if (err.response?.status === 401) setAuthModalOpen(true);
      setError(err.response?.status === 401
        ? tr('Сессия Lerne завершилась. Войдите снова и подтвердите вход.')
        : tr('Не удалось подтвердить вход. Проверьте соединение или начните вход в Game Test заново.'));
      setBusy(false);
    }
  };
  const cancel = () => {
    const fragment = new URLSearchParams({ request_id: requestId, error: 'cancelled' });
    window.location.replace(lerneSso.client_origin + '/lerne-sso-callback.html#' + fragment);
  };
  const available = lerneSso?.role === 'issuer';
  return <main className="lerne-sign-in">
    <section className="lerne-sign-in-panel">
      <p className="lerne-sign-in-brand">LERNE</p>
      <h1>{tr('Войти в Game Test')}</h1>
      <p>{tr('Game Test получит подтверждение вашего аккаунта Lerne. Игровые результаты и прогресс будут храниться отдельно в тестовой базе.')}</p>
      {!valid ? <p role="alert">{tr('Некорректный запрос входа. Начните вход из Game Test.')}</p>
        : !lerneSso || isRestoring ? <p role="status">{tr('Проверяем сессию Lerne…')}</p>
          : !available ? <p role="alert">{tr('Вход через Lerne пока не настроен. Вернитесь в Game Test.')}</p>
            : <>
              {getAccessToken() && userProfile && !userProfile.is_guest ? <>
                <p>{tr('Вы вошли как')}: <strong>{userProfile.first_name || userProfile.username || `Lerne · ${userProfile.user_id}`}</strong></p>
                <button className="btn btn-primary" disabled={busy} onClick={confirm}>
                  {busy ? tr('Подтверждаем…') : tr('Подтвердить вход в Game Test')}
                </button>
              </> : <button className="btn btn-primary" disabled={busy} onClick={() => setAuthModalOpen(true)}>{tr('Войти в аккаунт Lerne')}</button>}
              <button className="btn btn-secondary" disabled={busy} onClick={cancel}>{tr('Отмена')}</button>
            </>}
      {error && <p role="alert">{error}</p>}
      {isAuthOpen && <AuthRequiredModal isOpen onClose={() => setAuthModalOpen(false)} title={tr('Вход в аккаунт Lerne')} />}
    </section>
  </main>;
};
