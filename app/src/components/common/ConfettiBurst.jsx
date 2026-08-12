import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export const ConfettiBurst = () => {
  const particles = useMemo(() => {
    const symbols = ['🎉', '✨', '⭐', '🌟', '💥', '🟢', '✨', '⭐'];
    const colors = ['#22c55e', '#a855f7', '#eab308', '#3b82f6', '#ec4899', '#10b981'];
    const prng = (seed) => {
      const x = Math.sin(seed + 1) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: 22 }).map((_, i) => ({
      id: i,
      symbol: symbols[i % symbols.length],
      color: colors[i % colors.length],
      x: (prng(i * 4 + 1) - 0.5) * 260,
      y: (prng(i * 4 + 2) - 0.7) * 220,
      scale: 0.7 + prng(i * 4 + 3) * 0.7,
      rotation: (prng(i * 4 + 4) - 0.5) * 360,
    }));
  }, []);

  return (
    <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 100 }}>
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 0, scale: 0, rotate: 0 }}
          animate={{
            opacity: [1, 1, 0],
            x: p.x,
            y: p.y,
            scale: p.scale,
            rotate: p.rotation
          }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            fontSize: '1.5rem',
            color: p.color,
            filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.7))'
          }}
        >
          {p.symbol}
        </motion.div>
      ))}
    </div>
  );
};
