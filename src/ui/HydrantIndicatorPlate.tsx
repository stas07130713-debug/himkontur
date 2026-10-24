import type { DistrictHydrant } from './district-map-model';
import { HYDRANT_PATTERN_SHORT, hydrantNetworkCode } from './district-map-model';

function distance(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

function numeric(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function HydrantIndicatorPlate({ object, editable = false, onChange }: Readonly<{
  object: DistrictHydrant;
  editable?: boolean;
  onChange?: (changes: Partial<DistrictHydrant>) => void;
}>) {
  const foam = object.hydrantType === 'foam';
  const number = object.number.replace(/^ПП?Г[-\s]*/iu, '');
  return (
    <div className={`district-hydrant-plate${editable ? ' editable' : ''}`} aria-label={`${foam ? 'Табличка пенного пожарного гидранта' : 'Табличка пожарного гидранта'} ${object.number}`}>
        <svg viewBox="0 0 100 100" role="img">
          <rect x="1" y="1" width="98" height="98" className="hydrant-plate-frame" />
          <rect x="7" y="7" width="86" height="86" className="hydrant-plate-face" />
          <rect x="8" y="8" width="27" height="15" rx="1" className="hydrant-plate-slot" />
          <rect x="65" y="8" width="27" height="15" rx="1" className="hydrant-plate-slot" />
          {!editable && <>
            <text x="21.5" y="19.5" textAnchor="middle" className="hydrant-plate-small">{HYDRANT_PATTERN_SHORT[object.pattern] || '—'}</text>
            <text x="78.5" y="19.5" textAnchor="middle" className="hydrant-plate-small">{hydrantNetworkCode(object)}</text>
          </>}
          <text x="42" y="50" textAnchor="middle" className="hydrant-plate-big">{foam ? 'ППГ' : 'ПГ'}</text>
          <line x1="58" y1="44" x2="67" y2="44" className="hydrant-plate-dash" />
          <rect x="72" y="35" width="20" height="16" rx="1" className="hydrant-plate-slot" />
          {!editable && <text x="82" y="47" textAnchor="middle" className="hydrant-plate-small">{number || '—'}</text>}
          <rect x="37" y="56" width="26" height="13" rx="1" className="hydrant-plate-slot" />
          <line x1="19" y1="75" x2="81" y2="75" className="hydrant-plate-line" />
          <line x1="50" y1="75" x2="50" y2="87" className="hydrant-plate-line" />
          <path d="M12 75L20 69V81ZM88 75L80 69V81ZM50 94L44 86H56Z" className="hydrant-plate-arrow" />
          <rect x="8" y="80" width="29" height="12" rx="1" className="hydrant-plate-slot" />
          <rect x="63" y="80" width="29" height="12" rx="1" className="hydrant-plate-slot" />
          {!editable && <>
            <text x="50" y="65.5" textAnchor="middle" className="hydrant-plate-distance">{distance(object.signDistanceForwardM)}</text>
            <text x="22.5" y="89" textAnchor="middle" className="hydrant-plate-distance">{distance(object.signDistanceLeftM)}</text>
            <text x="77.5" y="89" textAnchor="middle" className="hydrant-plate-distance">{distance(object.signDistanceRightM)}</text>
          </>}
        </svg>
        {editable && <div className="hydrant-plate-inputs">
          <select className="plate-pattern-input" aria-label="Образец таблички" value={object.pattern} onChange={(event) => onChange?.({ pattern: event.currentTarget.value as DistrictHydrant['pattern'] })}>
            <option value="moscow">МО</option><option value="leningrad">ЛО</option><option value="german">НО</option><option value="other">—</option>
          </select>
          <span className="plate-network-input">
            <select aria-label="Тип сети" value={object.network} onChange={(event) => onChange?.({ network: event.currentTarget.value as DistrictHydrant['network'] })}>
              <option value="ring">К</option><option value="dead-end">Т</option><option value="ring-with-dead-ends">КТ</option>
            </select>
            <b aria-hidden="true">−</b>
            <input aria-label="Диаметр сети на табличке" inputMode="numeric" value={object.diameterMm ?? ''} onChange={(event) => onChange?.({ diameterMm: numeric(event.currentTarget.value) })} />
          </span>
          <input className="plate-number-input" aria-label="Номер гидранта на табличке" value={number} onChange={(event) => onChange?.({ number: event.currentTarget.value.trim() === '' ? '' : `${foam ? 'ППГ' : 'ПГ'}-${event.currentTarget.value.replace(/[^0-9а-яa-z-]/giu, '')}` })} />
          <input className="plate-forward-input" aria-label="Расстояние прямо" inputMode="decimal" value={object.signDistanceForwardM ?? ''} onChange={(event) => onChange?.({ signDistanceForwardM: numeric(event.currentTarget.value) })} />
          <input className="plate-left-input" aria-label="Расстояние влево" inputMode="decimal" value={object.signDistanceLeftM ?? ''} onChange={(event) => onChange?.({ signDistanceLeftM: numeric(event.currentTarget.value) })} />
          <input className="plate-right-input" aria-label="Расстояние вправо" inputMode="decimal" value={object.signDistanceRightM ?? ''} onChange={(event) => onChange?.({ signDistanceRightM: numeric(event.currentTarget.value) })} />
        </div>}
    </div>
  );
}
