const FORBIDDEN_METADATA_KEYS = new Set([
  'progress', 'srs', 'review_history', 'history', 'session', 'sessions',
  'access_token', 'refresh_token', 'password', 'secret', 'api_key', 'service_role',
  'apikey', 'accesstoken', 'refreshtoken', 'supabase_key', 'authorization',
  'auth', 'authentication', 'jwt', 'cookie', 'cookies', 'session_id', 'session_token',
  'client_secret', 'bot_token', 'credentials', 'user_progress', 'next_review',
  'last_reviewed', 'ease_factor', 'repetitions', 'lapses', 'review_count',
]);

export function assertArchiveSafeMetadata(parsed) {
  const visit = (item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [key, nested] of Object.entries(item)) {
        const normalized = key.toLowerCase().replaceAll('-', '_');
        if (
          FORBIDDEN_METADATA_KEYS.has(normalized)
          || normalized.endsWith('_secret')
          || normalized.endsWith('_password')
          || normalized.endsWith('_token')
        ) {
          throw new Error('Метаданные содержат пользовательское состояние или секреты.');
        }
        visit(nested);
      }
    } else if (Array.isArray(item)) {
      for (const nested of item) {
        visit(nested);
      }
    }
  };
  visit(parsed);
}
