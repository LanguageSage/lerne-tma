// Minimal Offline API Stub
// Full offline mock implementation is safely backed up in offlineApi.js.bak
export const offlineApi = {
  async handle(method, rawUrl) {
    throw new Error(`Offline mode is disabled. [${method.toUpperCase()}] ${rawUrl}`);
  }
};
