import React, { useState } from 'react';
import { User, Mail, Send, BarChart2, Sparkles, Link as LinkIcon, Copy, ExternalLink, Trash2, LogOut } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import api from '../../services/api';
import { isOfflineMode, db } from '../../services/localDb';
import { syncService } from '../../services/syncService';
import { SrsStatsModal } from '../study/SrsStatsModal';
import { openExternalLink, closeApp } from '../../utils/platform';
import { resetUserSession, getUserId } from '../../utils/auth';

export const ProfileTab = ({ userId }) => {
  const { userProfile, setUserProfile, showToast } = useUiStore();
  const [name, setName] = useState(userProfile?.first_name || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [isSaving, setIsSaving] = useState(false);
  const [srsStatsOpen, setSrsStatsOpen] = useState(false);

  const currentUserId = userId || userProfile?.user_id || getUserId();
  const accountParam = userProfile?.username 
    ? `&account=${userProfile.username}` 
    : (userProfile?.first_name ? `&account=${encodeURIComponent(userProfile.first_name)}` : '');
  const personalLink = currentUserId ? `${window.location.origin}/?user_id=${currentUserId}${accountParam}` : '';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await api.post('/auth/sync', {
        first_name: name,
        email: email,
        phone: phone,
        is_guest: userProfile?.is_guest
      });
      
      if (res.data.status === 'ok') {
        const updatedProfile = { ...(userProfile || {}), first_name: name, email: email, phone: phone };
        setUserProfile(updatedProfile);
        localStorage.setItem('lerne_user_profile', JSON.stringify(updatedProfile));
        showToast("Профиль обновлен!", "success");
      }
    } catch {
      showToast("Ошибка при сохранении");
    } finally {
      setIsSaving(false);
    }
  };

  const [isPolling, setIsPolling] = useState(false);
  const botLink = `https://t.me/LerneDeutsch287_bot?start=link_${currentUserId}`;
  
  const startPolling = async () => {
    if (isPolling) return;
    if (!currentUserId) return;
    
    try {
      await api.post(`/auth/session?guest_id=${currentUserId}`);
      setIsPolling(true);
      
      const interval = setInterval(async () => {
        try {
          const res = await api.get(`/auth/session/${userProfile.user_id}`);
          if (res.data.status === 'completed') {
            clearInterval(interval);
            setIsPolling(false);
            setUserProfile(res.data.user);
            localStorage.setItem('lerne_user_id', res.data.user_id);
            localStorage.setItem('lerne_user_profile', JSON.stringify(res.data.user));
            showToast("Аккаунт успешно привязан!", "success");
            
            setTimeout(() => {
              window.location.reload();
            }, 800);
          }
        } catch { /* ignore */ }
      }, 2000);
      
      setTimeout(() => {
        clearInterval(interval);
        setIsPolling(false);
      }, 120000);
    } catch { /* ignore */ }
  };

  return (
    <div className="profile-tab">
      <h3>Ваш профиль</h3>
      <p className="tab-description">
        {userProfile?.is_guest && !userProfile?.first_name 
          ? (isPolling ? "Ожидание подтверждения в Telegram..." : "Вы используете гостевой режим. Привяжите Telegram для сохранения прогресса.")
          : "Ваш профиль настроен."}
      </p>

      <div className="profile-form">
        <div className="form-group">
          <label><User size={14} /> Имя</label>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="Введите ваше имя"
          />
        </div>

        <div className="form-group">
          <label><Mail size={14} /> Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="example@mail.com"
          />
        </div>

        <div className="form-group">
          <label>📱 Телефон</label>
          <input 
            type="text" 
            value={phone} 
            onChange={(e) => setPhone(e.target.value)} 
            placeholder="+7 (900) 000-00-00"
          />
        </div>

        {!userProfile?.is_guest && userProfile?.username && (
          <div className="form-group">
            <label><Send size={14} /> Telegram</label>
            <div className="telegram-contact-display">
              <a href={`https://t.me/${userProfile.username}`} target="_blank" rel="noopener noreferrer">
                @{userProfile.username}
              </a>
            </div>
          </div>
        )}

        <button 
          className="btn btn-primary" 
          onClick={handleSave} 
          disabled={isSaving}
        >
          {isSaving ? "Сохранение..." : "Сохранить изменения"}
        </button>

        {/* SRS Analytics Section */}
        <div className="link-telegram-section glass" style={{ marginTop: '16px', border: '1px solid rgba(168, 85, 247, 0.3)', background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(59, 130, 246, 0.04))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={18} color="#a855f7" />
              Статистика памяти (SRS)
            </h4>
            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', fontWeight: 600 }}>SM-2 PRO</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 12px 0' }}>
            Анализ удержания памяти, распределение зрелости карточек и прогноз повторений на 7 дней.
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%', background: 'linear-gradient(135deg, #a855f7, #6366f1)', border: 'none' }}
            onClick={() => setSrsStatsOpen(true)}
          >
            <Sparkles size={16} style={{ marginRight: '6px' }} />
            Открыть аналитику SRS
          </button>
        </div>

        {/* Personal Web Link Section */}
        {personalLink && (
          <div className="link-telegram-section glass" style={{ marginTop: '16px', border: '1px solid rgba(99, 102, 241, 0.3)', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.04))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LinkIcon size={18} color="#818cf8" />
                Персональная ссылка
              </h4>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 12px 0' }}>
              Ваша уникальная ссылка для доступа к аккаунту и колодам из любого браузера.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0, 0, 0, 0.25)', padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <span style={{ fontSize: '0.82rem', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, userSelect: 'all' }}>
                {personalLink}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(personalLink);
                    } else {
                      const ta = document.createElement('textarea');
                      ta.value = personalLink;
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    showToast("Ссылка скопирована!", "success");
                  } catch {
                    showToast("Не удалось скопировать", "error");
                  }
                }}
                style={{
                  background: 'rgba(168, 85, 247, 0.2)',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  color: '#c084fc',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  flexShrink: 0
                }}
                title="Копировать ссылку"
              >
                <Copy size={14} />
                <span>Копировать</span>
              </button>
              <button
                type="button"
                onClick={() => openExternalLink(personalLink)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  borderRadius: '8px',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
                title="Открыть в браузере"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          </div>
        )}

        {userProfile?.is_guest && (
          <div className="link-telegram-section glass">
            <h4>Синхронизация</h4>
            <p>Чтобы ваш прогресс был доступен на всех устройствах, используйте нашего бота.</p>
            <a 
              href={botLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className={`btn btn-telegram ${isPolling ? 'polling' : ''}`}
              onClick={startPolling}
            >
              <Send size={16} /> {isPolling ? "Ожидание..." : "Привязать Telegram"}
            </a>
          </div>
        )}

        {isOfflineMode() && (
          <div className="link-telegram-section glass" style={{ marginTop: '15px' }}>
            <h4>Локальная база данных</h4>
            <p>Данные сохраняются на вашем устройстве. Синхронизируйте их с сервером при наличии сети.</p>
            <button 
              className="btn btn-primary"
              onClick={async () => {
                showToast("Синхронизация...");
                const res = await syncService.sync();
                if (res.success) {
                  showToast("Синхронизация успешно завершена!", "success");
                  const { fetchDecks } = useDeckStore.getState();
                  fetchDecks(true);
                } else {
                  showToast(`Сбой синхронизации: ${res.reason || 'нет сети'}`);
                }
              }}
            >
              Синхронизировать сейчас
            </button>
          </div>
        )}

        {/* Account Management & Reset */}
        <div className="link-telegram-section glass" style={{ marginTop: '20px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.04)' }}>
          <h4 style={{ margin: '0 0 6px 0', color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Trash2 size={16} />
            Управление данными и аккаунтом
          </h4>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 12px 0' }}>
            Вы можете сбросить текущую сессию в чистый гостевой режим или полностью удалить все данные с сервера.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={() => {
                if (window.confirm("Сбросить сессию и войти как новый гость без регистрации?")) {
                  resetUserSession();
                }
              }}
            >
              <LogOut size={15} />
              Сбросить сессию / Войти как гость
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.85rem', color: '#fca5a5', background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={async () => {
                if (window.confirm("ВНИМАНИЕ! Это навсегда удалит все ваши колоды, карточки и прогресс с сервера. Вы уверены?")) {
                  try {
                    await api.delete('/auth/account');
                    
                    // 1. Полная очистка локальной базы данных IndexedDB (Dexie)
                    try {
                      if (db && typeof db.delete === 'function') {
                        await db.delete();
                      }
                    } catch (dbErr) {
                      console.warn("Failed to clear local IndexedDB:", dbErr);
                    }

                    // 2. Полная очистка localStorage и sessionStorage
                    try {
                      localStorage.clear();
                      sessionStorage.clear();
                    } catch (storageErr) {
                      console.warn("Failed to clear storage:", storageErr);
                    }

                    showToast("Аккаунт и все данные удалены. Закрываем...", "info");
                    
                    // 3. Закрываем приложение
                    setTimeout(() => {
                      closeApp();
                      if (typeof window !== 'undefined') {
                        try {
                          window.close();
                        } catch { /* ignore */ }
                        window.location.href = 'about:blank';
                      }
                    }, 800);

                  } catch (err) {
                    showToast(err?.response?.data?.detail || "Ошибка при удалении", "error");
                  }
                }
              }}
            >
              <Trash2 size={15} />
              Удалить аккаунт и все данные
            </button>
          </div>
        </div>
      </div>

      <SrsStatsModal isOpen={srsStatsOpen} onClose={() => setSrsStatsOpen(false)} />
    </div>
  );
};

