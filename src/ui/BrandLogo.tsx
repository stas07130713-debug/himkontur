type Props = Readonly<{ compact?: boolean }>;

export function BrandLogo({ compact = false }: Props) {
  return <div className={`chemcontour-logo${compact ? ' compact' : ''}`} aria-label="Химконтур">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#22d6c7"/><stop offset="1" stopColor="#006d72"/></linearGradient></defs>
      <path className="logo-triangle" d="M31 5 6 51c-2 4 1 8 5 8h16l7-12H20l17-31-6-11Z"/>
      <path className="logo-angle" d="m40 13 14 24H30l10-17 5 8h-3l-5 9h22L45 13h-5Z"/>
      <path className="logo-cloud" d="M30 51h20a7 7 0 0 0 1-14 11 11 0 0 0-21 3 6 6 0 0 0 0 11Z"/>
    </svg>
    <div><strong>ХИМКОНТУР</strong>{!compact && <small>Система поддержки принятия решений при ЧС</small>}</div>
  </div>;
}
