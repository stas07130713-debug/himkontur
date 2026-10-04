import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Worker } from 'tesseract.js';
import { getEmergencyCardByUN } from '../core/emergencyCards/emergencyCardLookup';
import { EmergencyCardRepository } from '../core/emergencyCards/emergencyCardRepository';
import { SUBSTANCES } from '../core/reference-data';
import { SUBSTANCE_PRESENTATION } from './substance-display';
import { prepareOcrCandidates, prepareOcrSpatialCandidate } from './photo-ocr';
import { HazardLabel, type HazardLabelData } from './HazardLabel';
import { getPublishedSubstanceByUN } from '../core/substances/substanceDataPipeline';
import { OPERATIONAL_FACTS_CATALOG, type WaterCompatibility } from '../core/substances/operationalFactsCatalog';
import { resolveWorkplacePdk, workplacePdkUnavailableText, type WorkplacePdkDatabase } from '../core/substances/workplacePdk';
import { ADDITIONAL_FORMULA_BY_UN } from '../core/substances/transportFormulaCatalog';

type DangerousGood = Readonly<{ description: string; un: string; className: string; classificationCode: string; hazardNumber: string; packingGroup: string; transportCategory: string; formula: string; hazardLabels: readonly HazardLabelData[] }>;
type HazardLabelRow = Readonly<{ rowIndex: number; un: string; description: string; hazardLabels: readonly HazardLabelData[]; verificationStatus: 'verified-adr-2025' | 'not-matched-in-adr-2025' }>;
type HazardLabelDatabase = Readonly<{ rows: readonly HazardLabelRow[] }>;
type Status = 'manual' | 'preliminary' | 'confirmed';
type RecognizedPlacard = Readonly<{ id: number; hazard: string; un: string }>;
type OcrRead = Readonly<{ region: number; row: 'upper' | 'lower' | 'whole' | 'fallback'; label: string; numbers: readonly string[]; confidence: number }>;

const FORMULA_BY_UN = Object.values(SUBSTANCE_PRESENTATION).reduce<Record<string, string>>((result, item) => { if (item.un.length > 0 && result[item.un] === undefined) result[item.un] = item.formula; return result; }, { ...ADDITIONAL_FORMULA_BY_UN });
const SEARCH_ALIASES_BY_UN = SUBSTANCES.reduce<Record<string, string>>((result, substance) => { const un = SUBSTANCE_PRESENTATION[substance.id]?.un; if (un !== undefined && un.length > 0) result[un] = `${result[un] ?? ''} ${substance.name}`; return result; }, {});
const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
let emergencyRepositoryPromise: Promise<EmergencyCardRepository> | null = null;
let ocrWorkerPromise: Promise<Worker> | null = null;

function loadEmergencyRepository(): Promise<EmergencyCardRepository> {
  emergencyRepositoryPromise ??= EmergencyCardRepository.load().catch((error: unknown) => {
    emergencyRepositoryPromise = null;
    throw error;
  });
  return emergencyRepositoryPromise;
}

async function loadOcrWorker(): Promise<Worker> {
  ocrWorkerPromise ??= import('tesseract.js').then(({ createWorker }) => {
    const base = new URL('.', document.baseURI);
    return createWorker('eng', 1, {
      workerPath: new URL('ocr/worker.min.js', base).href,
      corePath: new URL('ocr/core', base).href,
      langPath: new URL('tessdata', base).href,
      gzip: false,
    });
  }).catch((error: unknown) => {
    ocrWorkerPromise = null;
    throw error;
  });
  return ocrWorkerPromise;
}

