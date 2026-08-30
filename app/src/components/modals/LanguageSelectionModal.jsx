import { useLanguageStore } from '../../store/useLanguageStore';
import LanguageWelcomeModal from './LanguageWelcomeModal';

export const LanguageSelectionModal = () => {
  const { isLanguageModalOpen, setLanguageModalOpen } = useLanguageStore();

  return (
    <LanguageWelcomeModal
      isOpen={isLanguageModalOpen}
      targetOnly={true}
      onClose={() => setLanguageModalOpen(false)}
    />
  );
};
