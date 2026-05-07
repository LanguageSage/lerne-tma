import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Star } from 'lucide-react';
import api from '../../services/api';

export const FeedbackTab = ({ showToast }) => {
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) {
      showToast("Пожалуйста, введите сообщение");
      return;
    }

    setIsSending(true);
    try {
      await api.post('/feedback', {
        message,
        rating: rating > 0 ? rating : null
      });
      showToast("Спасибо за ваш отзыв!", "success");
      setMessage('');
      setRating(0);
    } catch (err) {
      console.error(err);
      showToast("Не удалось отправить отзыв. Попробуйте позже.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section feedback-tab"
    >
      <h3>Обратная связь</h3>
      <p style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '20px' }}>
        Ваше мнение очень важно для развития проекта. Расскажите, что вам нравится или что стоит улучшить.
      </p>

      <div className="form-group">
        <label>Оцените приложение</label>
        <div className="star-rating" style={{ display: 'flex', gap: '8px', margin: '10px 0' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star 
              key={star}
              size={32}
              onClick={() => setRating(star)}
              fill={rating >= star ? "#FFD700" : "none"}
              color={rating >= star ? "#FFD700" : "rgba(255,255,255,0.3)"}
              style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            />
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>Ваше сообщение</label>
        <textarea 
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Напишите здесь всё, что думаете..."
          style={{ minHeight: '120px' }}
        />
      </div>

      <button 
        className="btn btn-primary btn-full" 
        onClick={handleSubmit} 
        disabled={isSending || !message.trim()}
      >
        {isSending ? 'Отправка...' : (
          <>
            <Send size={18} style={{ marginRight: '8px' }} />
            Отправить отзыв
          </>
        )}
      </button>

      <div style={{ marginTop: '30px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', fontSize: '0.85rem' }}>
        <strong>💡 Подсказка:</strong> В текущей версии для тестирования используется общая модель 
        <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}> Gemini 3 Flash Preview</span>. 
        Вам не нужно вводить свой API ключ.
      </div>
    </motion.div>
  );
};