function normalized(value: string): string { return value.toLocaleLowerCase('ru-RU').replace(/[₀-₉]/gu, (character) => SUBSCRIPT_DIGITS[character] ?? character).replace(/ё/gu, 'е').replace(/[^a-zа-я0-9]+/gu, ''); }
function displayFormula(value: string): string {
  const subscripts: Readonly<Record<string, string>> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  return value.replace(/\s+/gu, '').replace(/\d/gu, (digit) => subscripts[digit] ?? digit);
}
function parseDatabase(text: string, labelDatabase: HazardLabelDatabase): readonly DangerousGood[] {
  const parsed = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).flatMap((line, rowIndex) => {
    const columns = line.split('\t');
    const description = columns[0];
    const un = columns[1];
    if (description === undefined || un === undefined || !/^\d{4}$/u.test(un)) return [];
    const labels = labelDatabase.rows[rowIndex];
    const labelsMatch = labels?.rowIndex === rowIndex && labels.un === un && labels.description === description;
    return [{
      description, un,
      className: columns[2] ?? '', classificationCode: columns[3] ?? '', hazardNumber: columns[4] ?? '',
      packingGroup: columns[5] ?? '', transportCategory: columns[6] ?? '', formula: FORMULA_BY_UN[un] ?? '',
      hazardLabels: labelsMatch && labels.verificationStatus === 'verified-adr-2025' ? labels.hazardLabels : [],
    }];
  });
  return parsed.filter((item, index, all) => all.findIndex((candidate) => candidate.un === item.un && candidate.description === item.description && candidate.classificationCode === item.classificationCode && candidate.hazardNumber === item.hazardNumber) === index);
}
function cleanEmergencyText(value = ''): string {
  return value
    .replace(/^.*(?:Руководств[ао]\s+ERG|CAMEO|NOAA|NIOSH|CHEMTREC|ПОЗВОНИТЕ\s+911).*$/gimu, '')
    .replace(/\s*\(\s*-?\d+(?:[.,]\d+)?\s*°?F\s*\)/giu, '')
    .replace(/-?\d+(?:[.,]\d+)?\s*°?F\b/giu, '')
    .replace(/Если транспортная бумага\s+недоступен/giu, 'Если транспортный документ недоступен')
    .replace(/в закрытых или закрытых помещениях/giu, 'в закрытых или плохо проветриваемых помещениях')
    .replace(/\b([А-Яа-яЁё]{3,})\s+\1\b/giu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}
function sentences(value = ''): readonly string[] { return cleanEmergencyText(value).split(/(?<=[.!?])\s+/u).map((item) => item.trim()).filter((item) => item.length > 2); }
function DocumentParagraph({ label, value }: Readonly<{ label: string; value: string | null }>) {
  const text = cleanEmergencyText(value ?? '');
  return text.length > 0 ? <p><strong>{label}</strong> {text}</p> : null;
}
function ocrNumbers(text: string): readonly string[] { return [...new Set([...text.split(/\r?\n/u).map((line) => line.replace(/\D/gu, '')).filter((value) => /^\d{2,4}$/u.test(value)), ...(text.match(/\d{2,4}/gu) ?? [])])]; }
function hazardDigits(value: string): string { return value.replace(/\D/gu, ''); }
function currentFlag(reference: Readonly<{ current: boolean }>): boolean { return reference.current; }

type DigitConsensus = Readonly<{ value: string; observations: number; weakestAgreement: number; directVotes: number }>;

function digitConsensus(reads: readonly OcrRead[], length: number): DigitConsensus | undefined {
  const observations = reads.flatMap((read) => read.numbers
    .filter((value) => value.length === length)
    .map((value) => ({ value, weight: 1 + Math.max(0, Math.min(100, read.confidence)) / 200 })));
  if (observations.length < 2) return undefined;
  let weakestAgreement = 1;
  let value = '';
  for (let position = 0; position < length; position += 1) {
    const weights = new Map<string, number>();
    for (const observation of observations) {
      const digit = observation.value[position];
      if (digit !== undefined) weights.set(digit, (weights.get(digit) ?? 0) + observation.weight);
    }
    const ranked = [...weights].sort((left, right) => right[1] - left[1]);
    const best = ranked[0];
    if (best === undefined) return undefined;
    value += best[0];
    const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
    weakestAgreement = Math.min(weakestAgreement, best[1] / Math.max(1, total));
  }
  return { value, observations: observations.length, weakestAgreement, directVotes: observations.filter((item) => item.value === value).length };
}

function consensusPlacard(reads: readonly OcrRead[], database: readonly DangerousGood[], strict: boolean): RecognizedPlacard | undefined {
  for (const region of [...new Set(reads.map((read) => read.region))]) {
    const regionReads = reads.filter((read) => read.region === region);
    const upperReads = regionReads.filter((read) => read.row === 'upper' || read.row === 'whole');
    const lowerReads = regionReads.filter((read) => read.row === 'lower' || read.row === 'whole');
    const un = digitConsensus(lowerReads, 4);
    if (un === undefined || un.directVotes < 2 || un.weakestAgreement < (strict ? .72 : .58)) continue;
    for (const length of [2, 3]) {
      const hazard = digitConsensus(upperReads, length);
      if (hazard === undefined || hazard.directVotes < (strict ? 2 : 1) || hazard.weakestAgreement < (strict ? .72 : .58)) continue;
      // The directory validates a visually established pair; it must never
      // choose the digits merely because a different OCR guess also happens
      // to be a real UN entry.
      const good = database.find((item) => item.un === un.value && hazardDigits(item.hazardNumber) === hazard.value);
      if (good !== undefined) return { id: region, hazard: hazard.value, un: un.value };
    }
  }
  return undefined;
}

function transportPhysicalState(good: DangerousGood | null): string | undefined {
  if (good === null) return undefined;
  const name = good.description.toLocaleUpperCase('ru-RU').replace(/Ё/gu, 'Е');
  if (good.className === '2') {
    if (/ОХЛАЖДЕНН\w*\s+ЖИДК\w*|СЖИЖЕНН\w*\s+ПЕРЕОХЛАЖДЕНИ/iu.test(name)) return 'Охлаждённый сжиженный газ (криогенная жидкость)';
    if (/СЖИЖЕНН/iu.test(name)) return 'Сжиженный газ под давлением';
    if (/СЖАТ/iu.test(name)) return 'Сжатый газ под давлением';
    if (/РАСТВОРЕНН/iu.test(name)) return 'Газ, растворённый под давлением';
    if (/АДСОРБИРОВАНН/iu.test(name)) return 'Адсорбированный газ под давлением';
    const transportForm = /^([1-8])/u.exec(good.classificationCode.trim())?.[1];
    if (transportForm === '1') return 'Сжатый газ под давлением';
    if (transportForm === '2') return 'Сжиженный газ под давлением';
    if (transportForm === '3') return 'Охлаждённый сжиженный газ (криогенная жидкость)';
    if (transportForm === '4') return 'Газ, растворённый под давлением';
    if (transportForm === '5') return 'Аэрозоль';
    if (transportForm === '7') return 'Адсорбированный газ под давлением';
    if (transportForm === '8') return 'Химический продукт под давлением';
    return 'Газ под давлением; точная форма перевозки определяется транспортным наименованием и тарой';
  }
  if (/РАСПЛАВЛЕНН/iu.test(name)) return 'Расплав (жидкое состояние при перевозке)';
  if (/РАСТВОР/iu.test(name)) return 'Раствор (жидкость)';
  if (good.className === '3') return 'Жидкость';
  if (/^4(?:\.|$)/u.test(good.className)) return 'Твёрдое вещество или материал';
  return undefined;
}

function derivedPrimaryLabel(good: DangerousGood): HazardLabelData | undefined {
  const className = good.className.trim();
  if (className === '2') {
    const code = good.classificationCode.toUpperCase();
    return { code: code.includes('T') ? '2.3' : code.includes('F') ? '2.1' : '2.2', primary: true };
  }
  const supported = ['1', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '8', '9'];
  return supported.includes(className) ? { code: className, primary: true } : undefined;
}

function HazardSigns({ good }: Readonly<{ good: DangerousGood }>) {
  const fallback = derivedPrimaryLabel(good);
  const labels = good.hazardLabels.length > 0 ? good.hazardLabels : fallback === undefined ? [] : [fallback];
  if (labels.length === 0) return <p className="hazard-labels-missing">Класс опасности<br/>{good.className || 'уточняется по документам'}</p>;
  return <div className="hazard-signs" aria-label="Знаки опасности">{labels.map((label) => <HazardLabel label={label} key={`${label.code}-${label.primary ? 'primary' : 'subsidiary'}`}/>)}</div>;
}

function transportFireSummary(good: DangerousGood | null): string {
  if (good === null) return '';
  if (good.className === '2' && good.classificationCode.includes('F')) return 'Воспламеняющийся газ. Пожароопасные свойства подтверждены транспортным классом 2.1.';
  if (good.className === '3') return 'Легковоспламеняющаяся жидкость. Пожароопасные свойства подтверждены транспортным классом 3.';
  if (/^4(?:\.|$)/u.test(good.className)) return `Пожароопасный груз класса ${good.className}. Условия тушения уточняют по паспорту безопасности конкретного продукта.`;
  if (good.className === '5.1') return 'Окисляющее вещество: может усиливать горение других материалов.';
  return 'Отдельная характеристика горючести по транспортному классу не установлена.';
}

function transportChemicalHazardSummary(good: DangerousGood | null): string {
  if (good === null) return '';
  if (transportPhysicalState(good)?.includes('криогенная')) return 'Контакт с охлаждённой жидкостью или холодными парами может вызвать тяжёлое холодовое поражение и обморожение. Химическая нейтрализация не применяется.';
  if (good.className === '2' && good.classificationCode.includes('T')) return 'Токсичный газ. Опасен при вдыхании.';
  if (good.className === '6.1') return 'Токсичное вещество. Пути воздействия уточняют по паспорту безопасности конкретного продукта.';
  if (good.className === '8') return 'Коррозионное вещество. Опасно при контакте с кожей и глазами.';
  if (good.className === '5.1') return 'Окисляющее вещество. Опасно при контакте с горючими и восстановительными материалами.';
  if (good.className === '4.3') return 'При соприкосновении с водой выделяет воспламеняющиеся газы.';
  return `Опасность определяется транспортным классом ${good.className || 'не указан'} и паспортом безопасности конкретного продукта.`;
}

type Props = Readonly<{ initialQuery?: string }>;

export function DangerousGoodsPanel({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [database, setDatabase] = useState<readonly DangerousGood[]>([]);
  const [workplacePdkDatabase, setWorkplacePdkDatabase] = useState<WorkplacePdkDatabase | null>(null);
  const [cardRepository, setCardRepository] = useState<EmergencyCardRepository | null>(null);
  const [selected, setSelected] = useState<DangerousGood | null>(null);
  const [status, setStatus] = useState<Status>('manual');
  const [preview, setPreview] = useState<string | null>(null);
  const [recognizedPlacards, setRecognizedPlacards] = useState<readonly RecognizedPlacard[]>([{ id: 0, hazard: '', un: '' }]);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionStage, setRecognitionStage] = useState('');
  const [recognitionProgress, setRecognitionProgress] = useState(0);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cardLoadStarted = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const emergencySheetRef = useRef<HTMLElement>(null);
  const recognitionRunRef = useRef(0);
  const manualRecognitionEditRef = useRef<boolean>(false);

  useEffect(() => { const controller = new AbortController();
    void Promise.all([
      fetch(new URL('data/dangerous-goods.tsv', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); }),
      fetch(new URL('data/adr-2025-hazard-labels.json', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<HazardLabelDatabase>; }),
      fetch(new URL('data/workplace-pdk-sanpin-1.2.3685-21.json', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<WorkplacePdkDatabase>; }),
    ]).then(([text, labels, pdkDatabase]) => { setDatabase(parseDatabase(text, labels)); setWorkplacePdkDatabase(pdkDatabase); }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'неизвестная ошибка'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (cardRepository !== null || cardLoadStarted.current) return;
    cardLoadStarted.current = true;
    void loadEmergencyRepository().then(setCardRepository).catch((error: unknown) => {
      cardLoadStarted.current = false;
      setLoadError(error instanceof Error ? error.message : 'неизвестная ошибка');
    });
  }, [cardRepository]);
  useEffect(() => {
    if (initialQuery === '') { setSelected(null); return; }
    setQuery(initialQuery);
    const exact = database.find((item) => item.un === initialQuery);
    setSelected(exact ?? null);
    if (exact !== undefined) setStatus('manual');
  }, [database, initialQuery]);
  useEffect(() => () => { if (preview !== null) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    // Warm the completely local OCR worker while the user is choosing a photo.
    // No network request is involved: worker, WASM and trained data are bundled.
    const timer = window.setTimeout(() => { void loadOcrWorker().catch(() => undefined); }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  const matches = useMemo(() => {
    const search = normalized(query.trim());
    if (search.length === 0) return [];
    const score = (item: DangerousGood): number => {
      const un = normalized(item.un);
      const hazard = normalized(item.hazardNumber);
      const description = normalized(item.description);
      const aliases = normalized(SEARCH_ALIASES_BY_UN[item.un] ?? '');
      const formula = normalized(item.formula);
      if (un === search || formula === search || description === search || aliases === search) return 100;
      if (hazard === search) return 90;
      if (description.startsWith(search) || aliases.startsWith(search)) return 70;
      if (description.includes(search) || aliases.includes(search)) return 50;
      if (un.includes(search) || hazard.includes(search) || formula.includes(search)) return 40;
      return 0;
    };
    return database.map((item, index) => ({ item, index, score: score(item) })).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 30).map((entry) => entry.item);
  }, [database, query]);
  const emergencyLookup = useMemo(() => selected === null || cardRepository === null ? undefined : getEmergencyCardByUN(cardRepository, selected.un, selected.description, selected.classificationCode), [cardRepository, selected]);
  const cardRepositoryLoading = selected !== null && cardRepository === null && loadError === null;
  const officialCard = emergencyLookup?.card;
  const substanceProfile = emergencyLookup?.profile;
  const validatedRecord = selected === null ? undefined : getPublishedSubstanceByUN(selected.un);
  useEffect(() => {
    if (selected === null || !window.matchMedia('(max-width: 720px)').matches) return;
    // The effect runs after React has mounted the result sheet, so the mobile
    // view always reveals the selected cargo instead of occasionally keeping
    // the empty state in view on slower devices.
    const frame = window.requestAnimationFrame(() => emergencySheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);
  const chooseGood = (good: DangerousGood, nextStatus: Status = 'manual') => {
    setSelected(good);
    setStatus(nextStatus);
  };
  const clearPhotoIdentification = () => {
    recognitionRunRef.current += 1;
    manualRecognitionEditRef.current = false;
    setPreview(null);
    setRecognizedPlacards([{ id: 0, hazard: '', un: '' }]);
    setRecognizing(false);
    setRecognitionStage('');
    setRecognitionProgress(0);
    setRecognitionError(null);
  };
  const chooseFromSearch = (good: DangerousGood) => {
    clearPhotoIdentification();
    chooseGood(good, 'manual');
  };
  const changeSearchQuery = (value: string) => {
    clearPhotoIdentification();
    setSelected(null);
    setStatus('manual');
    setQuery(value);
  };
  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0]; if (file === undefined) return;
    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    manualRecognitionEditRef.current = false;
    setPhotoSourceOpen(false);
    if (preview !== null) URL.revokeObjectURL(preview); const url = URL.createObjectURL(file); setQuery(''); setSelected(null); setPreview(url); setRecognizing(true); setRecognitionProgress(3); setRecognitionStage('Подготовка фотографии'); setRecognitionError(null); setRecognizedPlacards([{ id: 0, hazard: '', un: '' }]); setStatus('preliminary');
    let worker: Worker | undefined;
    try {
      const [{ PSM }, loadedWorker, candidates] = await Promise.all([import('tesseract.js'), loadOcrWorker(), prepareOcrCandidates(file)]);
      worker = loadedWorker;
      if (recognitionRunRef.current !== runId) return;
      const reads: OcrRead[] = [];
      for (const [index, candidate] of candidates.entries()) {
        if (recognitionRunRef.current !== runId) return;
        setRecognitionStage('Распознавание маркировки');
        setRecognitionProgress(Math.round(8 + ((index + 1) / Math.max(1, candidates.length)) * 72));
        await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: candidate.row === 'upper' || candidate.row === 'lower' ? PSM.SINGLE_LINE : candidate.row === 'fallback' ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK });
        const result = await worker.recognize(candidate.canvas);
        reads.push({ region: candidate.region, row: candidate.row, label: candidate.label, numbers: ocrNumbers(result.data.text), confidence: result.data.confidence });
        // Do not stop after two identical guesses: a frame edge can make two
        // threshold variants repeat the same wrong leading digit. Early exit
        // is allowed only after independent upper/lower variants agree.
        if (consensusPlacard(reads, database, true) !== undefined) break;
      }
      type PairEvidence = { good: DangerousGood; hazard: string; un: string; region: number; votes: number; sourceVotes: number; score: number };
      const evidence = new Map<string, PairEvidence>();
      for (const region of [...new Set(reads.map((read) => read.region))]) {
        const regionReads = reads.filter((read) => read.region === region);
        const hazardReads = regionReads.filter((read) => read.row === 'upper' || read.row === 'whole' || read.row === 'fallback');
        const unReads = regionReads.filter((read) => read.row === 'lower' || read.row === 'whole' || read.row === 'fallback');
        for (const hazardRead of hazardReads) for (const hazard of hazardRead.numbers.filter((value) => value.length === 2 || value.length === 3)) {
          for (const unRead of unReads) for (const un of unRead.numbers.filter((value) => value.length === 4)) {
            const good = database.find((item) => item.un === un && hazardDigits(item.hazardNumber) === hazard);
            if (good === undefined) continue;
            const key = `${region}:${hazard}:${un}`;
            const current = evidence.get(key) ?? { good, hazard: good.hazardNumber || hazard, un, region, votes: 0, sourceVotes: 0, score: 0 };
            current.votes += 1;
            // Keep raw-crop evidence as an additional vote. The final rank also
            // considers repeated contrast reads and the frame-removed variant,
            // because a plate border may otherwise become an extra leading 1.
            if (unRead.label.startsWith('исходная')) current.sourceVotes += 1;
            const contrastBonus = (hazardRead.label.startsWith('контрастная') ? .5 : 0) + (unRead.label.startsWith('контрастная') ? 1 : 0);
            const frameRemovalBonus = unRead.label.startsWith('нижняя строка без рамки') ? .8 : 0;
            current.score += Math.max(1, (hazardRead.confidence + unRead.confidence) / 50) + contrastBonus + frameRemovalBonus;
            evidence.set(key, current);
          }
        }
      }
      // На технических чертежах сплошная разделительная линия иногда делит
      // оранжевое поле на два независимых цветовых прямоугольника. Тогда OCR
      // правильно читает верхнюю и нижнюю строки, но они получают разные
      // номера областей. Связываем такие строки только если во всём снимке
      // получается ровно одна существующая в автономном справочнике пара.
      if (evidence.size === 0) {
        const crossRegionPairs = new Map<string, PairEvidence>();
        const upperReads = reads.filter((read) => read.row === 'upper' || read.row === 'whole');
        const lowerReads = reads.filter((read) => read.row === 'lower' || read.row === 'whole');
        for (const hazardRead of upperReads) for (const hazard of hazardRead.numbers.filter((value) => value.length === 2 || value.length === 3)) {
          for (const unRead of lowerReads) for (const un of unRead.numbers.filter((value) => value.length === 4)) {
            const good = database.find((item) => item.un === un && hazardDigits(item.hazardNumber) === hazard);
            if (good === undefined) continue;
            const key = `${hazard}:${un}`;
            const score = (hazardRead.confidence + unRead.confidence) / 50;
            const current = crossRegionPairs.get(key);
            const sourceVotes = unRead.label.startsWith('исходная') ? 1 : 0;
            if (current === undefined || sourceVotes > current.sourceVotes || (sourceVotes === current.sourceVotes && score > current.score)) crossRegionPairs.set(key, { good, hazard: good.hazardNumber || hazard, un, region: -100, votes: 2, sourceVotes, score });
          }
        }
        if (crossRegionPairs.size === 1) {
          const onlyPair = crossRegionPairs.values().next().value;
          if (onlyPair !== undefined) evidence.set(`-100:${onlyPair.hazard}:${onlyPair.un}`, onlyPair);
        }
      }
      // Полный снимок заметно медленнее подготовленных областей. Запускаем этот
      // резервный проход только тогда, когда быстрый поиск таблички ничего не дал.
      if (evidence.size === 0) {
        setRecognitionStage('Дополнительная проверка'); setRecognitionProgress(86);
        await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const spatialCandidate = await prepareOcrSpatialCandidate(file);
        const spatialResult = await worker.recognize(spatialCandidate, {}, { blocks: true, text: true });
        const words = (spatialResult.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({ value: word.text.replace(/\D/gu, ''), confidence: word.confidence, bbox: word.bbox }));
        let spatialRegion = 1000;
        for (const hazardWord of words.filter((word) => (word.value.length === 2 || word.value.length === 3) && word.confidence >= 25)) for (const unWord of words.filter((word) => word.value.length === 4 && word.confidence >= 25)) {
          const hazardX = (hazardWord.bbox.x0 + hazardWord.bbox.x1) / 2; const hazardY = (hazardWord.bbox.y0 + hazardWord.bbox.y1) / 2;
          const unX = (unWord.bbox.x0 + unWord.bbox.x1) / 2; const unY = (unWord.bbox.y0 + unWord.bbox.y1) / 2;
          const characterHeight = Math.max(hazardWord.bbox.y1 - hazardWord.bbox.y0, unWord.bbox.y1 - unWord.bbox.y0, 1);
          if (unY <= hazardY || unY - hazardY > characterHeight * 3.2 || Math.abs(unX - hazardX) > characterHeight * 2.4) continue;
          const good = database.find((item) => item.un === unWord.value && hazardDigits(item.hazardNumber) === hazardWord.value);
          if (good === undefined) continue;
          const region = spatialRegion++; const key = `${region}:${hazardWord.value}:${unWord.value}`;
          evidence.set(key, { good, hazard: good.hazardNumber || hazardWord.value, un: unWord.value, region, votes: 2, sourceVotes: 1, score: (hazardWord.confidence + unWord.confidence) / 25 });
        }
      }
      const visualConsensus = consensusPlacard(reads, database, false);
      const recognized = visualConsensus === undefined ? [...new Set([...reads.map((read) => read.region), ...[...evidence.values()].map((item) => item.region)])].flatMap((region) => {
        // A repeated reading from the two contrast variants is stronger than
        // one raw-crop guess. The old order promoted the raw artefact 1120
        // above two independent reads of the visible 1202/1203 row.
        const ranked = [...evidence.values()].filter((item) => item.region === region).sort((left, right) => right.score - left.score || right.votes - left.votes || right.sourceVotes - left.sourceVotes);
        const best = ranked[0];
        if (best === undefined || (best.sourceVotes < 1 && best.votes < 2 && best.score < 2.4)) return [];
        return [{ id: region, hazard: hazardDigits(best.hazard), un: best.un }];
      }).filter((placard, index, all) => all.findIndex((item) => item.hazard === placard.hazard && item.un === placard.un) === index) : [visualConsensus];
      if (recognized.length > 0) {
        // The workflow confirms exactly one dangerous cargo. Showing several
        // competing plates created contradictory selected substances.
        if (!currentFlag(manualRecognitionEditRef)) setRecognizedPlacards(recognized.slice(0, 1));
        setRecognitionProgress(100);
      } else {
        if (!currentFlag(manualRecognitionEditRef)) {
          setRecognizedPlacards([{ id: 0, hazard: '', un: '' }]);
          setRecognitionError('Маркировка не распознана с достаточной достоверностью. Программа уже увеличила найденные области автоматически. Сделайте более прямой снимок либо введите оба номера вручную. Случайные варианты программа не подставляет.');
        }
      }
    } catch (error: unknown) {
      await worker?.terminate().catch(() => undefined);
      ocrWorkerPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      setRecognitionError(`Не удалось обработать фотографию автономно: ${detail || 'ошибка модуля распознавания'}.`);
    } finally {
      if (recognitionRunRef.current === runId) {
        setRecognizing(false);
        setRecognitionStage('');
        setRecognitionProgress(0);
      }
      input.value = '';
    }
  };
  const updatePlacard = (id: number, field: 'hazard' | 'un', value: string) => { manualRecognitionEditRef.current = true; setRecognizedPlacards((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item)); setSelected(null); setQuery(''); setStatus('preliminary'); setRecognitionError(null); };
  const dismissPlacard = (id: number) => { manualRecognitionEditRef.current = true; setRecognizedPlacards((items) => items.map((item) => item.id === id ? { ...item, hazard: '', un: '' } : item)); setRecognitionError(null); };
  const confirmRecognition = (placard: RecognizedPlacard) => { const good = database.find((item) => item.un === placard.un && hazardDigits(item.hazardNumber) === placard.hazard); if (good !== undefined) { recognitionRunRef.current += 1; setRecognizing(false); setRecognitionStage(''); setRecognitionProgress(0); chooseGood(good, 'confirmed'); setQuery(''); } else setRecognitionError('Такая пара номера опасности и номера ООН отсутствует в автономном справочнике ADR. Проверьте обе строки таблички.'); };
  const propertyItems = validatedRecord?.emergency.mainProperties.value ?? substanceProfile?.mainProperties ?? sentences(officialCard?.mainProperties ?? '');
  const fireItems = validatedRecord?.emergency.fireExplosionHazards.value ?? substanceProfile?.fireExplosionHazard ?? sentences(officialCard?.fireExplosionHazard ?? '');
  const healthItemsBase = validatedRecord?.emergency.healthHazards.value ?? substanceProfile?.humanHazard ?? sentences([officialCard?.humanHazard.description, officialCard?.humanHazard.symptoms].filter(Boolean).join(' '));
  const cryogenicHealthWarning = transportPhysicalState(selected)?.includes('криогенная') && !healthItemsBase.some((item) => /холод|обморож/iu.test(item))
    ? 'Контакт с охлаждённой жидкостью или холодными парами может вызвать тяжёлое холодовое поражение и обморожение.'
    : undefined;
  const healthItems = cryogenicHealthWarning === undefined ? healthItemsBase : [...healthItemsBase, cryogenicHealthWarning];
  const declaredFormula = validatedRecord?.chemical.formula.value ?? selected?.formula ?? '';
  const mixture = /смесь|н\.\s*у\.\s*к\./iu.test(selected?.description ?? '');
  const physicalState = transportPhysicalState(selected) ?? validatedRecord?.productForm.physicalForm.value ?? propertyItems[0]
    ?? (selected?.className === '2' ? 'Газ под давлением' : selected?.className === '3' ? 'Жидкость' : /^4(?:\.|$)/u.test(selected?.className ?? '') ? 'Твёрдое вещество' : 'Уточняется по паспорту безопасности конкретного продукта');
  const pdkSentence = [...propertyItems, ...(substanceProfile?.ppe ?? []), ...sentences(officialCard?.ppe.respiratory ?? '')].find((item) => /ПДК\s*(?:[=:—-]\s*)?\d+(?:[.,]\d+)?\s*(?:мг|г)\s*\/\s*м/iu.test(item));
  // A group emergency card may contain water restrictions that apply only to
  // one of its many UN entries (card 801 is a representative example). Such a
  // sentence must never be promoted to an individual substance fact. Only an
  // explicitly verified catalog entry or the transport class 4.3 can define
  // water compatibility here.
  const waterWarning = selected?.className === '4.3'
    ? 'Применение воды непосредственно к веществу опасно: при контакте выделяются воспламеняющиеся газы.'
    : undefined;
  const derivedWaterCompatibility: WaterCompatibility = waterWarning === undefined ? 'not-stated'
    : /не применять воду|реагирует с водой|водой разлагается/iu.test(waterWarning) ? 'prohibited'
      : /не направлять|не допускать/iu.test(waterWarning) ? 'restricted' : 'not-stated';
  const derivedWaterLabel = derivedWaterCompatibility === 'prohibited' ? 'Применение воды опасно'
    : derivedWaterCompatibility === 'restricted' ? 'Ограниченно совместимо'
      : 'Сведения не приведены';
  const operationalFacts = selected === null ? undefined : OPERATIONAL_FACTS_CATALOG[selected.un];
  const pdkResolution = selected === null || workplacePdkDatabase === null ? undefined : resolveWorkplacePdk(workplacePdkDatabase.rows, selected.description, declaredFormula);
  const formula = displayFormula(declaredFormula.length > 0 ? declaredFormula : (pdkResolution?.row.formula ?? ''));
  const pdkValue = operationalFacts?.workplacePdk.value
    ?? pdkResolution?.displayValue
    ?? (pdkSentence === undefined ? workplacePdkUnavailableText(selected?.description ?? '') : cleanEmergencyText(pdkSentence));
  const pdkSourceUrl = operationalFacts?.workplacePdk.sourceUrl ?? workplacePdkDatabase?.consolidatedSourceUrl;
  const pdkSource = operationalFacts?.workplacePdk.source ?? (pdkResolution === undefined
    ? workplacePdkDatabase === null ? undefined : `Проверено по ${workplacePdkDatabase.regulation}, таблица 2.1`
    : `${workplacePdkDatabase?.regulation}, строка ${pdkResolution.row.rowNumber}`);
  const conciseChemicalHazard = healthItems
    .filter((item) => !/(?:мг|г)\s*\/\s*кг|летальн\w*\s+доз|LD\s*50|LC\s*50/iu.test(item))
    .slice(0, 2)
    .join(' ');
  const fireSummary = cleanEmergencyText(fireItems.slice(0, 2).join(' ')) || transportFireSummary(selected);
  const chemicalHazardSummary = transportPhysicalState(selected)?.includes('криогенная')
    ? transportChemicalHazardSummary(selected)
    : cleanEmergencyText(conciseChemicalHazard) || transportChemicalHazardSummary(selected);
  const factsSection = selected === null ? null : <section className="substance-facts" aria-label="Основная информация о веществе">
    <h2>Важно: основные характеристики вещества</h2>
    <dl>
      <div className="substance-fact-card fact-formula"><img className="fact-icon" src="./assets/operational-facts/chemical-formula.png" alt="" /><dt>Химическая формула</dt><dd><strong className="fact-value fact-value-primary">{formula || (mixture ? 'Индивидуальная формула неприменима: смесь веществ' : 'Для транспортной позиции не установлена')}</strong></dd></div>
      <div className="substance-fact-card fact-state"><img className="fact-icon" src="./assets/operational-facts/aggregate-state.png" alt="" /><dt>Агрегатное состояние</dt><dd><strong className="fact-value fact-value-primary">{cleanEmergencyText(physicalState)}</strong></dd></div>
      <div className="substance-fact-card fact-pdk"><img className="fact-icon" src="./assets/operational-facts/workplace-pdk.png" alt="" /><dt>ПДК в воздухе рабочей зоны</dt><dd><strong className="fact-value fact-value-primary">{pdkValue}</strong>{pdkSourceUrl !== undefined && pdkSource !== undefined && <a className="fact-source" href={pdkSourceUrl} target="_blank" rel="noreferrer">{pdkSource}</a>}</dd></div>
      <div className={`substance-fact-card fact-water water-${operationalFacts?.water.compatibility ?? derivedWaterCompatibility}`}><img className="fact-icon" src="./assets/operational-facts/water-compatibility.png" alt="" /><dt>Совместимость с водой</dt><dd>{operationalFacts !== undefined ? <><strong className="water-status">{operationalFacts.water.label}</strong><strong className="fact-value">{operationalFacts.water.description}</strong><a className="fact-source" href={operationalFacts.water.sourceUrl} target="_blank" rel="noreferrer">Источник: {operationalFacts.water.source}</a></> : <><strong className="water-status">{derivedWaterLabel}</strong><strong className="fact-value">{cleanEmergencyText(waterWarning) || 'Условия применения воды определяют по паспорту безопасности конкретного продукта и обстановке на месте аварии.'}</strong></>}</dd></div>
      <div className="substance-fact-card fact-fire"><img className="fact-icon" src="./assets/operational-facts/combustibility.png" alt="" /><dt>Горючесть</dt><dd><strong className="fact-value">{fireSummary}</strong></dd></div>
      <div className="substance-fact-card fact-chemical"><img className="fact-icon" src="./assets/operational-facts/chemical-hazard.png" alt="" /><dt>Химическая опасность</dt><dd><strong className="fact-value">{chemicalHazardSummary}</strong></dd></div>
    </dl>
  </section>;

  return <main className="goods-page emergency-workspace">
    <aside className="goods-sidebar panel">
      <h2 className="goods-unified-title">Идентификация опасного груза</h2>
      <section className="goods-search-pane"><label className="goods-search-box"><input value={query} onChange={(event) => changeSearchQuery(event.currentTarget.value)} placeholder="Название, формула, UN или № опасности"/><button onClick={() => { const first = matches[0]; if (first !== undefined) chooseFromSearch(first); }}>Найти</button></label><small>Например: хлор, Cl₂, 1017 или 265. Новый поиск очищает результат распознавания фотографии.</small>{query.trim() !== '' && <><h2>Результаты поиска <b>({matches.length})</b></h2><div className="goods-search-results">{matches.map((good, index) => <button className={selected?.un === good.un && selected.description === good.description ? 'active' : ''} key={`${good.un}-${index}`} onClick={() => chooseFromSearch(good)}><strong>{good.description}{good.formula && ` (${good.formula})`}</strong><span>UN {good.un} · класс {good.className || '—'} · № опасности {good.hazardNumber || '—'}</span><b>›</b></button>)}</div></>}</section>
        <section className="photo-identification unified-photo-identification">
          <h2>Или распознайте табличку по фотографии</h2>
          <button type="button" className="photo-click-target" onClick={() => setPhotoSourceOpen(true)}>
            {preview === null ? <span className="photo-placeholder"><b>Нажмите сюда</b><span>Сделать снимок или выбрать фотографию</span></span> : <><img className="photo-preview" src={preview} alt="Исходная фотография маркировки"/><span className="photo-change-hint">Нажмите, чтобы заменить фотографию</span></>}
          </button>
          <input ref={cameraInputRef} className="photo-source-input" type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event)}/>
          <input ref={galleryInputRef} className="photo-source-input" type="file" accept="image/*" onChange={(event) => void selectPhoto(event)}/>
          {photoSourceOpen && <div className="photo-source-backdrop" role="presentation" onClick={() => setPhotoSourceOpen(false)}>
            <div className="photo-source-menu" role="dialog" aria-modal="true" aria-label="Выберите источник фотографии" onClick={(event) => event.stopPropagation()}>
              <h3>Добавить фотографию</h3>
              <p>Выберите, откуда получить снимок таблички опасного груза.</p>
              <button type="button" onClick={() => cameraInputRef.current?.click()}>📷 Включить камеру</button>
              <button type="button" onClick={() => galleryInputRef.current?.click()}>🖼 Выбрать из галереи</button>
              <button type="button" className="photo-source-cancel" onClick={() => setPhotoSourceOpen(false)}>Отмена</button>
            </div>
          </div>}
          <h2>Распознанная табличка</h2>
          {recognizing && <div className="recognition-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={recognitionProgress}><div><i style={{ width: `${recognitionProgress}%` }}/></div><span>{recognitionStage || 'Распознавание маркировки'} · {recognitionProgress}%</span></div>}
          {recognitionError !== null && <p className="recognition-error" role="alert">{recognitionError}</p>}
          <div className="recognized-placards">
            {recognizedPlacards.map((placard, index) => <article className="recognized-placard" key={placard.id}>
              <div className="adr-placard" aria-label={`Табличка опасного груза ${index + 1}`}>
                <input aria-label={`Номер опасности таблички ${index + 1}`} value={placard.hazard} inputMode="numeric" placeholder="Кемлер" onChange={(event) => updatePlacard(placard.id, 'hazard', event.currentTarget.value.replace(/\D/gu, '').slice(0, 3))}/>
                <input aria-label={`Номер ООН таблички ${index + 1}`} value={placard.un} inputMode="numeric" placeholder="UN" onChange={(event) => updatePlacard(placard.id, 'un', event.currentTarget.value.replace(/\D/gu, '').slice(0, 4))}/>
              </div>
              <div><strong>Опасный груз</strong><span>Верхняя строка — номер опасности<br/>Нижняя строка — номер ООН</span><div className="placard-actions"><button className="confirm-recognition" disabled={placard.hazard.length < 2 || placard.un.length !== 4} onClick={() => confirmRecognition(placard)}>Подтвердить</button><button className="dismiss-placard" onClick={() => dismissPlacard(placard.id)}>Очистить</button></div></div>
            </article>)}
          </div>
          <p className="recognition-warning">Проверьте табличку. При необходимости исправьте цифры непосредственно на ней и подтвердите груз.</p>
        </section>
    </aside>
    <section ref={emergencySheetRef} className="emergency-sheet panel">
      {loadError !== null && <p className="result-error">Локальная база не загружена: {loadError}</p>}
      {selected === null ? <div className="emergency-empty"><h2>Выберите опасный груз</h2><p>Найдите его по названию, номеру ООН, химической формуле или номеру опасности.</p></div> : <>
        <header className={`identification-status ${status}`}><strong>{status === 'manual' ? '✓ Выбрано из автономного справочника' : status === 'confirmed' ? '✓ Маркировка подтверждена пользователем' : '● Предварительно распознано'}</strong><span>{new Date().toLocaleString('ru-RU')}</span></header>
        <div className="emergency-sheet-scroll">
          <section className="goods-hero"><div className="goods-formula-large">UN</div><div><h1>{substanceProfile?.name ?? selected.description}</h1>{substanceProfile !== undefined && substanceProfile.aliases.length > 0 && <small className="goods-alias">Также: {substanceProfile.aliases.join('; ')}</small>}<strong>UN {selected.un}</strong><p>Класс: <b>{selected.className === '2' && selected.classificationCode.includes('T') ? '2.3' : selected.className || '—'}</b> <span>Классификационный код: <b>{selected.classificationCode || '—'}</b></span></p><p>№ опасности (Кемлера): <b>{selected.hazardNumber || '—'}</b> <span>Группа упаковки: <b>{selected.packingGroup || '—'}</b></span></p></div><HazardSigns good={selected}/><aside><span>{officialCard === undefined && !cardRepositoryLoading ? 'Основные сведения' : 'Аварийная карточка'}</span><strong>{cardRepositoryLoading ? 'Загрузка…' : officialCard === undefined ? `UN ${selected.un}` : `№ ${officialCard.cardNumber}`}</strong><small>{cardRepositoryLoading ? 'Российская нормативная база' : officialCard === undefined ? 'Автономный паспорт вещества' : `Редакция: ${officialCard.source.revision}`}</small></aside></section>
          {factsSection}
          {cardRepositoryLoading ? <section className="emergency-card-loading" aria-live="polite"><span/><p>Загружается российская аварийная карточка…</p></section> : officialCard === undefined ? null : <>
            <section className="official-card-document" aria-label={`Проверенные сведения для UN ${selected.un}`}>
              <header><div><span>Проверенные сведения о веществе</span><h2>UN {selected.un} — {substanceProfile?.name ?? selected.description}</h2></div><strong>Российская аварийная карточка № {officialCard.cardNumber}</strong></header>
              <div className="official-card-text">
                <h3>Основные свойства и виды опасности</h3>
                <DocumentParagraph label="Основные свойства." value={propertyItems.join(' ')}/>
                <DocumentParagraph label="Пожаро- и взрывоопасность." value={fireItems.join(' ')}/>
                <DocumentParagraph label="Опасность для человека." value={healthItems.join(' ')}/>
                <h3>Средства индивидуальной защиты</h3>
                <DocumentParagraph label="СИЗ." value={(validatedRecord?.emergency.ppe.value ?? substanceProfile?.ppe ?? [officialCard.ppe.respiratory, officialCard.ppe.skin, officialCard.ppe.eyes, officialCard.ppe.other]).filter(Boolean).join(' ')}/>
                <h3>Необходимые действия</h3>
                <DocumentParagraph label="Действия." value={(validatedRecord?.emergency.emergencyActions.value ?? substanceProfile?.specificActions ?? [officialCard.actions.general, officialCard.actions.leakOrSpill, officialCard.actions.fire]).filter(Boolean).join(' ')}/>
                <h3>Локализация последствий и первая помощь</h3>
                <DocumentParagraph label="Локализация." value={(validatedRecord?.emergency.consequenceControl.value?.actions ?? substanceProfile?.responseActions ?? [officialCard.neutralization]).filter(Boolean).join(' ')}/>
                <DocumentParagraph label="Первая помощь." value={(validatedRecord?.emergency.firstAid.value ?? substanceProfile?.firstAid ?? [officialCard.firstAid]).filter(Boolean).join(' ')}/>
              </div>
            </section>
            {validatedRecord !== undefined && <section className="transport-data-block"><h2>Транспортные данные</h2><div><p><b>Автомобиль — ДОПОГ 2025:</b> UN {validatedRecord.transport.unNumber.value}; класс {validatedRecord.transport.hazardClass.value}; код {validatedRecord.transport.classificationCode.value}; знаки {validatedRecord.transport.hazardLabels.value?.join(', ')}.</p><p><b>Железная дорога:</b> аварийная карточка № {validatedRecord.transportInstructions.rail.value?.emergencyCardNumber}.</p></div></section>}
            <section className="emergency-additional"><div className="source-mark">▤</div><div><h2>Источники данных</h2><p><b>Сопоставление:</b> UN {selected.un} → АК № {officialCard.cardNumber}</p><small>{officialCard.source.document}<br/><b>Редакция базы: {officialCard.source.revision}</b> · действует с {new Date(`${officialCard.source.effectiveDate}T00:00:00`).toLocaleDateString('ru-RU')}</small><div className="profile-sources">{validatedRecord !== undefined ? validatedRecord.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.title} · {source.edition}</a>) : substanceProfile?.sources.filter((source) => source.type !== 'emergency-card').map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.title} · {source.edition}</a>)}</div></div><div className="source-links"><a className="normative-source-link" href={officialCard.source.sourceUrl} target="_blank" rel="noreferrer">Открыть официальный документ ↗</a>{officialCard.source.amendmentUrl && <a className="normative-source-link secondary" href={officialCard.source.amendmentUrl} target="_blank" rel="noreferrer">Открыть изменение ↗</a>}</div></section>
          </>}
        </div>
      </>}
    </section>
  </main>;
}
