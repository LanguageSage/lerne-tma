import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bell, Send, Check, Clock, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';

export const RemindersTab = () => {
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
    times: ['10:00', '19:00'],
    frequency: 'twice_daily',
    timezone_offset: 3
  });

  useEffect(() => {
    fetchReminderSettings();
  }, [fetchReminderSettings]);

  useEffect(() => {
    if (reminderSettings) {
      setLocalSettings(reminderSettings);
    }
  }, [reminderSettings]);

  const handleToggleEnabled = async (checked) => {
    const updated = { ...localSettings, enabled: checked };
    setLocalSettings(updated);
    try {
      await saveReminderSettings(updated);
      showToast(checked ? 'Напоминания бота включены' : 'Напоминания бота отключены', 'info');
    } catch {
      showToast('Ошибка сохранения настроек', 'error');
    }
  };

  const handleFrequencyChange = async (freq) => {
    let newTimes = [...(localSettings.times || ['10:00', '19:00'])];
    if (freq === 'daily' && newTimes.length > 1) {
      newTimes = [newTimes[0] || '10:00'];
    } else if (freq === 'twice_daily' && newTimes.length < 2) {
      newTimes = ['10:00', '19:00'];
    }
    const updated = { ...localSettings, frequency: freq, times: newTimes };
    setLocalSettings(updated);
    try {
      await saveReminderSettings(updated);
      showToast('Режим напоминаний обновлен', 'success');
    } catch {
      showToast('Ошибка сохранения настроек', 'error');
    }
  };

  const handleTimeChange = async (index, newTime) => {
    const newTimes = [...(localSettings.times || ['10:00', '19:00'])];
    newTimes[index] = newTime;
    const updated = { ...localSettings, times: newTimes };
    setLocalSettings(updated);
    try {
      await saveReminderSettings(updated);
    } catch {
      showToast('Ошибка сохранения времени', 'error');
    }
  };

  const handleTestSend = async () => {
    setIsSendingTest(true);
    try {
      const res = await sendTestReminder();
      if (res?.status === 'success') {
        showToast('🚀 Тестовое напоминание отправлено в Telegram-чат!', 'success');
      } else {
        showToast(res?.message || 'Не удалось отправить напоминание', 'error');
      }
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Ошибка отправки тестового напоминания', 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <motion.div 
      key="reminders" 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section"
    >
      <h3>🔔 Напоминания Telegram-бота</h3>
      <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>
        Бот вовремя напомнит о карточках, созревших для повторения по интервальной системе (SRS).
      </p>

      {/* Main Switch */}
      <div className="settings-row" style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Bell size={20} color={localSettings.enabled ? '#34d399' : '#94a3b8'} />
          <div>
            <div style={{ fontWeight: 600, color: '#ffffff' }}>Включить напоминания</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {localSettings.enabled ? 'Бот отслеживает активные колоды' : 'Уведомления отключены'}
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
          <h4 style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '8px', marginTop: '16px' }}>
            Частота напоминаний
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '18px' }}>
            <button
              type="button"
              onClick={() => handleFrequencyChange('twice_daily')}
              style={{
                padding: '12px 10px',
                borderRadius: '12px',
                border: localSettings.frequency === 'twice_daily' ? '2px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.1)',
                background: localSettings.frequency === 'twice_daily' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                color: '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>2 раза в день</span>
                {localSettings.frequency === 'twice_daily' && <Check size={14} color="#818cf8" />}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 3 }}>
                Утро и вечер (рекомендуется)
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleFrequencyChange('daily')}
              style={{
                padding: '12px 10px',
                borderRadius: '12px',
                border: localSettings.frequency === 'daily' ? '2px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.1)',
                background: localSettings.frequency === 'daily' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                color: '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>1 раз в день</span>
                {localSettings.frequency === 'daily' && <Check size={14} color="#818cf8" />}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 3 }}>
                Одно напоминание в день
              </div>
            </button>
          </div>

          {/* Time Picker */}
          <h4 style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '8px' }}>
            <Clock size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
            Время отправки
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>Первое напоминание (Утро):</span>
              <input 
                type="time" 
                value={localSettings.times?.[0] || '10:00'} 
                onChange={(e) => handleTimeChange(0, e.target.value)}
                style={{
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  padding: '5px 8px',
                  borderRadius: '8px',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            {localSettings.frequency === 'twice_daily' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>Второе напоминание (Вечер):</span>
                <input 
                  type="time" 
                  value={localSettings.times?.[1] || '19:00'} 
                  onChange={(e) => handleTimeChange(1, e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#ffffff',
                    padding: '5px 8px',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>
            )}
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
            <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.4' }}>
              Бот отслеживает <b>только те колоды</b>, на которых включен статус <b>«✓ Учу»</b>. Если колода лежит про запас — отключите на ней галочку, и бот не будет по ней напоминать.
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
          <span>{isSendingTest ? 'Отправка...' : '⚡ Протестировать напоминание'}</span>
        </button>
        <p style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', marginTop: '8px' }}>
          Бот мгновенно пришлет сообщение в ваш Telegram-чат с расчетом созревших карточек.
        </p>
      </div>
    </motion.div>
  );
};
