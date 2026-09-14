import { BuildingIcon } from './BuildingIcon';

type Props = Readonly<{ compact?: boolean; hasSource: boolean; showOverlap: boolean; showPrimary: boolean; showSecondary: boolean; showCombined: boolean; hasControls: boolean }>;

function SectorIcon({ kind }: Readonly<{ kind: 'overlap' | 'primary' | 'secondary' | 'final' }>) {
  return <svg className={`legend-sector legend-${kind}`} viewBox="0 0 40 22" aria-hidden="true"><path d="M2 11 33 2A34 34 0 0 1 33 20Z"/></svg>;
}

function AccidentMarkerIcon() {
  return <svg className="legend-source-marker" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11"/><circle cx="14" cy="14" r="4"/></svg>;
}

export function MapLegend({ compact = false, hasSource, showOverlap, showPrimary, showSecondary, showCombined, hasControls }: Props) {
  if (!hasSource && !showOverlap && !showPrimary && !showSecondary && !showCombined && !hasControls) return null;
  return <section className={`map-legend${compact ? ' compact' : ''}`}>
    <h2>Условные обозначения</h2>
    {hasSource && <div><AccidentMarkerIcon/><span>Источник аварии</span></div>}
    {(showOverlap || showPrimary) && <div><SectorIcon kind="primary"/><span>Г1 — первичное облако</span></div>}
    {showSecondary && <div><SectorIcon kind="secondary"/><span>Г2 — вторичное облако</span></div>}
    {showCombined && <div><SectorIcon kind="final"/><span>Полная расчётная зона</span></div>}
    {hasControls && <div><BuildingIcon kind="administrative" compact/><span>Контрольная точка</span></div>}
  </section>;
}
