import { triggerHaptic } from './platform';

export const hapticImpact = (style = 'light') => triggerHaptic(style);
export const hapticNotification = (type = 'success') => triggerHaptic(type);
export const hapticSuccess = () => triggerHaptic('success');
export const hapticError = () => triggerHaptic('error');
export const hapticWarning = () => triggerHaptic('warning');
export const hapticSelection = () => triggerHaptic('selection');

