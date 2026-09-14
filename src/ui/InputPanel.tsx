import type { ChangeEvent, ReactNode } from 'react';
import { SUBSTANCES } from '../core/reference-data';
import { assessStability } from '../core/stability';
import type { CalculationInput, SpillKind } from '../core/types';
import type { WeatherObservation } from '../core/weather';
import { UiIcon } from './UiIcon';
import { SubstancePicker } from './SubstancePicker';
import { substanceUnNumber } from './substance-display';

type Props = Readonly<{
  input: CalculationInput;
  sourcePlaced: boolean;
  onChange: (input: CalculationInput) => void;
  onFetchWeather: () => void;
  onManualWeather: () => void;
  weatherBusy: boolean;
  weather: WeatherObservation | null;
  weatherError: string | null;
  calculationStarted: boolean;
  onCalculate: () => void;
  onOpenSubstance: (un: string) => void;
  sourceControls: ReactNode;
}>;

const WIND_DIRECTIONS = [
  { degrees: 0, short: 'С', label: 'Северный' },
  { degrees: 45, short: 'СВ', label: 'Северо-восточный' },
  { degrees: 90, short: 'В', label: 'Восточный' },
  { degrees: 135, short: 'ЮВ', label: 'Юго-восточный' },
  { degrees: 180, short: 'Ю', label: 'Южный' },
  { degrees: 225, short: 'ЮЗ', label: 'Юго-западный' },
  { degrees: 270, short: 'З', label: 'Западный' },
  { degrees: 315, short: 'СЗ', label: 'Северо-западный' }
] as const;

