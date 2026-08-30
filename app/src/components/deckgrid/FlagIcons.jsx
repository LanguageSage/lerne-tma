import React from 'react';

const FlagWrapper = ({ size = 20, className = "", children }) => (
  <svg 
    width={size} 
    height={Math.round(size * 0.75)} 
    viewBox="0 0 640 480" 
    className={`flag-svg ${className}`}
    style={{ borderRadius: '3px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', flexShrink: 0 }}
  >
    {children}
  </svg>
);

export const FlagDE = (props) => <FlagWrapper {...props}><path fill="#000" d="M0 0h640v160H0z"/><path fill="#DD0000" d="M0 160h640v160H0z"/><path fill="#FFCE00" d="M0 320h640v160H0z"/></FlagWrapper>;
export const FlagGB = (props) => <FlagWrapper {...props}><path fill="#012169" d="M0 0h640v480H0z"/><path fill="#FFF" d="m75 0 245 180L565 0h75v55L400 240l240 185v55h-75L320 300 75 480H0v-55l240-185L0 55V0h75z"/><path fill="#C8102E" d="m424 281 216 163v36h-48L376 317l48-36zM216 199 0 36v-36h48l216 163-48 36zm208-36L640 0v36L424 199l0-36zM0 444l216-163v36L48 480H0v-36z"/><path fill="#FFF" d="M240 0v480h160V0H240zM0 160v160h640V160H0z"/><path fill="#C8102E" d="M272 0v480h96V0h-96zM0 192v96h640v-96H0z"/></FlagWrapper>;
export const FlagNO = (props) => <FlagWrapper {...props}><path fill="#BA0C2F" d="M0 0h640v480H0z"/><path fill="#FFF" d="M160 0v480h120V0H160zM0 180v120h640V180H0z"/><path fill="#00205B" d="M190 0v480h60V0h-60zM0 210v60h640v-60H0z"/></FlagWrapper>;
export const FlagUK = (props) => <FlagWrapper {...props}><path fill="#0057B7" d="M0 0h640v240H0z"/><path fill="#FFD700" d="M0 240h640v240H0z"/></FlagWrapper>;
export const FlagRU = (props) => <FlagWrapper {...props}><path fill="#FFF" d="M0 0h640v160H0z"/><path fill="#0039A6" d="M0 160h640v160H0z"/><path fill="#D52B1E" d="M0 320h640v160H0z"/></FlagWrapper>;

// eslint-disable-next-line react-refresh/only-export-components
export const renderFlag = (code, size = 20) => {
  switch (code) {
    case 'uk': return <FlagUK size={size} />;
    case 'ru': return <FlagRU size={size} />;
    case 'en': return <FlagGB size={size} />;
    case 'no': return <FlagNO size={size} />;
    case 'de':
    default:
      return <FlagDE size={size} />;
  }
};
