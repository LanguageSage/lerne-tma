import React from 'react';
import { motion } from 'framer-motion';

export const CardBackground = ({ styleType = 'standard' }) => {
  switch (styleType) {
    case 'mesh':
      return (
        <div className="card-bg-layer bg-mesh">
          <motion.div
            className="blob"
            style={{ background: '#a855f7', width: '150px', height: '150px' }}
            animate={{
              x: [0, 100, -50, 0],
              y: [0, -50, 100, 0],
              scale: [1, 1.2, 0.9, 1],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="blob"
            style={{ background: '#3b82f6', width: '180px', height: '180px', right: '-20px', bottom: '-20px' }}
            animate={{
              x: [0, -100, 50, 0],
              y: [0, 100, -50, 0],
              scale: [1, 1.1, 1.3, 1],
            }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="blob"
            style={{ background: '#ec4899', width: '120px', height: '120px', left: '20%', top: '30%' }}
            animate={{
              x: [0, 50, -80, 0],
              y: [0, 80, -30, 0],
            }}
            transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      );

    case 'aurora':
      return (
        <div className="card-bg-layer bg-aurora">
          <motion.div
            className="aurora-wave"
            style={{ 
              background: 'linear-gradient(90deg, rgba(56,189,248,0.2) 0%, rgba(168,85,247,0.4) 50%, rgba(236,72,153,0.2) 100%)',
              width: '200%', height: '200%', left: '-50%', top: '-50%'
            }}
            animate={{
              rotate: [0, 360],
              scale: [1, 1.1, 1],
            }}
            transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          />
          <div className="aurora-overlay" />
        </div>
      );

    case 'holographic':
      return (
        <div className="card-bg-layer bg-holo">
          <motion.div
            className="holo-gradient"
            animate={{
              backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
            style={{
              background: 'linear-gradient(45deg, rgba(255,0,128,0.2), rgba(0,255,255,0.2), rgba(255,255,0,0.2), rgba(255,0,128,0.2))',
              backgroundSize: '400% 400%',
              width: '100%', height: '100%'
            }}
          />
          <div className="holo-glass-effect" />
        </div>
      );

    case 'liquid':
    case 'liquid_sunset':
    case 'liquid_ocean':
    case 'liquid_cosmic':
    case 'liquid_emerald':
      const flowClass = styleType === 'liquid' ? 'bg-liquid' : `bg-liquid-${styleType.split('_')[1]}`;
      return (
        <div className={`card-bg-layer ${flowClass}`}>
          <div className="liquid-container">
            <motion.div 
              className={`liquid-blob ${styleType === 'liquid' ? 'blob-blue' : 'blob-1'}`}
              animate={{
                x: ['-10%', '10%', '-15%', '-10%'],
                y: ['-10%', '15%', '10%', '-10%'],
                scale: [1, 1.2, 0.9, 1],
                rotate: [0, 45, -45, 0]
              }}
              transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div 
              className={`liquid-blob ${styleType === 'liquid' ? 'blob-purple' : 'blob-2'}`}
              animate={{
                x: ['10%', '-15%', '5%', '10%'],
                y: ['10%', '-10%', '15%', '10%'],
                scale: [1.1, 0.9, 1.2, 1.1],
                rotate: [0, -45, 45, 0]
              }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div 
              className={`liquid-blob ${styleType === 'liquid' ? 'blob-cyan' : 'blob-3'}`}
              animate={{
                x: ['0%', '20%', '-20%', '0%'],
                y: ['20%', '0%', '-20%', '20%'],
                scale: [0.9, 1.3, 1, 0.9],
              }}
              transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="liquid-overlay" />
        </div>
      );

    case 'video_aquarium':
      return (
        <div className="card-bg-layer bg-video">
          <video autoPlay loop muted playsInline className="bg-video-element">
            <source src="https://cdn.pixabay.com/video/2023/09/20/181443-866507182_large.mp4" type="video/mp4" />
          </video>
          <div className="video-overlay" />
        </div>
      );

    case 'video_space':
      return (
        <div className="card-bg-layer bg-video">
          <video autoPlay loop muted playsInline className="bg-video-element">
            <source src="https://cdn.pixabay.com/video/2016/02/10/2118-155244104_large.mp4" type="video/mp4" />
          </video>
          <div className="video-overlay" />
        </div>
      );

    case 'video_nature':
      return (
        <div className="card-bg-layer bg-video">
          <video autoPlay loop muted playsInline className="bg-video-element">
            <source src="https://vjs.zencdn.net/v/oceans.mp4" type="video/mp4" />
          </video>
          <div className="video-overlay" />
        </div>
      );

    case 'standard':
    default:
      if (styleType.startsWith('custom_')) {
        const filename = styleType.replace('custom_', '');
        return (
          <div className="card-bg-layer bg-video">
            <video autoPlay loop muted playsInline className="bg-video-element">
              <source src={`/api/media/backgrounds/${filename}`} type="video/mp4" />
            </video>
            <div className="video-overlay" />
          </div>
        );
      }
      return <div className="card-bg-layer bg-standard" />;
  }
};
