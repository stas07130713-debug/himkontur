import { round } from '../core/math';
import type { CalculationResult, VerificationResult } from '../core/types';

type Props = Readonly<{
  result: CalculationResult;
  verification: VerificationResult;
  onClose: () => void;
}>;

const OPERAND_MEANING: Readonly<Record<string, string>> = {
  K1: 'доля вещества, переходящая в первичное облако',
  K2: 'коэффициент физических свойств вещества',
  K3: 'отношение пороговых токсодоз',
  K4: 'влияние скорости ветра',
  K5: 'степень вертикальной устойчивости воздуха',
  K6: 'влияние времени после начала аварии',
  K7: 'влияние температуры воздуха',
  Q0: 'масса разлившегося вещества',
  Qэ1: 'эквивалентное количество вещества в первичном облаке',
  Qэ2: 'эквивалентное количество вещества во вторичном облаке',
  h: 'толщина слоя разлива',
  d: 'плотность жидкого вещества',
  u: 'скорость ветра',
  Г1: 'глубина зоны заражения первичным облаком',
  Г2: 'глубина зоны заражения вторичным облаком',
  'Г′': 'большая из глубин первичного и вторичного облаков',
  'Г″': 'меньшая из глубин первичного и вторичного облаков',
  Г: 'расчётная глубина зоны',
  N: 'время, на которое выполняется прогноз',
  V: 'скорость переноса переднего фронта облака',
  Гmax: 'предельная глубина расчёта',
  φ: 'угловой размер зоны возможного заражения'
};

export function TraceDialog({ result, verification, onClose }: Props) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="trace-dialog" role="dialog" aria-modal="true" aria-label="Проверка расчета" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>Проверка расчета</h2><p>{verification.status === 'failed' ? 'Обнаружены расхождения' : 'Повторное вычисление совпало с основным'}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header>
      {verification.differences.map((difference) => <p className="warning" key={difference}>{difference}</p>)}
      <div className="trace-list">{result.trace.map((item, index) => <details key={item.id} open={index === 0}>
        <summary><span>{index + 1}. {item.title}</span><strong>{Number.isFinite(item.result) ? round(item.result, 4) : '∞'} {item.unit}</strong></summary>
        <div className="trace-body"><code>{item.formula}</code><p><b>Подстановка:</b> {item.substitution}</p>
          <table><thead><tr><th>Коэффициент</th><th>Что обозначает</th><th>Значение</th><th>Источник</th><th>Расчёт / пояснение</th></tr></thead><tbody>
            {item.operands.map((value, operandIndex) => <tr key={`${item.id}-${value.symbol}-${operandIndex}`}><td>{value.symbol}</td><td>{OPERAND_MEANING[value.symbol] ?? 'расчётное значение'}</td><td>{value.value} {value.unit}</td><td>{value.origin}</td><td>{value.calculation ?? 'Принято непосредственно из указанного источника.'}</td></tr>)}
          </tbody></table>
        </div>
      </details>)}</div>
    </section>
  </div>;
}
