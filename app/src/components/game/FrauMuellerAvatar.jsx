import React from 'react';
import './FrauMuellerAvatar.css';

/**
 * FrauMuellerAvatar - Animated character portrait of Frau Müller.
 * Features:
 * - Dynamic mouth talking animation when isSpeaking is true
 * - Natural eye blinking
 * - Subtle head nodding during speech
 * - Radiating sound wave rings when speaking
 * - Contextual badges for Thinking, Listening, Speaking
 *
 * @param {boolean} isSpeaking - Whether Frau Müller is currently speaking
 * @param {string} phase - Current GamePhase (NPC_SPEAKING, USER_LISTENING, AI_THINKING, etc.)
 * @param {'small'|'medium'|'large'|'hero'} size - Size variant
 * @param {boolean} showBadge - Whether to render status badge
 * @param {string} className - Additional CSS class
 */
export function FrauMuellerAvatar({
  isSpeaking = false,
  phase = 'IDLE',
  size = 'medium',
  showBadge = false,
  className = '',
}) {
  const isThinking = phase === 'AI_THINKING';
  const isListening = phase === 'USER_LISTENING';

  return (
    <div
      className={`frau-avatar-container size-${size} ${isSpeaking ? 'is-speaking' : ''} ${isThinking ? 'is-thinking' : ''} ${isListening ? 'is-listening' : ''} ${className}`}
      aria-label="Frau Müller"
    >
      {/* Sound waves when speaking */}
      {isSpeaking && (
        <div className="frau-sound-waves" aria-hidden="true">
          <span className="wave-ring wave-1" />
          <span className="wave-ring wave-2" />
          <span className="wave-ring wave-3" />
        </div>
      )}

      {/* SVG Character */}
      <svg
        viewBox="0 0 200 200"
        className="frau-avatar-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Background gradient */}
          <linearGradient id="frauBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e0e7ff" />
            <stop offset="100%" stopColor="#ede9fe" />
          </linearGradient>

          {/* Hair gradient */}
          <linearGradient id="frauHairGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#854d0e" />
            <stop offset="50%" stopColor="#713f12" />
            <stop offset="100%" stopColor="#542e0c" />
          </linearGradient>

          {/* Hair highlight */}
          <linearGradient id="frauHairHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a16207" />
            <stop offset="100%" stopColor="#ca8a04" />
          </linearGradient>

          {/* Cardigan gradient */}
          <linearGradient id="frauCardiganGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0d9488" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
        </defs>

        {/* Backdrop circle */}
        <circle cx="100" cy="100" r="96" fill="url(#frauBgGradient)" className="frau-backdrop" />

        {/* Back hair */}
        <path
          d="M 50 115 C 45 70, 70 30, 100 30 C 130 30, 155 70, 150 115 C 145 145, 138 165, 134 175 C 130 170, 126 150, 126 150 C 126 150, 74 150, 74 150 C 74 150, 70 170, 66 175 C 62 165, 55 145, 50 115 Z"
          fill="url(#frauHairGradient)"
        />

        {/* Torso & Cardigan */}
        <g className="frau-torso">
          {/* Cardigan / Shoulders */}
          <path
            d="M 38 200 C 42 160, 62 145, 82 142 L 100 162 L 118 142 C 138 145, 158 160, 162 200 Z"
            fill="url(#frauCardiganGradient)"
          />

          {/* Collar/Blouse */}
          <path
            d="M 82 142 L 100 172 L 118 142 L 112 136 L 100 152 L 88 136 Z"
            fill="#f8fafc"
          />

          {/* Pearl necklace hint */}
          <path
            d="M 85 142 Q 100 154 115 142"
            stroke="#fef08a"
            strokeWidth="3"
            strokeDasharray="1,5"
            strokeLinecap="round"
            fill="none"
          />
        </g>

        {/* Animated Head Group (nods when speaking, tilts when thinking) */}
        <g className={`frau-head-group ${isSpeaking ? 'nod-anim' : ''} ${isThinking ? 'tilt-anim' : ''}`}>
          {/* Neck */}
          <path d="M 88 128 L 88 148 Q 100 154 112 148 L 112 128 Z" fill="#fbd5b5" />

          {/* Head base */}
          <ellipse cx="100" cy="102" rx="41" ry="46" fill="#fcd5b8" />

          {/* Ears */}
          <ellipse cx="59" cy="104" rx="6" ry="10" fill="#fbd5b5" />
          <ellipse cx="141" cy="104" rx="6" ry="10" fill="#fbd5b5" />
          {/* Small pearl earrings */}
          <circle cx="58" cy="110" r="3" fill="#ffffff" stroke="#e2e8f0" strokeWidth="0.8" />
          <circle cx="142" cy="110" r="3" fill="#ffffff" stroke="#e2e8f0" strokeWidth="0.8" />

          {/* Cheeks / Blush */}
          <ellipse cx="76" cy="114" rx="8" ry="5" fill="#fb7185" opacity="0.35" />
          <ellipse cx="124" cy="114" rx="8" ry="5" fill="#fb7185" opacity="0.35" />

          {/* Eyebrows */}
          <path
            d="M 72 82 Q 83 77 92 82"
            stroke="#78350f"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            className="frau-eyebrow-left"
          />
          <path
            d="M 108 82 Q 117 77 128 82"
            stroke="#78350f"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            className="frau-eyebrow-right"
          />

          {/* Eyes (Blinking animation) */}
          <g className="frau-eyes">
            {/* Left Eye */}
            <g className="frau-eye frau-eye-left">
              <ellipse cx="82" cy="94" rx="7.5" ry="5.5" fill="#ffffff" />
              <circle cx="82.5" cy="94" r="4" fill="#3b2210" />
              <circle cx="84" cy="92.5" r="1.5" fill="#ffffff" />
              <path d="M 74 92 Q 82 88 90 92" stroke="#451a03" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </g>

            {/* Right Eye */}
            <g className="frau-eye frau-eye-right">
              <ellipse cx="118" cy="94" rx="7.5" ry="5.5" fill="#ffffff" />
              <circle cx="117.5" cy="94" r="4" fill="#3b2210" />
              <circle cx="119" cy="92.5" r="1.5" fill="#ffffff" />
              <path d="M 110 92 Q 118 88 126 92" stroke="#451a03" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </g>
          </g>

          {/* Stylish Glasses */}
          <g className="frau-glasses">
            {/* Left rim */}
            <rect x="71" y="85" width="22" height="18" rx="8" fill="rgba(240, 249, 255, 0.25)" stroke="#701a75" strokeWidth="2.5" />
            {/* Right rim */}
            <rect x="107" y="85" width="22" height="18" rx="8" fill="rgba(240, 249, 255, 0.25)" stroke="#701a75" strokeWidth="2.5" />
            {/* Bridge */}
            <path d="M 93 92 Q 100 89 107 92" stroke="#701a75" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            {/* Temples */}
            <path d="M 71 91 L 60 90" stroke="#701a75" strokeWidth="2" strokeLinecap="round" />
            <path d="M 129 91 L 140 90" stroke="#701a75" strokeWidth="2" strokeLinecap="round" />
            {/* Glint on glasses */}
            <path d="M 74 88 L 81 88" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            <path d="M 110 88 L 117 88" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          </g>

          {/* Nose */}
          <path
            d="M 98 97 L 96 112 Q 100 115 104 112"
            stroke="#ea580c"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.75"
          />

          {/* MOUTH: Animated talking vs gentle smile */}
          <g className="frau-mouth-group">
            {isSpeaking ? (
              /* Moving Animated Mouth */
              <g className="frau-mouth-animated">
                {/* Mouth cavity (talking animation scale) */}
                <ellipse
                  cx="100"
                  cy="131"
                  rx="11"
                  ry="7"
                  fill="#881337"
                  className="frau-mouth-cavity"
                />
                {/* Upper Teeth */}
                <path
                  d="M 93 127 Q 100 129 107 127"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="frau-teeth"
                />
                {/* Tongue */}
                <ellipse
                  cx="100"
                  cy="135"
                  rx="6"
                  ry="3.5"
                  fill="#fb7185"
                  className="frau-tongue"
                />
                {/* Upper lip contour */}
                <path
                  d="M 88 126 Q 94 124 100 126 Q 106 124 112 126"
                  stroke="#be123c"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            ) : (
              /* Resting Warm Smile */
              <g className="frau-mouth-smile">
                <path
                  d="M 88 129 Q 100 140 112 129"
                  stroke="#be123c"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Smile dimples */}
                <path d="M 86 127 Q 87 130 89 131" stroke="#be123c" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
                <path d="M 114 127 Q 113 130 111 131" stroke="#be123c" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
              </g>
            )}
          </g>

          {/* Front Hair / Bangs & Volume */}
          <g className="frau-front-hair">
            {/* Left side volume */}
            <path
              d="M 60 76 C 60 48, 80 42, 100 42 C 108 42, 116 44, 124 48 C 105 52, 75 62, 64 88 C 61 84, 60 80, 60 76 Z"
              fill="url(#frauHairGradient)"
            />
            {/* Soft hair swoop */}
            <path
              d="M 64 66 C 85 52, 125 54, 138 78 C 128 66, 100 62, 75 74 Z"
              fill="url(#frauHairHighlight)"
              opacity="0.8"
            />
            {/* Right side hair curl */}
            <path
              d="M 124 48 C 136 54, 142 66, 142 84 C 142 98, 138 116, 136 124 C 133 110, 134 94, 131 82 C 129 74, 126 66, 124 48 Z"
              fill="url(#frauHairGradient)"
            />
            {/* Left side hair curl */}
            <path
              d="M 60 82 C 58 96, 62 114, 65 124 C 67 110, 66 94, 69 82 Z"
              fill="url(#frauHairGradient)"
            />
          </g>
        </g>
      </svg>

      {/* Floating Status Badge (optional) */}
      {showBadge && (
        <div className="frau-status-pill">
          {isSpeaking && <span className="pill-pulse speaking">Говорит…</span>}
          {isThinking && <span className="pill-pulse thinking">Думает…</span>}
          {isListening && <span className="pill-pulse listening">Слушает…</span>}
        </div>
      )}
    </div>
  );
}

export default FrauMuellerAvatar;
