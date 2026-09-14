import { useState, type CSSProperties } from 'react';
import { SUBSTANCES } from '../core/reference-data';
import type { CalculationInput } from '../core/types';
import {
  CAPACITY_MASS_COEFFICIENT,
  formatCalculatedQuantity,
  massFromSource,
  pipelineVolumeM3,
  SOURCE_LIBRARY,
  type SourceConfiguration
} from './source-library';

type Props = Readonly<{
  selected: SourceConfiguration;
  input: CalculationInput;
  onSelect: (source: SourceConfiguration) => void;
  onConfigure: (source: SourceConfiguration) => void;
}>;

const sourceStyle = (source: SourceConfiguration): CSSProperties | undefined =>
  source.imageDataUrl === undefined ? undefined : { backgroundImage: `url(${source.imageDataUrl})` };

function standardSummary(source: SourceConfiguration): string {
  if (source.id === 'rail') return '54 т · 43,46 м³';
  if (source.id === 'tank') return '40 м³';
  if (source.id === 'rail-tanks') return '2 × 26 т · 2 × 20,93 м³';
  if (source.id === 'cylinder') return '60 л';
  return 'объём задаётся вручную';
}

export function SourcePalette({ selected, input, onSelect, onConfigure }: Props) {
  const [overrides, setOverrides] = useState<Readonly<Record<string, SourceConfiguration>>>({});
  const sources = SOURCE_LIBRARY.map((source) => overrides[source.id] ?? source);
  const substance = SUBSTANCES.find((item) => item.id === selected.substanceId);
  const density = substance?.densityLiquidTPerM3 ?? 0;
  const coefficient = selected.conversionTPerM3 ?? density;
  const coefficientText = coefficient.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  const calculatedMass = massFromSource(selected, density);
  const calculatedVolumeText = formatCalculatedQuantity(selected.volumeM3);
  const calculatedMassText = formatCalculatedQuantity(calculatedMass);
  const calculatedMassKgText = (calculatedMass * 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hasPreparedCards = input.substanceId === 'chlorine';

  const configure = (next: SourceConfiguration) => {
    setOverrides((current) => ({ ...current, [next.id]: next }));
    onConfigure(next);
  };
  const configureCustom = (patch: Partial<SourceConfiguration>) => {
    let next: SourceConfiguration = { ...selected, ...patch };
    if (patch.calculationMode !== undefined) {
      const pipeline = patch.calculationMode === 'pipeline';
      next = {
        ...next,
        kind: pipeline ? 'process' : 'tank',
        label: `${substance?.name ?? 'АХОВ'} — ${pipeline ? 'трубопровод' : 'ёмкость'}`,
        imageDataUrl: pipeline ? '/assets/sources/generic-pipeline.png' : '/assets/sources/generic-vessel.png'
      };
    }
    if (next.calculationMode === 'pipeline') {
      next = { ...next, volumeM3: pipelineVolumeM3(next.pipelineLengthM ?? 0, next.pipelineDiameterMm ?? 0) };
    }
    configure(next);
  };
  const configurePipeline = (patch: Partial<SourceConfiguration>) => {
    const next = { ...selected, ...patch };
    configure({ ...next, volumeM3: pipelineVolumeM3(next.pipelineLengthM ?? 0, next.pipelineDiameterMm ?? 0) });
  };
  const configureContainer = (index: 0 | 1, checked: boolean) => {
    const enabled: [boolean, boolean] = [...(selected.enabledContainerUnits ?? [true, true])] as [boolean, boolean];
    enabled[index] = checked;
    if (!enabled[0] && !enabled[1]) enabled[index === 0 ? 1 : 0] = true;
    const count = enabled.filter(Boolean).length;
    configure({ ...selected, enabledContainerUnits: enabled, volumeM3: count * 26 * CAPACITY_MASS_COEFFICIENT / 1.553 });
  };
  const restoreDefaults = () => {
    const standard = SOURCE_LIBRARY.find((item) => item.id === selected.id);
    if (standard === undefined) return;
    setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== selected.id)));
    onConfigure(standard);
  };
  const restoreNormativeCoefficient = () => {
    if (density > 0) configureCustom({ conversionTPerM3: density });
  };

  const pipelineFields = (custom: boolean) => <>
    <div className="field-grid">
      <label>Длина трубопровода между задвижками, м
        <input type="number" min="0" step="0.01" value={Number((selected.pipelineLengthM ?? 0).toFixed(2))} onChange={(event) => (custom ? configureCustom : configurePipeline)({ pipelineLengthM: Number(event.currentTarget.value) })}/>
      </label>
      <label>Внутренний диаметр трубопровода, мм
        <input type="number" min="0" step="0.01" value={Number((selected.pipelineDiameterMm ?? 0).toFixed(2))} onChange={(event) => (custom ? configureCustom : configurePipeline)({ pipelineDiameterMm: Number(event.currentTarget.value) })}/>
      </label>
    </div>
    <output className="custom-source-volume">Расчётный объём трубопровода: <strong>{calculatedVolumeText} м³</strong></output>
  </>;

  const coefficientField = (custom: boolean) => <>
    <label>Коэффициент перевода объёма в массу, т/м³
      <input type="number" min="0" step="0.001" value={Number(coefficient.toFixed(3))} onChange={(event) => (custom ? configureCustom : configurePipeline)({ conversionTPerM3: Number(event.currentTarget.value) })}/>
      <small>Стандарт: плотность жидкости из таблицы В.3 — {density.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} т/м³.</small>
    </label>
    {custom && <button type="button" className="restore-coefficient" onClick={restoreNormativeCoefficient}>Вернуть стандартный коэффициент</button>}
  </>;

  const massSummary = <p className="computed-mass">
    Расчётная масса: <strong>{calculatedMassText} т</strong>
    {calculatedMass > 0 && calculatedMass < 0.01 && <span> ({calculatedMassKgText} кг)</span>}
    <small>{selected.calculationMode === 'pipeline'
      ? `V = π × (${((selected.pipelineDiameterMm ?? 0) / 1000).toFixed(3)})² / 4 × ${(selected.pipelineLengthM ?? 0).toFixed(2)} = ${calculatedVolumeText} м³; m = ${calculatedVolumeText} × ${coefficientText} = ${calculatedMassText} т`
      : `m = V × d / 1,25 = ${selected.volumeM3.toFixed(2)} × ${coefficientText} / 1,25 = ${calculatedMassText} т`}
    </small>
  </p>;

  return <section className="source-palette embedded-source-palette">
    {hasPreparedCards ? <>
      <details className="source-selector">
        <summary><span className={`source-photo source-photo-${selected.kind}`} style={sourceStyle(selected)}/><span><small>Тип источника</small><strong>{selected.label}</strong></span><i/></summary>
        <div className="source-dropdown-options">{sources.map((configured) => <button key={configured.id} type="button" draggable className={`source-card source-option-card${selected.id === configured.id ? ' active' : ''}`} onClick={(event) => { onSelect(configured); event.currentTarget.closest('details')?.removeAttribute('open'); }} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-ahov-source-config', JSON.stringify(configured)); }}><span className={`source-photo source-photo-${configured.kind}`} style={sourceStyle(configured)}/><span><strong>{configured.label}</strong><small>{standardSummary(configured)}</small></span></button>)}</div>
      </details>
      {selected.id === 'rail-tanks' && <fieldset className="container-unit-selector"><legend>Используемые контейнеры</legend><label><input type="checkbox" checked={(selected.enabledContainerUnits ?? [true, true])[0]} onChange={(event) => configureContainer(0, event.currentTarget.checked)}/>Контейнер 1 — 26 т / 20,93 м³</label><label><input type="checkbox" checked={(selected.enabledContainerUnits ?? [true, true])[1]} onChange={(event) => configureContainer(1, event.currentTarget.checked)}/>Контейнер 2 — 26 т / 20,93 м³</label></fieldset>}
      <details className="source-editor">
        <summary>Дополнительные параметры источника</summary>
        <div className="source-default-row"><span>Стандарт: {standardSummary(SOURCE_LIBRARY.find((item) => item.id === selected.id) ?? selected)}</span><button type="button" onClick={restoreDefaults}>Вернуть стандартные значения</button></div>
        <label>Название<input value={selected.label} onChange={(event) => configure({ ...selected, label: event.target.value })}/></label>
        {selected.calculationMode === 'pipeline' ? <>{pipelineFields(false)}{coefficientField(false)}</> : <>
          <div className="field-grid"><label>Объём ёмкости, м³<input type="number" min="0" step="0.01" value={Number(selected.volumeM3.toFixed(2))} onChange={(event) => configure({ ...selected, volumeM3: Number(event.target.value) })}/></label><label>Коэффициент заполнения<output className="capacity-coefficient">1,25</output></label></div>
          <label>Коэффициент перевода объёма в массу, т/м³<input type="number" min="0" step="0.001" value={Number(coefficient.toFixed(3))} onChange={(event) => configure({ ...selected, conversionTPerM3: Number(event.currentTarget.value) })}/><small>Стандарт: плотность жидкого хлора из таблицы В.3 — 1,553 т/м³.</small></label>
        </>}
        {massSummary}
      </details>
    </> : <details className="custom-source-card">
      <summary className="custom-source-card-heading" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-ahov-source-config', JSON.stringify(selected)); }}><span className={`source-photo source-photo-${selected.kind}`} style={sourceStyle(selected)}/><div><small>Редактируемая карточка источника</small><strong>{selected.label}</strong></div><i/></summary>
      <div className="custom-source-card-body">
        <label>Название источника<input value={selected.label} onChange={(event) => configureCustom({ label: event.currentTarget.value })}/></label>
        <label>Вид источника<select value={selected.calculationMode ?? 'vessel'} onChange={(event) => configureCustom({ calculationMode: event.currentTarget.value as 'vessel' | 'pipeline' })}><option value="vessel">Ёмкость или резервуар</option><option value="pipeline">Трубопровод</option></select></label>
        {selected.calculationMode === 'pipeline' ? pipelineFields(true) : <label>Объём ёмкости, м³<input type="number" min="0" step="0.01" value={Number(selected.volumeM3.toFixed(2))} onChange={(event) => configureCustom({ volumeM3: Number(event.currentTarget.value) })}/></label>}
        {coefficientField(true)}
        {selected.calculationMode !== 'pipeline' && <small className="capacity-rule-note">Для ёмкости дополнительно применяется установленный коэффициент заполнения 1,25.</small>}
        {massSummary}
      </div>
    </details>}
  </section>;
}
