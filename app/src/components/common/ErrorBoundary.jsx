import { tr } from '../../i18n/locale';
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught React error:", error, errorInfo);
  }

  handleReload = () => {
    try {
      localStorage.removeItem('lerne_init_cache');
    } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#090d16',
          color: '#f8fafc',
          padding: '24px 20px',
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
        }}>
          <div style={{
            maxWidth: 400,
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 24,
            padding: '28px 24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ color: '#f87171', marginBottom: 12 }}>{tr("Что-то пошло не так")}</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: 20, lineHeight: 1.5 }}>{tr("Произошла непредвиденная ошибка интерфейса. Нажмите кнопку ниже для перезагрузки приложения.")}{' '}</p>
            <button
              onClick={this.handleReload}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >{tr("Перезагрузить приложение")}{' '}</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
