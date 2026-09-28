export type WorkplacePdkRow = Readonly<{
  rowNumber: string;
  name: string;
  cas: string;
  formula: string;
  workplacePdk: string;
  airborneState: string;
  hazardClass: string;
  healthEffects: string;
}>;

export type WorkplacePdkDatabase = Readonly<{
  regulation: string;
  revision: string;
  officialPublicationUrl: string;
  consolidatedSourceUrl: string;
  rows: readonly WorkplacePdkRow[];
}>;

export type WorkplacePdkResolution = Readonly<{
  row: WorkplacePdkRow;
  displayValue: string;
  method: 'formula' | 'name';
}>;

type IndexedPdkRow = Readonly<{
  row: WorkplacePdkRow;
  tokens: readonly string[];
  variants: readonly string[];
  primary: string;
  formula: string | null;
}>;

const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const NAME_STOP_WORDS = new Set([
  'безводный', 'безводная', 'безводное', 'сжатый', 'сжатая', 'сжатое', 'охлажденный', 'охлажденная', 'охлажденное',
  'жидкий', 'жидкая', 'жидкое', 'жидкие', 'твердый', 'твердая', 'твердое', 'твердые', 'сухой', 'сухая', 'сухое',
  'увлажненный', 'увлажненная', 'увлажненное', 'расплавленный', 'расплавленная', 'раствор', 'технический', 'техническая',
  'стабилизированный', 'стабилизированная', 'чистый', 'чистая', 'н', 'у', 'к',
  'содержащий', 'содержащая', 'содержащее', 'содержащие', 'более', 'менее', 'массовой', 'долей', 'доля', 'воды', 'вода',
  'дымящий', 'дымящая', 'дымыщее', 'отработанный', 'отработанная', 'отработанное', 'регенерированный', 'регенерированная',
  'стабилизированные', 'стабилизированное', 'охлажденные', 'сжиженный', 'сжиженная', 'сжиженное', 'сжиженные',
]);

function stemRussian(token: string): string {
  if (token.length <= 5) return token;
  return token.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ение|ений|енная|енный|енное|ской|ская|ское|овых|овой|овый|овая|евую|овую|ую|юю|ах|ях|ам|ям|ом|ем|ов|ев|ой|ий|ый|ая|яя|ое|ее|ы|и|а|я|у|ю|е)$/u, '');
}

function canonicalChemicalToken(token: string): string {
  const stemmed = stemRussian(token);
  const aliases: Readonly<Record<string, string>> = {
    монооксид: 'оксид',
    окис: 'оксид',
    окись: 'оксид',
    бора: 'бор',
    трифторист: 'трифторид',
    трехфторист: 'трифторид',
  };
  return aliases[stemmed] ?? stemmed;
}

function nameTokens(value: string): readonly string[] {
  return [...new Set(value.toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/\d+(?:[.,]\d+)?\s*%/gu, ' ')
    .replace(/н\.\s*у\.\s*к\./giu, ' ')
    .match(/[a-zа-я0-9]{2,}/gu)
    ?.filter((token) => !NAME_STOP_WORDS.has(token))
    .map(canonicalChemicalToken)
    .filter((token) => token.length >= 3) ?? [])].sort();
}

function nameVariantKeys(value: string): readonly string[] {
  const pieces = [
    value.replace(/\([^)]*\)/gu, ' '),
    ...[...value.matchAll(/\(([^)]*)\)/gu)].flatMap((match) => (match[1] ?? '').split(/[;/]/gu)),
  ];
  return [...new Set(pieces.map((piece) => nameTokens(piece).join('|')).filter((key) => key.length > 0))];
}

function primaryNameKey(value: string): string {
  return (value.split('(', 1)[0] ?? value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^a-zа-я0-9]+/gu, '');
}

