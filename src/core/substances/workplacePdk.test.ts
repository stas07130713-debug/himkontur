import { describe, expect, it } from 'vitest';
import { resolveWorkplacePdk, workplacePdkUnavailableText, type WorkplacePdkRow } from './workplacePdk';

const rows: readonly WorkplacePdkRow[] = [
  { rowNumber: '178', name: 'Аммиак', cas: '7664-41-7', formula: 'NH 3', workplacePdk: '20', airborneState: 'п', hazardClass: '4', healthEffects: '' },
  { rowNumber: '609', name: 'Гидрохлорид (водород хлорид; хлоргидрат)', cas: '7647-01-0', formula: 'ClH', workplacePdk: '5', airborneState: 'п', hazardClass: '2', healthEffects: 'О' },
  { rowNumber: '2362', name: 'Щелочи едкие /растворы в пересчете на гидроксид натрия/', cas: '', formula: '', workplacePdk: '0,5', airborneState: 'а', hazardClass: '2', healthEffects: '' },
  { rowNumber: '1250', name: 'Метанол (метиловый спирт)', cas: '67-56-1', formula: 'CH 4O', workplacePdk: '15/5', airborneState: 'п', hazardClass: '3', healthEffects: '' },
  { rowNumber: '1264', name: 'Метилбензол (толуол)', cas: '108-88-3', formula: 'C 7H 8', workplacePdk: '150/50', airborneState: 'п', hazardClass: '3', healthEffects: '' },
  { rowNumber: '1845', name: 'Серная кислота+', cas: '7664-93-9', formula: 'H 2O 4S', workplacePdk: '1', airborneState: 'а', hazardClass: '2', healthEffects: '' },
  { rowNumber: '369', name: 'Бортрифторид (бор трифтористый)', cas: '7637-07-2', formula: 'BF 3', workplacePdk: '1', airborneState: 'п', hazardClass: '2', healthEffects: '' },
  { rowNumber: '2122', name: 'Углерод оксид (угарный газ; углерода окись)', cas: '630-08-0', formula: 'CO', workplacePdk: '20', airborneState: 'п', hazardClass: '4', healthEffects: '' },
  { rowNumber: '2380', name: '1,2-Эпоксиэтан (оксиран; эпоксиэтилен; этилена окись; этиленоксид)', cas: '75-21-8', formula: 'C 2H 4O', workplacePdk: '3/1', airborneState: 'п', hazardClass: '2', healthEffects: '' },
];

describe('workplace PDK resolver', () => {
  it('matches a formula regardless of element order and subscript glyphs', () => {
    expect(resolveWorkplacePdk(rows, 'КИСЛОТА ХЛОРИСТОВОДОРОДНАЯ', 'HCl')?.displayValue).toBe('5 мг/м³');
    expect(resolveWorkplacePdk(rows, 'АММИАК БЕЗВОДНЫЙ', 'NH₃')?.displayValue).toBe('20 мг/м³');
  });

  it('matches Russian chemical word forms without borrowing another substance', () => {
    expect(resolveWorkplacePdk(rows, 'НАТРИЯ ГИДРОКСИДА РАСТВОР', '')?.displayValue).toBe('0,5 мг/м³');
    expect(resolveWorkplacePdk(rows, 'МЕТАНОЛ', '')?.displayValue).toBe('15/5 мг/м³ (максимальная разовая / среднесменная)');
    expect(resolveWorkplacePdk(rows, 'ТОЛУОЛ', '')?.displayValue).toBe('150/50 мг/м³ (максимальная разовая / среднесменная)');
    expect(resolveWorkplacePdk(rows, 'КИСЛОТА СЕРНАЯ, содержащая более 51% кислоты', '')?.displayValue).toBe('1 мг/м³');
    expect(resolveWorkplacePdk(rows, 'КИСЛОТА СЕРНАЯ ДЫМЯЩАЯ', '')?.displayValue).toBe('1 мг/м³');
    expect(resolveWorkplacePdk(rows, 'КИСЛОТА СЕРНАЯ, РЕГЕНЕРИРОВАННАЯ ИЗ КИСЛОГО ГУДРОНА', '')?.displayValue).toBe('1 мг/м³');
    expect(resolveWorkplacePdk(rows, 'БОРА ТРИФТОРИД', '')?.displayValue).toBe('1 мг/м³');
    expect(resolveWorkplacePdk(rows, 'УГЛЕРОДА МОНООКСИД СЖАТЫЙ', '')?.displayValue).toBe('20 мг/м³');
    expect(resolveWorkplacePdk(rows, 'ЭТИЛЕНА ОКСИД', '')?.displayValue).toBe('3/1 мг/м³ (максимальная разовая / среднесменная)');
    expect(resolveWorkplacePdk(rows, 'ЭТИЛЕНА ОКСИД С АЗОТОМ при общем давлении до 1 МПа', 'C₂H₄O')?.displayValue).toBe('3/1 мг/м³ (максимальная разовая / среднесменная)');
  });

  it('does not invent one value for a mixture', () => {
    expect(resolveWorkplacePdk(rows, 'КИСЛОТЫ АЗОТНОЙ И КИСЛОТЫ ХЛОРИСТОВОДОРОДНОЙ СМЕСЬ', '')).toBeUndefined();
    expect(resolveWorkplacePdk(rows, 'КИСЛОТЫ АЗОТНОЙ И КИСЛОТЫ СЕРНОЙ СМЕСЬ', '')).toBeUndefined();
    expect(workplacePdkUnavailableText('СМЕСЬ ВЕЩЕСТВ')).toContain('по компонентному составу');
  });
});
