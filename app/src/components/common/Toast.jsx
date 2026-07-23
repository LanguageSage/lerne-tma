import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const Toast = ({ toast }) => {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div 
          initial={{ opacity: 0, y: -20, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0 }}
          className={`toast glass ${toast.type}`}
        >
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
