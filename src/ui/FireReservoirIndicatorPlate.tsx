import type { DistrictFireReservoir } from './district-map-model';

function numeric(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function reservoirNumber(value: string): string {
  return value.replace(/^ПВ[-\s]*/iu, '');
}

/** Знак пожарного водоёма по принятому образцу НППВ. */
export function FireReservoirPictogram({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="2" className="reservoir-sign-background" />
      <path className="reservoir-sign-fill" d="M14 14h12v7h10v13H26v14H14V14Zm20 5c21 1 39 17 46 42l-15 5C60 47 49 36 34 34V19Z" />
      <path className="reservoir-sign-stroke" d="M42 25 44 17m7 12 3-9m5 14 5-9m3 15 7-8m-1 16 9-6m-3 15 9-3" />
      <path className="reservoir-sign-water" d="M4 62q5-7 10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0" />
      <path className="reservoir-sign-water reservoir-sign-water-lower" d="M7 74h9m7 0h11m8 0h10m8 0h12m8 0h12M5 87h7m11 0h8m11 0h9m12 0h10" />
      <path className="reservoir-sign-fill" d="M66 62h15l9 33H59l7-33Z" />
    </svg>
  );
}

export function FireReservoirIndicatorPlate({ object, editable = false, onChange }: Readonly<{
  object: DistrictFireReservoir;
  editable?: boolean;
  onChange?: (changes: Partial<DistrictFireReservoir>) => void;
}>) {
  const number = reservoirNumber(object.number);
  return (
    <div className={`district-reservoir-plate${editable ? ' editable' : ''}`} aria-label={`Табличка пожарного водоёма ${object.number}`}>
      <FireReservoirPictogram className="reservoir-plate-pictogram" />
      <div className="reservoir-plate-values">
        <span>ПВ — {editable
          ? <input aria-label="Номер пожарного водоёма" value={number} onChange={(event) => onChange?.({ number: event.currentTarget.value.trim() === '' ? '' : `ПВ-${event.currentTarget.value.replace(/[^0-9а-яa-z-]/giu, '')}` })} />
          : <b>{number || '№'}</b>}</span>
        <span>V — {editable
          ? <input aria-label="Объём пожарного водоёма" inputMode="decimal" value={object.volumeM3 ?? ''} onChange={(event) => onChange?.({ volumeM3: numeric(event.currentTarget.value) })} />
          : <b>{object.volumeM3 === null ? '—' : object.volumeM3.toLocaleString('ru-RU')}</b>} м³</span>
      </div>
    </div>
  );
}
