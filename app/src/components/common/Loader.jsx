import React from 'react';
import { RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const GlobalLoader = ({ isVisible, message = "Загрузка данных..." }) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="loading-overlay-global"
        >
          <div className="loading-content">
            <RefreshCw size={48} className="spin" color="#a855f7" />
            <p>{message}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
