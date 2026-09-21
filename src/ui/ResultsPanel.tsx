import { round } from '../core/math';
import type { CalculationResult, VerificationResult } from '../core/types';

type Props = Readonly<{
  result: CalculationResult | null;
  verification: VerificationResult | null;
  error: string | null;
  calculationStarted: boolean;
  reportBusy: boolean;
  onOpenTrace: () => void;
  onOpenReport: () => void;
}>;

export function ResultsPanel({ result, verification, error, calculationStarted, reportBusy, onOpenTrace, onOpenReport }: Props) {
  if (error !== null) return <section className="result-error"><strong>Расчет не выполнен</strong><p>{error}</p></section>;
  if (result === null || verification === null) return calculationStarted ? null : <section className="results result-placeholder"><strong>Итоговый расчёт</strong><span>Заполните исходные данные и нажмите «Рассчитать».</span></section>;
  const evaporationMinutes = Number.isFinite(result.evaporationHours) ? Math.round(result.evaporationHours * 60) : null;
  const evaporationHuman = evaporationMinutes === null ? 'не происходит' : `${Math.floor(evaporationMinutes / 60)} ч ${evaporationMinutes % 60} мин`;
  return <section className="results">
    <div className={`verify-badge ${verification.status}`}>
      {verification.status === 'verified' ? '✓ Проверено автоматически' : verification.status === 'warning' ? '⚠ Проверено с предупреждениями' : '✕ Ошибка проверки'}
    </div>
    <div className="result-grid">
      <article className="main-result"><span>Расчётная глубина заражения</span><strong>{round(result.finalDepthKm, 2)} км</strong></article>
      <article className="cloud-result primary"><span>Г1 — первичное облако</span><strong>{round(result.primaryDepthAtForecastKm, 2)} км</strong><small>Максимум по таблице В.2: {round(result.primaryDepthKm, 2)} км · Qэ1 {round(result.primaryEquivalentT, 2)} т</small></article>
      <article className="cloud-result secondary"><span>Г2 — вторичное облако</span><strong>{round(result.secondaryDepthAtForecastKm, 2)} км</strong><small>Максимум по таблице В.2: {round(result.secondaryDepthKm, 2)} км · Qэ2 {round(result.secondaryEquivalentT, 2)} т</small></article>
      <div className="metric-result-row">
        <article className="cloud-result metric-result area-result"><span>Возможная площадь</span><strong>Sв = {round(result.possibleAreaKm2, 2)} км²</strong></article>
        <article className="cloud-result metric-result evaporation-result"><span>Полное испарение</span><strong><b>{evaporationHuman}</b>{evaporationMinutes !== null && <small>({round(result.evaporationHours, 2)} ч)</small>}</strong></article>
      </div>
    </div>
    {result.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
    <div className="result-actions"><button type="button" onClick={onOpenTrace}>Проверить расчёт</button><button type="button" className="primary" disabled={reportBusy} onClick={onOpenReport}>{reportBusy ? 'Формируется…' : 'Сформировать отчёт'}</button></div>
  </section>;
}