function formulaKey(value: string): string | null {
  const normalized = value
    .replace(/[₀-₉]/gu, (character) => SUBSCRIPT_DIGITS[character] ?? character)
    .replace(/[АВСЕНКМОРТХ]/gu, (character) => ({ А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' }[character] ?? character))
    .replace(/\s+/gu, '');
  if (normalized.length === 0 || /[-()·×/+]/u.test(normalized)) return null;
  const parts = [...normalized.matchAll(/([A-Z][a-z]?)(\d*(?:[.,]\d+)?)?/gu)];
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== normalized) return null;
  const counts = new Map<string, number>();
  for (const part of parts) {
    const element = part[1];
    if (element === undefined) return null;
    counts.set(element, (counts.get(element) ?? 0) + Number((part[2] ?? '1').replace(',', '.')));
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([element, count]) => `${element}${count}`).join('|');
}

const ROW_INDEX_CACHE = new WeakMap<object, readonly IndexedPdkRow[]>();

function indexedRows(rows: readonly WorkplacePdkRow[]): readonly IndexedPdkRow[] {
  const cached = ROW_INDEX_CACHE.get(rows);
  if (cached !== undefined) return cached;
  const indexed = rows.filter((row) => row.workplacePdk.length > 0).map((row) => ({
    row,
    tokens: nameTokens(row.name),
    variants: nameVariantKeys(row.name),
    primary: primaryNameKey(row.name),
    formula: formulaKey(row.formula),
  }));
  ROW_INDEX_CACHE.set(rows, indexed);
  return indexed;
}

function formatPdk(value: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (clean.includes('/')) return `${clean} мг/м³ (максимальная разовая / среднесменная)`;
  return `${clean} мг/м³`;
}

function isMixture(description: string): boolean {
  return /смесь|растворитель|препарат|отход|н\.\s*у\.\s*к\.|издели|материал/iu.test(description);
}

export function resolveWorkplacePdk(
  rows: readonly WorkplacePdkRow[],
  description: string,
  formula: string,
): WorkplacePdkResolution | undefined {
  if (isMixture(description) && formula.trim().length === 0) return undefined;
  const indexed = indexedRows(rows);
  const selectedFormula = formulaKey(formula);
  if (selectedFormula !== null) {
    const byFormula = indexed.filter((item) => item.formula === selectedFormula);
    const formulaMatch = byFormula.length === 1 ? byFormula[0]?.row : undefined;
    if (formulaMatch !== undefined) return { row: formulaMatch, displayValue: formatPdk(formulaMatch.workplacePdk), method: 'formula' };
  }

  const selectedTokens = nameTokens(description);
  if (selectedTokens.length === 0) return undefined;
  const selectedKey = selectedTokens.join('|');
  const selectedVariants = nameVariantKeys(description);
  const directMatches = indexed.filter((item) => item.primary === primaryNameKey(description));
  if (directMatches.length === 1 && directMatches[0] !== undefined) {
    return { row: directMatches[0].row, displayValue: formatPdk(directMatches[0].row.workplacePdk), method: 'name' };
  }
  const aliasMatches = indexed.filter((item) => item.variants.includes(selectedKey));
  if (aliasMatches.length === 1 && aliasMatches[0] !== undefined) {
    return { row: aliasMatches[0].row, displayValue: formatPdk(aliasMatches[0].row.workplacePdk), method: 'name' };
  }
  const ranked = indexed.map((item) => {
    const rowTokens = item.tokens;
    const rowVariants = item.variants;
    const common = selectedTokens.filter((token) => rowTokens.includes(token)).length;
    const exact = selectedKey === rowTokens.join('|') || selectedVariants.some((variant) => rowVariants.includes(variant));
    const containsAll = selectedTokens.length >= 2 && common === selectedTokens.length;
    const normativeNameContained = rowTokens.length >= 2 && rowTokens.every((token) => selectedTokens.includes(token));
    const normativeAliasContained = rowVariants.some((variant) => {
      const tokens = variant.split('|');
      return tokens.length >= 2 && tokens.every((token) => selectedTokens.includes(token));
    });
    const singleDistinctive = selectedTokens.length === 1 && selectedTokens[0] !== undefined && selectedTokens[0].length >= 6 && common === 1;
    const score = exact ? 100 : containsAll ? 94 : normativeAliasContained ? 92 : normativeNameContained ? 90 : singleDistinctive ? 85 : common >= 2 ? common / Math.max(selectedTokens.length, rowTokens.length) * 80 : 0;
    return { row: item.row, score };
  }).filter((candidate) => candidate.score >= 64).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best === undefined || (ranked[1]?.score ?? -1) === best.score) return undefined;
  return { row: best.row, displayValue: formatPdk(best.row.workplacePdk), method: 'name' };
}

export function workplacePdkUnavailableText(description: string): string {
  return isMixture(description)
    ? 'Единая ПДК не устанавливается: контролируется по компонентному составу.'
    : 'Отдельное значение для этой транспортной позиции в таблице 2.1 СанПиН 1.2.3685-21 не установлено.';
}

