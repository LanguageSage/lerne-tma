import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';

export const DeckIntroEditModal = ({ isOpen, onClose, deck, currentIntro = {}, onSave }) => {
  useInterfaceLocale();

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('');
  const [learningOutcomes, setLearningOutcomes] = useState(['']);
  const [estimatedTime, setEstimatedTime] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(currentIntro.title ?? deck?.name ?? '');
      setTopic(currentIntro.topic ?? deck?.topic ?? '');
      setDescription(currentIntro.description ?? '');
      setGoal(currentIntro.goal ?? '');
      const outcomes = Array.isArray(currentIntro.learning_outcomes) && currentIntro.learning_outcomes.length > 0
        ? currentIntro.learning_outcomes
        : [''];
      setLearningOutcomes(outcomes);
      setEstimatedTime(currentIntro.estimated_time ?? '');
      setRecommendations(currentIntro.recommendations ?? '');
    }
  }, [isOpen, currentIntro, deck]);

  if (!isOpen) return null;

  const handleAddOutcome = () => {
    setLearningOutcomes(prev => [...prev, '']);
  };

  const handleRemoveOutcome = (index) => {
    setLearningOutcomes(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
  };

  const handleOutcomeChange = (index, value) => {
    setLearningOutcomes(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const filteredOutcomes = learningOutcomes.map(o => o.trim()).filter(Boolean);
      const updatedIntro = {
        title: title.trim(),
        topic: topic.trim(),
        description: description.trim(),
        goal: goal.trim(),
        learning_outcomes: filteredOutcomes,
        estimated_time: estimatedTime.trim(),
        recommendations: recommendations.trim()
      };
      await onSave(updatedIntro);
      onClose();
    } catch (err) {
      console.error('Failed to save intro info:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className="settings-modal wide-modal"
          onClick={e => e.stopPropagation()}
          style={{ maxHeight: '90vh', overflowY: 'auto' }}
        >
          <div className="settings-header">
            <h2>{tr("Редактирование вступительного экрана")}</h2>
            <button
              type="button"
              className="close-btn"
              onClick={onClose}
              aria-label={tr("Закрыть")}
            >
              <X size={22} />
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Заголовок занятия (название)")}
              </label>
              <input
                type="text"
                className="input-field"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={deck?.name || tr("Название колоды")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
              />
            </div>

            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Тема занятия")}
              </label>
              <input
                type="text"
                className="input-field"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder={tr("Например: Склонение прилагательных")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
              />
            </div>

            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Краткое описание")}
              </label>
              <textarea
                rows={2}
                className="input-field"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={tr("Краткий обзор темы...")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
              />
            </div>

            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Цель занятия")}
              </label>
              <textarea
                rows={2}
                className="input-field"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder={tr("Например: Научиться правильно использовать окончания в Akkusativ")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
              />
            </div>

            <div className="settings-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                  {tr("Чему научится пользователь (пункты)")}
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-tiny"
                  onClick={handleAddOutcome}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  <Plus size={14} />
                  <span>{tr("Добавить пункт")}</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {learningOutcomes.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="input-field"
                      value={item}
                      onChange={e => handleOutcomeChange(idx, e.target.value)}
                      placeholder={tr("Например: Определять Akkusativ")}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleRemoveOutcome(idx)}
                      title={tr("Удалить")}
                      style={{ padding: '8px', color: '#f87171', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Ориентировочное время")}
              </label>
              <input
                type="text"
                className="input-field"
                value={estimatedTime}
                onChange={e => setEstimatedTime(e.target.value)}
                placeholder={tr("Например: 15 минут")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
              />
            </div>

            <div className="settings-section">
              <label style={{ display: 'block', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '6px' }}>
                {tr("Рекомендации (оставьте пустым, если нет)")}
              </label>
              <textarea
                rows={2}
                className="input-field"
                value={recommendations}
                onChange={e => setRecommendations(e.target.value)}
                placeholder={tr("Оставьте пустым для скрытия блока...")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                {tr("Отмена")}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Save size={18} />
                <span>{saving ? tr("Сохранение...") : tr("Сохранить")}</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
