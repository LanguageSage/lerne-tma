import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bell, 
  Send, 
  Check, 
  Clock, 
  Sparkles, 
  Plus, 
  Trash2, 
  Moon, 
  Globe, 
  Zap, 
  Layers,
  ShieldAlert
} from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';

export const RemindersTab = () => {
  useInterfaceLocale();
  const { 
    reminderSettings, 
    fetchReminderSettings, 
    saveReminderSettings, 
    sendTestReminder 
  } = useSettingsStore();
  const { showToast } = useUiStore();

  const [isSendingTest, setIsSendingTest] = useState(false);
  const [localSettings, setLocalSettings] = useState(reminderSettings || {
    enabled: true,
    frequency: 'twice_daily',
    times: ['09:00', '19:00'],
    hourly_start: '08:00',
    hourly_end: '22:00',
    only_due: false,
    quiet_enabled: false,
    quiet_start: '23:00',
    quiet_end: '07:00',
    timezone_offset: 3
  });

  useEffect(() => {
    fetchReminderSettings();
  }, [fetchReminderSettings]);

  useEffect(() => {
    if (reminderSettings) {
      setLocalSettings(prev => ({
        ...prev,
        ...reminderSettings
      }));
    }
  }, [reminderSettings]);

  // Автоопределение часового пояса при первой загрузке, если не был установлен
  useEffect(() => {
    if (!reminderSettings?.timezone_offset && reminderSettings?.timezone_offset !== 0) {
      const browserOffset = -Math.round(new Date().getTimezoneOffset() / 60);
      setLocalSettings(prev => (prev.timezone_offset !== browserOffset ? { ...prev, timezone_offset: browserOffset } : prev));
    }
  }, [reminderSettings]);

  const handleUpdate = async (updated) => {
    setLocalSettings(updated);
    try {
      await saveReminderSettings(updated);
    } catch {
      showToast(tr("Ошибка сохранения настроек"), 'error');
    }
  };

  const handleToggleEnabled = async (checked) => {
    const updated = { ...localSettings, enabled: checked };
    await handleUpdate(updated);
    showToast(checked ? tr("🔔 Напоминания бота включены") : tr("🔕 Напоминания отключены"), 'info');
  };

  const handleFrequencyChange = async (freq) => {
    let newTimes = [...(localSettings.times || [])];
    if (freq === 'hourly') {
      newTimes = [];
    } else if (freq === 'five_times') {
      newTimes = ['09:00', '12:00', '15:00', '18:00', '21:00'];
    } else if (freq === 'three_times') {
      newTimes = ['09:00', '14:00', '20:00'];
    } else if (freq === 'twice_daily') {
      newTimes = ['09:00', '19:00'];
    } else if (freq === 'daily') {
      newTimes = [newTimes[0] || '10:00'];
    } else if (freq === 'custom' && newTimes.length === 0) {
      newTimes = ['10:00', '18:00'];
    }

    const updated = { ...localSettings, frequency: freq, times: newTimes };
    await handleUpdate(updated);
    showToast(tr("Режим напоминаний обновлен"), 'success');
  };

  const handleTimeChange = async (index, newTime) => {
    const newTimes = [...(localSettings.times || ['09:00'])];
    newTimes[index] = newTime;
    const updated = { ...localSettings, times: newTimes };
    await handleUpdate(updated);
  };

  const handleAddTime = async () => {
    const currentTimes = [...(localSettings.times || [])];
    const lastTime = currentTimes[currentTimes.length - 1] || '12:00';
    let [h, m] = lastTime.split(':').map(Number);
    let nextH = (h + 3) % 24;
    const nextTimeStr = `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const newTimes = [...currentTimes, nextTimeStr].sort();
    const updated = { ...localSettings, frequency: 'custom', times: newTimes };
    await handleUpdate(updated);
    showToast(tr("Добавлено новое время"), 'info');
  };

  const handleRemoveTime = async (index) => {
    const currentTimes = [...(localSettings.times || [])];
    if (currentTimes.length <= 1) {
      showToast(tr("Должно остаться хотя бы одно время"), 'warning');
      return;
    }
    currentTimes.splice(index, 1);
    const updated = { ...localSettings, frequency: 'custom', times: currentTimes };
    await handleUpdate(updated);
    showToast(tr("Время удалено"), 'info');
  };

  const handleTestSend = async () => {
    setIsSendingTest(true);
    try {
      const res = await sendTestReminder();
      if (res?.status === 'success') {
        showToast(tr("🚀 Напоминание отправлено в Telegram!"), 'success');
      } else {
        showToast(res?.message || tr("Не удалось отправить напоминание"), 'error');
      }
    } catch (err) {
      showToast(err?.response?.data?.detail || tr("Ошибка отправки тестового напоминания"), 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  const frequencies = [
    { id: 'hourly', label: tr("Каждый час"), desc: tr("В дневное время (активная учеба)"), icon: Zap, color: '#f59e0b' },
    { id: 'five_times', label: tr("5 раз в день"), desc: '09:00, 12:00, 15:00, 18:00, 21:00', icon: Layers, color: '#ec4899' },
    { id: 'three_times', label: tr("3 раза в день"), desc: tr("Утро, день и вечер"), icon: Clock, color: '#8b5cf6' },
    { id: 'twice_daily', label: tr("2 раза в день"), desc: tr("Утро и вечер (стандарт)"), icon: Check, color: '#38bdf8' },
    { id: 'daily', label: tr("1 раз в день"), desc: tr("Одно напоминание в день"), icon: Bell, color: '#34d399' },
    { id: 'custom', label: tr("Свой график"), desc: tr("Настроить любое время вручную"), icon: Plus, color: '#a855f7' }
  ];

  return (
    <motion.div 
      key="reminders" 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section"
    >
      <h3>{tr("🔔 Напоминания Telegram-бота")}</h3>
      <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>{tr("Бот автоматически проверяет ваш прогресс по SRS и присылает напоминания прямо в Telegram.")}{' '}</p>

      {/* Main Switch */}
      <div className="settings-row" style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Bell size={20} color={localSettings.enabled ? '#34d399' : '#94a3b8'} />
          <div>
            <div style={{ fontWeight: 600, color: '#ffffff' }}>{tr("Включить напоминания")}</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {localSettings.enabled ? tr("Бот отслеживает активные колоды") : tr("Уведомления отключены")}
            </div>
          </div>
        </div>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={Boolean(localSettings.enabled)} 
            onChange={(e) => handleToggleEnabled(e.target.checked)} 
          />
          <span className="slider"></span>
        </label>
      </div>

      {localSettings.enabled && (
        <>
          {/* Frequency Options */}
          <h4 style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '10px', marginTop: '16px' }}>{tr("Частота напоминаний")}{' '}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '18px' }}>
            {frequencies.map(f => {
              const Icon = f.icon;
              const isActive = localSettings.frequency === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleFrequencyChange(f.id)}
                  style={{
                    padding: '12px 10px',
                    borderRadius: '12px',
                    border: isActive ? `2px solid ${f.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    color: '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon size={15} color={f.color} />
                    <span>{f.label}</span>
                    {isActive && <Check size={14} color={f.color} style={{ marginLeft: 'auto' }} />}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4, lineHeight: 1.2 }}>
                    {f.desc}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Hourly Range Configuration */}
          {localSettings.frequency === 'hourly' ? (
            <div style={{ 
              padding: '14px', 
              background: 'rgba(245, 158, 11, 0.08)', 
              borderRadius: '12px', 
              border: '1px solid rgba(245, 158, 11, 0.25)',
              marginBottom: '20px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Zap size={16} color="#f59e0b" />
                <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fef3c7' }}>{tr("Дневные часы для ежечасных напоминаний:")}{' '}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>C</span>
                  <input 
                    type="time" 
                    value={localSettings.hourly_start || '08:00'} 
                    onChange={(e) => handleUpdate({ ...localSettings, hourly_start: e.target.value })}
                    style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: '#ffffff',
                      padding: '5px 8px',
                      borderRadius: '8px',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{tr("До")}</span>
                  <input 
                    type="time" 
                    value={localSettings.hourly_end || '22:00'} 
                    onChange={(e) => handleUpdate({ ...localSettings, hourly_end: e.target.value })}
                    style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: '#ffffff',
                      padding: '5px 8px',
                      borderRadius: '8px',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Time Picker List */
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h4 style={{ fontSize: '0.9rem', color: '#cbd5e1', margin: 0 }}>
                  <Clock size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />{tr("Время отправки (")}{localSettings.times?.length || 0})
                </h4>
                <button
                  type="button"
                  onClick={handleAddTime}
                  style={{
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    color: '#818cf8',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Plus size={13} />
                  <span>{tr("Добавить время")}</span>
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <AnimatePresence>
                  {(localSettings.times || ['09:00']).map((timeVal, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        padding: '8px 14px', 
                        background: 'rgba(255,255,255,0.03)', 
                        borderRadius: '12px', 
                        border: '1px solid rgba(255,255,255,0.06)' 
                      }}
                    >
                      <span style={{ fontSize: '0.85rem', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ 
                          width: 20, 
                          height: 20, 
                          borderRadius: '50%', 
                          background: 'rgba(255,255,255,0.08)', 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          fontSize: '0.72rem',
                          color: '#94a3b8'
                        }}>
                          {idx + 1}
                        </span>{tr("Напоминание")}{' '}{idx + 1}:
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input 
                          type="time" 
                          value={timeVal} 
                          onChange={(e) => handleTimeChange(idx, e.target.value)}
                          style={{
                            background: 'rgba(15, 23, 42, 0.8)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: '#ffffff',
                            padding: '4px 8px',
                            borderRadius: '8px',
                            fontSize: '0.88rem',
                            outline: 'none'
                          }}
                        />
                        {(localSettings.times?.length || 0) > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTime(idx)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title={tr("Удалить это время")}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Advanced Controls */}
          <div style={{ 
            background: 'rgba(255,255,255,0.02)', 
            borderRadius: '14px', 
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '14px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            {/* Timezone */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={18} color="#38bdf8" />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>{tr("Часовой пояс")}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tr("Для точной отправки по вашему времени")}</div>
                </div>
              </div>
              <select
                value={localSettings.timezone_offset ?? 3}
                onChange={(e) => handleUpdate({ ...localSettings, timezone_offset: Number(e.target.value) })}
                style={{
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  padding: '5px 10px',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  outline: 'none'
                }}
              >
                {Array.from({ length: 27 }, (_, i) => i - 12).map(tz => (
                  <option key={tz} value={tz}>
                    UTC{tz >= 0 ? `+${tz}` : tz} {tz === 3 ? tr("(МСК / Киев / Стамбул)") : (tz === 1 ? tr("(Берлин / Париж)") : (tz === 2 ? tr("(Хельсинки)") : ''))}
                  </option>
                ))}
              </select>
            </div>

            {/* Quiet Hours Switch */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Moon size={18} color="#a855f7" />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>{tr("Тихий режим (Ночь)")}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tr("Не присылать с 23:00 до 07:00")}</div>
                </div>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={Boolean(localSettings.quiet_enabled)} 
                  onChange={(e) => handleUpdate({ ...localSettings, quiet_enabled: e.target.checked })} 
                />
                <span className="slider"></span>
              </label>
            </div>

            {/* Only Due Cards Switch */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={18} color="#34d399" />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>{tr("Только созревшие карточки")}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tr("Не напоминать, если созревших карточек 0")}</div>
                </div>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={Boolean(localSettings.only_due)} 
                  onChange={(e) => handleUpdate({ ...localSettings, only_due: e.target.checked })} 
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {/* Info callout */}
          <div style={{ 
            display: 'flex', 
            gap: '10px', 
            padding: '12px 14px', 
            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(99, 102, 241, 0.08))', 
            border: '1px solid rgba(56, 189, 248, 0.25)', 
            borderRadius: '14px',
            marginBottom: '20px'
          }}>
            <Sparkles size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.4' }}>{tr("Бот напоминает")}{' '}<b>{tr("только по активным колодам")}</b>{' '}{tr("(со статусом")}{' '}<b>{tr("«✓ Учу»")}</b>).
            </div>
          </div>
        </>
      )}

      {/* Test Button */}
      <div style={{ marginTop: '10px' }}>
        <button
          type="button"
          onClick={handleTestSend}
          disabled={isSendingTest}
          className="btn"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.92rem',
            border: 'none',
            cursor: isSendingTest ? 'default' : 'pointer',
            opacity: isSendingTest ? 0.7 : 1,
            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.35)'
          }}
        >
          <Send size={16} />
          <span>{isSendingTest ? tr("Отправка...") : tr("⚡ Протестировать напоминание сейчас")}</span>
        </button>
        <p style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', marginTop: '8px' }}>{tr("Бот мгновенно пришлет актуальный расчет созревших карточек в Telegram.")}{' '}</p>
      </div>
    </motion.div>
  );
};

