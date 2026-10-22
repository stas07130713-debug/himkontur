import { BuildingIcon } from './BuildingIcon';
import type { ReactNode } from 'react';
import type { Basemap } from './MapCanvas';

export type CalculationLayerKey = 'source' | 'primary' | 'secondary' | 'combined' | 'controls' | 'buildings' | 'nppv' | 'boundary' | 'rescue';
export type CalculationLayerState = Readonly<Record<CalculationLayerKey, boolean>>;

type Props = Readonly<{
  basemap: Basemap;
  available: CalculationLayerState;
  visible: CalculationLayerState;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onLayerChange: (key: CalculationLayerKey, visible: boolean) => void;
  onAllChange: (visible: boolean) => void;
}>;

function SectorIcon({ kind }: Readonly<{ kind: 'primary' | 'secondary' | 'final' }>) {
  return <svg className={`legend-sector legend-${kind}`} viewBox="0 0 40 22" aria-hidden="true"><path d="M2 11 33 2A34 34 0 0 1 33 20Z"/></svg>;
}

function AccidentMarkerIcon() {
  return <svg className="legend-source-marker" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11"/><circle cx="14" cy="14" r="4"/></svg>;
}

export function MapLegend({ basemap, available, visible, collapsed, onCollapsedChange, onLayerChange, onAllChange }: Props) {
  const keys = (Object.keys(available) as CalculationLayerKey[]).filter((key) => available[key]);
  const allVisible = keys.length > 0 && keys.every((key) => visible[key]);
  const row = (key: CalculationLayerKey, icon: ReactNode, label: string) => !available[key] ? null : (
    <label className="district-legend-row" key={key}>
      <input type="checkbox" checked={visible[key]} onChange={(event) => onLayerChange(key, event.currentTarget.checked)} />
      {icon}<span>{label}</span>
    </label>
  );
  return <section className={`map-legend district-map-legend calculation-map-legend basemap-${basemap}${collapsed ? ' collapsed' : ''}`} aria-label="Условные обозначения">
    <div className="district-legend-heading">
      <button className="district-legend-collapse" type="button" aria-expanded={!collapsed} onClick={() => onCollapsedChange(!collapsed)}><strong>Условные обозначения</strong><i aria-hidden="true" /></button>
      {!collapsed && <button className="district-legend-all" type="button" onClick={() => onAllChange(!allVisible)}>{allVisible ? 'Скрыть всё' : 'Показать всё'}</button>}
    </div>
    {!collapsed && <div className="district-legend-content">
      {row('source', <AccidentMarkerIcon />, 'Источник аварии')}
      {row('primary', <SectorIcon kind="primary" />, 'Г1 — первичное облако')}
      {row('secondary', <SectorIcon kind="secondary" />, 'Г2 — вторичное облако')}
      {row('combined', <SectorIcon kind="final" />, 'Полная расчётная зона')}
      {row('controls', <BuildingIcon kind="administrative" compact />, 'Контрольные точки')}
      {row('buildings', <i className="district-legend-building prefix-1">№</i>, 'Нумерация зданий')}
      {row('nppv', <i className="district-legend-hydrant" />, 'Источники НППВ')}
      {row('boundary', <i className="district-legend-boundary" aria-hidden="true" />, 'Граница района выезда')}
      {row('rescue', <i className="district-legend-ass">АСС</i>, 'Аварийно-спасательная служба')}
    </div>}
  </section>;
}
