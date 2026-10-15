export function CompassRose({ rotation = 0, className = '' }: Readonly<{ rotation?: number; className?: string }>) {
  return (
    <div
      className={`compass-rose${className === '' ? '' : ` ${className}`}`}
      title="Стороны света"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id="compass-face" cx="42%" cy="35%">
            <stop offset="0" stopColor="#164d5f" />
            <stop offset="1" stopColor="#031e2c" />
          </radialGradient>
          <filter id="compass-glow">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#00151f" floodOpacity=".65" />
          </filter>
        </defs>
        <circle className="compass-bezel" cx="60" cy="60" r="55" />
        <circle className="compass-disc" cx="60" cy="60" r="49" />
        <circle className="compass-ring" cx="60" cy="60" r="38" />
        <path className="compass-minor-ticks" d="M60 13v5M60 102v5M13 60h5M102 60h5M27 27l4 4M89 89l4 4M93 27l-4 4M31 89l-4 4" />
        <path className="compass-north" d="M60 23 69 60 60 54 51 60Z" />
        <path className="compass-south" d="M60 97 69 60 60 66 51 60Z" />
        <circle className="compass-hub-outer" cx="60" cy="60" r="6" />
        <circle className="compass-hub" cx="60" cy="60" r="3" />
        <g className="compass-cardinals">
          <text x="60" y="12">С</text><text x="60" y="111">Ю</text><text x="11" y="63">З</text><text x="109" y="63">В</text>
        </g>
      </svg>
    </div>
  );
}
