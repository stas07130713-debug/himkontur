import { DISTRICT_LAYER_KEYS, type DistrictLayerKey } from './district-map-visuals';

const BUILDING_LEGEND: readonly Readonly<{ key: DistrictLayerKey; number: string; label: string }>[] = [
  { key: 'building-0', number: '0', label: 'Территории' },
  { key: 'building-1', number: '1', label: 'УХД / КАЦ / ДБ / НТЦ / ЦТК' },
  { key: 'building-2', number: '2', label: 'ЦЭН' },
  { key: 'building-3', number: '3', label: 'РЦ' },
  { key: 'building-4', number: '4', label: 'ХМЦ' },
  { key: 'building-5', number: '5', label: 'ЦЭО' },
  { key: 'building-6', number: '6', label: 'ЦМТО' },
  { key: 'building-7', number: '7', label: 'ТЦ' },
  { key: 'building-8', number: '8', label: 'ПС' },
  { key: 'building-9', number: '9', label: 'Аренда' },
];

export function DistrictMapLegend({ visibleLayers, onLayerChange, onAllChange }: Readonly<{
  visibleLayers: ReadonlySet<DistrictLayerKey>;
  onLayerChange: (key: DistrictLayerKey, visible: boolean) => void;
  onAllChange: (visible: boolean) => void;
}>) {
  const allVisible = DISTRICT_LAYER_KEYS.every((key) => visibleLayers.has(key));
  return (
    <div className="district-map-legend" aria-label="Условные обозначения">
      <div className="district-legend-heading">
        <strong>Условные обозначения</strong>
        <button type="button" onClick={() => onAllChange(!allVisible)}>{allVisible ? 'Скрыть всё' : 'Показать всё'}</button>
      </div>
      <div className="district-legend-building-list">
        {BUILDING_LEGEND.map((item) => <label key={item.key}>
          <input type="checkbox" checked={visibleLayers.has(item.key)} onChange={(event) => onLayerChange(item.key, event.currentTarget.checked)} />
          <i className={`district-legend-building prefix-${item.number}`}>{item.number}</i>
          <span>{item.label}</span>
        </label>)}
      </div>
      <label className="district-legend-row">
        <input type="checkbox" checked={visibleLayers.has('hydrant')} onChange={(event) => onLayerChange('hydrant', event.currentTarget.checked)} />
        <i className="district-legend-hydrant" />
        <span>Пожарные гидранты</span>
      </label>
      <label className="district-legend-row">
        <input type="checkbox" checked={visibleLayers.has('reservoir')} onChange={(event) => onLayerChange('reservoir', event.currentTarget.checked)} />
        <i className="district-legend-reservoir">ПВ</i>
        <span>Пожарные водоёмы</span>
      </label>
      <div className="district-legend-special-list">
        <label className="district-legend-row special">
          <input type="checkbox" checked={visibleLayers.has('response-boundary')} onChange={(event) => onLayerChange('response-boundary', event.currentTarget.checked)} />
          <i className="district-legend-boundary" aria-hidden="true" />
          <span>Граница района выезда</span>
        </label>
        <label className="district-legend-row special">
          <input type="checkbox" checked={visibleLayers.has('rescue-service')} onChange={(event) => onLayerChange('rescue-service', event.currentTarget.checked)} />
          <i className="district-legend-ass">АСС</i>
          <span>Аварийно-спасательная служба</span>
        </label>
      </div>
    </div>
  );
}