function localDateValue(iso: string): string {
  const value = new Date(iso);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimeValue(iso: string): string {
  const value = new Date(iso);
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function updateLocalDateTime(iso: string, dateValue?: string, timeValue?: string): string {
  const value = new Date(iso);
  if (dateValue !== undefined) {
    const [year, month, day] = dateValue.split('-').map(Number);
    if (year !== undefined && month !== undefined && day !== undefined) value.setFullYear(year, month - 1, day);
  }
  if (timeValue !== undefined) {
    const [hours, minutes] = timeValue.split(':').map(Number);
    if (hours !== undefined && minutes !== undefined) value.setHours(hours, minutes, 0, 0);
  }
  return value.toISOString();
}

function numberValue(event: ChangeEvent<HTMLInputElement>): number {
  return event.currentTarget.valueAsNumber;
}
function displayNumber(value: number): number { return Number(value.toFixed(2)); }
function displayMass(value: number): number { return Number(value.toFixed(Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 6 : 2)); }

export function InputPanel({ input, sourcePlaced, onChange, onFetchWeather, onManualWeather, weatherBusy, weather, weatherError, calculationStarted, onCalculate, onOpenSubstance, sourceControls }: Props) {
  const patch = (value: Partial<CalculationInput>) => onChange({ ...input, ...value });
  const selectedSubstanceUn = substanceUnNumber(input.substanceId);
  const stability = assessStability(input);
  const forecastHours = Math.floor(input.elapsedHours + 1e-9);
  const forecastMinutes = Math.round((input.elapsedHours - forecastHours) * 60);
  const updateForecastTotalMinutes = (minutes: number) => patch({ elapsedHours: Math.max(0, Math.min(240, Math.trunc(minutes))) / 60 });
  const updateForecastHours = (hours: number) => {
    if (!Number.isFinite(hours)) return;
    if (hours < forecastHours && forecastMinutes === 0) updateForecastTotalMinutes(forecastHours * 60 - 1);
    else if (hours > forecastHours && forecastMinutes === 59) updateForecastTotalMinutes(forecastHours * 60 + 60);
    else updateForecastTotalMinutes(Math.trunc(hours) * 60 + forecastMinutes);
  };
  const updateForecastMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes)) return;
    updateForecastTotalMinutes(forecastHours * 60 + Math.trunc(minutes));
  };
  return <aside className="panel input-panel">
    <div className="input-panel-scroll">
    <section className="input-section-card substance-section">
      <div className="plain-section-title"><h2>Выбор вещества</h2></div>
      <div className="substance-field"><span>Вещество</span><SubstancePicker substances={SUBSTANCES} value={input.substanceId} onChange={(substanceId) => patch({ substanceId })}/></div>
      <button type="button" className="substance-info-button" disabled={selectedSubstanceUn === 'ОГ'} title={selectedSubstanceUn === 'ОГ' ? 'Для вещества не задан однозначный номер ООН' : 'Открыть карточку вещества в справочнике опасных грузов'} onClick={() => onOpenSubstance(selectedSubstanceUn)}><UiIcon name="info"/>Информация о веществе</button>
    </section>
    <section className="input-section-card source-section">
      <div className="plain-section-title"><h2>Параметры источника</h2></div>
      {sourceControls}
      <div className="field-grid source-core-parameters">
        <label>Масса вещества, т<div className="number-stepper"><button type="button" aria-label="Уменьшить массу на 0,01 т" onClick={() => patch({ massT: Math.max(0, Number((input.massT - 0.01).toFixed(6))) })}>−</button><input type="number" min="0" step="0.00001" value={displayMass(input.massT)} onChange={(event) => patch({ massT: numberValue(event) })}/><button type="button" aria-label="Увеличить массу на 0,01 т" onClick={() => patch({ massT: Number((input.massT + 0.01).toFixed(6)) })}>+</button></div></label>
      </div>
      <label>Характер разлива
        <select value={input.spillKind} onChange={(event) => patch({ spillKind: event.currentTarget.value as SpillKind })}>
          <option value="free">Свободный разлив, слой 0,05 м</option>
          <option value="separateBund">Отдельный поддон</option>
          <option value="commonBund">Общий поддон</option>
        </select>
      </label>
      {input.spillKind === 'separateBund' && <label>Высота обвалования, м<input type="number" min="0.21" step="0.01" value={displayNumber(input.bundHeightM)} onChange={(event) => patch({ bundHeightM: numberValue(event) })} /></label>}
      {input.spillKind === 'commonBund' && <label>Площадь поддона, м²<input type="number" min="1" step="0.01" value={displayNumber(input.commonBundAreaM2)} onChange={(event) => patch({ commonBundAreaM2: numberValue(event) })} /></label>}
    </section>
    <section className="input-section-card accident-time-section">
      <div className="section-heading input-block-title"><h3><UiIcon name="clock"/>Дата и время происшествия</h3><button type="button" className="link now-button" onClick={() => { const now = new Date(); now.setSeconds(0, 0); patch({ accidentTimeIso: now.toISOString() }); }}>Сейчас</button></div>
      <div className="field-grid date-time-grid">
        <label>Дата<input lang="ru-RU" type="date" value={localDateValue(input.accidentTimeIso)} onChange={(event) => patch({ accidentTimeIso: updateLocalDateTime(input.accidentTimeIso, event.currentTarget.value) })} /></label>
        <label>Время<input lang="ru-RU" type="time" value={localTimeValue(input.accidentTimeIso)} onChange={(event) => patch({ accidentTimeIso: updateLocalDateTime(input.accidentTimeIso, undefined, event.currentTarget.value) })} /></label>
      </div>
    </section>

    <section className={`input-section-card weather-section ${weather === null ? 'weather-origin-manual' : 'weather-origin-auto'}`}>
      <div className="section-heading input-block-title"><h3><UiIcon name="weather"/>Метеоусловия</h3><span className="origin">{weather === null ? 'Введено вручную' : `Получено автоматически · ${weather.dataKind === 'archive' ? 'архив' : 'прогноз'}`}</span></div>
      <p className="weather-location">{sourcePlaced ? `Точка источника: ${input.sourcePoint.latitude.toFixed(5)}° с.ш., ${input.sourcePoint.longitude.toFixed(5)}° в.д.` : 'Для получения погоды разместите источник на карте'}</p>
      <div className="weather-actions">
        <button type="button" className="secondary" onClick={onManualWeather}>Ввести вручную</button>
        <button type="button" onClick={onFetchWeather} disabled={weatherBusy || !sourcePlaced}>{weatherBusy ? 'Получение…' : 'Получить автоматически'}</button>
      </div>
      {weatherError !== null && <p className="weather-error">{weatherError}</p>}
      {weather !== null && <p className="hint weather-observation">На {new Date(weather.observedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · облачность {Math.round(weather.cloudCoverPercent)}%</p>}
      <div className="field-grid weather-fields">
        <label>Температура, °C<input type="number" min="-60" max="60" step="0.01" value={displayNumber(input.temperatureC)} onChange={(event) => patch({ temperatureC: numberValue(event) })} /></label>
        <label>Ветер, м/с<input type="number" min="0.1" max="60" step="0.01" value={displayNumber(input.windSpeedMps)} onChange={(event) => patch({ windSpeedMps: numberValue(event) })} /></label>
        <label>Румб — откуда дует
          <select value={WIND_DIRECTIONS.some((item) => item.degrees === input.windFromDegrees) ? input.windFromDegrees : ''} onChange={(event) => patch({ windFromDegrees: Number(event.currentTarget.value) })}>
            {!WIND_DIRECTIONS.some((item) => item.degrees === input.windFromDegrees) && <option value="">По градусам: {input.windFromDegrees}°</option>}
            {WIND_DIRECTIONS.map((item) => <option key={item.degrees} value={item.degrees}>{item.short} — {item.label}</option>)}
          </select>
        </label>
        <label>Точно, ° от севера<input type="number" min="0" max="359.99" step="0.01" value={displayNumber(input.windFromDegrees)} onChange={(event) => patch({ windFromDegrees: numberValue(event) })} /></label>
        <label>Облачность (таблица В.1)
          <select value={input.cloudCoverPercent >= 80 ? 'overcast' : 'clear'} onChange={(event) => patch({ cloudCoverPercent: event.currentTarget.value === 'overcast' ? 100 : 0 })}>
            <option value="clear">Ясно / переменная</option>
            <option value="overcast">Сплошная</option>
          </select>
        </label>
        <label className="checkbox-field"><input type="checkbox" checked={input.snowCover} onChange={(event) => patch({ snowCover: event.currentTarget.checked })}/>Снежный покров</label>
      </div>
      <p className="stability-auto"><strong>Устойчивость: {stability.stability === 'inversion' ? 'инверсия' : stability.stability === 'convection' ? 'конвекция' : 'изотермия'} (автоматически)</strong></p>
    </section>

    <section className="input-section-card forecast-section">
      <div className="input-block-title forecast-title"><h3><UiIcon name="forecast"/>Время, прошедшее с момента аварии, для расчёта</h3></div>
      <fieldset className="forecast-offset">
        <legend>Через сколько после аварии</legend>
        <div><label>Часы<input aria-label="Часы прогноза" type="number" min="0" max="4" step="1" value={forecastHours} onChange={(event) => updateForecastHours(numberValue(event))} /></label><label>Минуты<input aria-label="Минуты прогноза" type="number" min="-1" max="60" step="1" value={forecastMinutes} onChange={(event) => updateForecastMinutes(numberValue(event))} /></label></div>
        <button type="button" className="forecast-now" onClick={() => { const elapsedMinutes = Math.max(1, Math.min(240, Math.round((Date.now() - new Date(input.accidentTimeIso).getTime()) / 60_000))); patch({ elapsedHours: elapsedMinutes / 60 }); }}>Сейчас</button>
        <small>{input.elapsedHours.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ч</small>
      </fieldset>
      <p className="absolute-forecast">Момент прогноза: <strong>{new Date(new Date(input.accidentTimeIso).getTime() + input.elapsedHours * 3_600_000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</strong></p>
    </section>
    </div>
    <button type="button" className="calculate-button" onClick={onCalculate}>Рассчитать</button>
    {calculationStarted && <small className="auto-calc-note">После первого запуска изменения пересчитываются автоматически.</small>}
  </aside>;
}
