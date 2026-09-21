import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getEmergencyCardByUN } from '../core/emergencyCards/emergencyCardLookup';
import { EmergencyCardRepository } from '../core/emergencyCards/emergencyCardRepository';
import { SUBSTANCES } from '../core/reference-data';
import { SUBSTANCE_PRESENTATION } from './substance-display';
import { prepareOcrCandidates } from './photo-ocr';
import { HazardLabel, type HazardLabelData } from './HazardLabel';
import { getPublishedSubstanceByUN } from '../core/substances/substanceDataPipeline';

type DangerousGood = Readonly<{ description: string; un: string; className: string; classificationCode: string; hazardNumber: string; packingGroup: string; transportCategory: string; formula: string; hazardLabels: readonly HazardLabelData[] }>;
type HazardLabelRow = Readonly<{ rowIndex: number; un: string; description: string; hazardLabels: readonly HazardLabelData[]; verificationStatus: 'verified-adr-2025' | 'not-matched-in-adr-2025' }>;
type HazardLabelDatabase = Readonly<{ rows: readonly HazardLabelRow[] }>;
type Status = 'manual' | 'preliminary' | 'confirmed';
type RecognizedPlacard = Readonly<{ id: number; hazard: string; un: string }>;

const FORMULA_BY_UN = Object.values(SUBSTANCE_PRESENTATION).reduce<Record<string, string>>((result, item) => { if (item.un.length > 0 && result[item.un] === undefined) result[item.un] = item.formula; return result; }, {});
const SEARCH_ALIASES_BY_UN = SUBSTANCES.reduce<Record<string, string>>((result, substance) => { const un = SUBSTANCE_PRESENTATION[substance.id]?.un; if (un !== undefined && un.length > 0) result[un] = `${result[un] ?? ''} ${substance.name}`; return result; }, {});
const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

function normalized(value: string): string { return value.toLocaleLowerCase('ru-RU').replace(/[₀-₉]/gu, (character) => SUBSCRIPT_DIGITS[character] ?? character).replace(/ё/gu, 'е').replace(/[^a-zа-я0-9]+/gu, ''); }
function parseDatabase(text: string, labelDatabase: HazardLabelDatabase): readonly DangerousGood[] {
  const parsed = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).flatMap((line, rowIndex) => {
    const columns = line.split('\t');
    const description = columns[0];
    const un = columns[1];
    if (description === undefined || un === undefined || !/^\d{4}$/u.test(un)) return [];
    const labels = labelDatabase.rows[rowIndex];
    const labelsMatch = labels?.rowIndex === rowIndex && labels.un === un && labels.description === description;
    if (!labelsMatch || labels.hazardLabels.length === 0) console.warn(`[HAZMAT LABEL WARNING] UN ${un} has no verified hazard labels.`);
    return [{
      description, un,
      className: columns[2] ?? '', classificationCode: columns[3] ?? '', hazardNumber: columns[4] ?? '',
      packingGroup: columns[5] ?? '', transportCategory: columns[6] ?? '', formula: FORMULA_BY_UN[un] ?? '',
      hazardLabels: labelsMatch && labels.verificationStatus === 'verified-adr-2025' ? labels.hazardLabels : [],
    }];
  });
  return parsed.filter((item, index, all) => all.findIndex((candidate) => candidate.un === item.un && candidate.description === item.description && candidate.classificationCode === item.classificationCode && candidate.hazardNumber === item.hazardNumber) === index);
}
function sentences(value = ''): readonly string[] { return value.split(/(?<=[.!?])\s+/u).map((item) => item.trim()).filter((item) => item.length > 2); }
function sourceText(value: string | null): string { const text = value?.trim(); return text === undefined || text.length === 0 ? 'Раздел не предусмотрен в опубликованной аварийной карточке.' : text; }
function SourceList({ value }: Readonly<{ value: string | null }>) { const items = sentences(value ?? ''); return items.length > 1 ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{sourceText(value)}</p>; }
function TextItems({ items, fallback }: Readonly<{ items: readonly string[] | undefined; fallback: string }>) { return items !== undefined && items.length > 0 ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="source-section-note">{fallback}</p>; }
function CardIcon({ name, alt }: Readonly<{ name: string; alt: string }>) { return <img className="emergency-card-icon" src={new URL(`assets/emergency-card-icons/${name}.png`, document.baseURI).href} alt={alt}/>; }
function ocrNumbers(text: string): readonly string[] { return [...new Set([...text.split(/\r?\n/u).map((line) => line.replace(/\D/gu, '')).filter((value) => /^\d{2,4}$/u.test(value)), ...(text.match(/\d{2,4}/gu) ?? [])])]; }
function hazardDigits(value: string): string { return value.replace(/\D/gu, ''); }

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

type Props = Readonly<{ initialQuery?: string }>;

export function DangerousGoodsPanel({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [database, setDatabase] = useState<readonly DangerousGood[]>([]);
  const [cardRepository, setCardRepository] = useState<EmergencyCardRepository | null>(null);
  const [selected, setSelected] = useState<DangerousGood | null>(null);
  const [status, setStatus] = useState<Status>('manual');
  const [preview, setPreview] = useState<string | null>(null);
  const [recognizedPlacards, setRecognizedPlacards] = useState<readonly RecognizedPlacard[]>([{ id: 0, hazard: '', un: '' }]);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionStage, setRecognitionStage] = useState('');
  const [recognitionProgress, setRecognitionProgress] = useState(0);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { const controller = new AbortController(); void Promise.all([
    Promise.all([
      fetch(new URL('data/dangerous-goods.tsv', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); }),
      fetch(new URL('data/adr-2025-hazard-labels.json', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<HazardLabelDatabase>; }),
    ]).then(([text, labels]) => parseDatabase(text, labels)),
    EmergencyCardRepository.load(controller.signal)
  ]).then(([goods, repository]) => { setDatabase(goods); setCardRepository(repository); }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'неизвестная ошибка'); }); return () => controller.abort(); }, []);
  useEffect(() => {
    if (initialQuery === '') { setSelected(null); return; }
    setQuery(initialQuery);
    const exact = database.find((item) => item.un === initialQuery);
    setSelected(exact ?? null);
    if (exact !== undefined) setStatus('manual');
  }, [database, initialQuery]);
  useEffect(() => () => { if (preview !== null) URL.revokeObjectURL(preview); }, [preview]);

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
  const officialCard = emergencyLookup?.card;
  const substanceProfile = emergencyLookup?.profile;
  const validatedRecord = selected === null ? undefined : getPublishedSubstanceByUN(selected.un);
  const groupCard = emergencyLookup?.cardType === 'group';
  const chooseGood = (good: DangerousGood, nextStatus: Status = 'manual') => { setSelected(good); setStatus(nextStatus); };
  const clearPhotoIdentification = () => {
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
    if (preview !== null) URL.revokeObjectURL(preview); const url = URL.createObjectURL(file); setQuery(''); setSelected(null); setPreview(url); setRecognizing(true); setRecognitionProgress(3); setRecognitionStage('Подготовка фотографии'); setRecognitionError(null); setRecognizedPlacards([]); setStatus('preliminary');
    let worker: Tesseract.Worker | undefined;
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      const base = new URL('.', document.baseURI);
      worker = await createWorker('eng', 1, { workerPath: new URL('ocr/worker.min.js', base).href, corePath: new URL('ocr/core', base).href, langPath: new URL('tessdata', base).href, gzip: false });
      const candidates = await prepareOcrCandidates(file);
      type OcrRead = Readonly<{ region: number; row: 'upper' | 'lower' | 'whole' | 'fallback'; label: string; numbers: readonly string[]; confidence: number }>;
      const reads: OcrRead[] = [];
      for (const [index, candidate] of candidates.entries()) {
        setRecognitionStage('Распознавание маркировки');
        setRecognitionProgress(Math.round(8 + ((index + 1) / Math.max(1, candidates.length)) * 72));
        await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: candidate.row === 'upper' || candidate.row === 'lower' ? PSM.SINGLE_WORD : candidate.row === 'fallback' ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK });
        const result = await worker.recognize(candidate.canvas);
        reads.push({ region: candidate.region, row: candidate.row, label: candidate.label, numbers: ocrNumbers(result.data.text), confidence: result.data.confidence });
      }
      type PairEvidence = { good: DangerousGood; hazard: string; un: string; region: number; votes: number; score: number };
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
            const current = evidence.get(key) ?? { good, hazard: good.hazardNumber || hazard, un, region, votes: 0, score: 0 };
            current.votes += 1;
            const contrastBonus = (hazardRead.label.startsWith('контрастная') ? .5 : 0) + (unRead.label.startsWith('контрастная') ? 1 : 0);
            current.score += Math.max(1, (hazardRead.confidence + unRead.confidence) / 50) + contrastBonus;
            evidence.set(key, current);
          }
        }
      }
      setRecognitionStage('Проверка результата'); setRecognitionProgress(86);
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const spatialResult = await worker.recognize(file, {}, { blocks: true, text: true });
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
        evidence.set(key, { good, hazard: good.hazardNumber || hazardWord.value, un: unWord.value, region, votes: 2, score: (hazardWord.confidence + unWord.confidence) / 25 });
      }
      const recognized = [...new Set([...reads.map((read) => read.region), ...[...evidence.values()].map((item) => item.region)])].flatMap((region) => {
        const ranked = [...evidence.values()].filter((item) => item.region === region).sort((left, right) => right.votes - left.votes || right.score - left.score);
        const best = ranked[0];
        if (best === undefined || (best.votes < 2 && best.score < 2.4)) return [];
        return [{ id: region, hazard: hazardDigits(best.hazard), un: best.un }];
      }).filter((placard, index, all) => all.findIndex((item) => item.hazard === placard.hazard && item.un === placard.un) === index);
      if (recognized.length > 0) {
        // The workflow confirms exactly one dangerous cargo. Showing several
        // competing plates created contradictory selected substances.
        const primaryPlacard = recognized[0];
        if (primaryPlacard !== undefined) setRecognizedPlacards([primaryPlacard]);
        setRecognitionProgress(100);
      } else {
        setRecognizedPlacards([{ id: 0, hazard: '', un: '' }]);
        setRecognitionError('Маркировка не распознана с достаточной достоверностью. Программа уже увеличила найденные области автоматически. Сделайте более прямой снимок либо введите оба номера вручную. Случайные варианты программа не подставляет.');
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setRecognitionError(`Не удалось обработать фотографию автономно: ${detail || 'ошибка модуля распознавания'}.`);
    } finally {
      await worker?.terminate().catch(() => undefined);
      setRecognizing(false);
      setRecognitionStage('');
      setRecognitionProgress(0);
      input.value = '';
    }
  };
  const updatePlacard = (id: number, field: 'hazard' | 'un', value: string) => { setRecognizedPlacards((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item)); setSelected(null); setQuery(''); setStatus('preliminary'); setRecognitionError(null); };
  const dismissPlacard = (id: number) => setRecognizedPlacards((items) => items.filter((item) => item.id !== id));
  const confirmRecognition = (placard: RecognizedPlacard) => { const good = database.find((item) => item.un === placard.un && hazardDigits(item.hazardNumber) === placard.hazard); if (good !== undefined) { chooseGood(good, 'confirmed'); setQuery(''); } else setRecognitionError('Такая пара номера опасности и номера ООН отсутствует в автономном справочнике ADR. Проверьте обе строки таблички.'); };
  // Independently verified substance data has priority. Until such a profile
  // is available, the assigned official railway emergency card supplies the
  // operational sections instead of leaving warning placeholders.
  const officialCardAvailable = officialCard !== undefined;
  const pilotEmergency = validatedRecord?.emergency;
  const critical = pilotEmergency?.healthHazards.value?.slice(0, 3) ?? substanceProfile?.critical ?? (officialCardAvailable ? [...sentences(officialCard.humanHazard.description ?? '').slice(0, 1), ...sentences(officialCard.actions.general ?? '').slice(0, 3)] : []);
  const exposureRoutes = pilotEmergency?.exposureRoutes.value ?? substanceProfile?.exposureRoutes ?? (officialCardAvailable ? [officialCard.humanHazard.exposureRoutes.inhalation && 'при вдыхании', officialCard.humanHazard.exposureRoutes.ingestion && 'при проглатывании', officialCard.humanHazard.exposureRoutes.skin && 'при попадании на кожу', officialCard.humanHazard.exposureRoutes.eyes && 'при попадании в глаза'].filter((item): item is string => item !== false) : []);
  const unavailableSpecificText = `Применяются общие требования назначенной аварийной карточки № ${officialCard?.cardNumber ?? '—'}; отдельная формулировка для этого раздела в источнике не выделена.`;

  return <main className="goods-page emergency-workspace">
    <aside className="goods-sidebar panel">
      <h2 className="goods-unified-title">Идентификация опасного груза</h2>
      <section className="goods-search-pane"><label className="goods-search-box"><input value={query} onChange={(event) => changeSearchQuery(event.currentTarget.value)} placeholder="Название, формула, UN или № опасности"/><button onClick={() => { const first = matches[0]; if (first !== undefined) chooseFromSearch(first); }}>Найти</button></label><small>Например: хлор, Cl₂, 1017 или 265. Новый поиск очищает результат распознавания фотографии.</small>{query.trim() !== '' && <><h2>Результаты поиска <b>({matches.length})</b></h2><div className="goods-search-results">{matches.map((good, index) => <button className={selected?.un === good.un && selected.description === good.description ? 'active' : ''} key={`${good.un}-${index}`} onClick={() => chooseFromSearch(good)}><strong>{good.description}{good.formula && ` (${good.formula})`}</strong><span>UN {good.un} · класс {good.className || '—'} · № опасности {good.hazardNumber || '—'}</span><b>›</b></button>)}</div></>}</section>
        <section className="photo-identification unified-photo-identification">
          <h2>Или распознайте табличку по фотографии</h2>
          <label className="photo-click-target">
            {preview === null ? <div className="photo-placeholder"><b>Нажмите сюда</b><span>Сделать снимок или выбрать фотографию</span></div> : <><img className="photo-preview" src={preview} alt="Исходная фотография маркировки"/><span className="photo-change-hint">Нажмите, чтобы заменить фотографию</span></>}
            <input type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event)}/>
          </label>
          <h2>Распознанная табличка</h2>
          {recognizing && <div className="recognition-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={recognitionProgress}><div><i style={{ width: `${recognitionProgress}%` }}/></div><span>{recognitionStage || 'Распознавание маркировки'} · {recognitionProgress}%</span></div>}
          {recognitionError !== null && <p className="recognition-error" role="alert">{recognitionError}</p>}
          <div className="recognized-placards">
            {recognizedPlacards.map((placard, index) => <article className="recognized-placard" key={placard.id}>
              <div className="adr-placard" aria-label={`Табличка опасного груза ${index + 1}`}>
                <input aria-label={`Номер опасности таблички ${index + 1}`} value={placard.hazard} inputMode="numeric" placeholder="Кемлер" onChange={(event) => updatePlacard(placard.id, 'hazard', event.currentTarget.value.replace(/\D/gu, '').slice(0, 3))}/>
                <input aria-label={`Номер ООН таблички ${index + 1}`} value={placard.un} inputMode="numeric" placeholder="UN" onChange={(event) => updatePlacard(placard.id, 'un', event.currentTarget.value.replace(/\D/gu, '').slice(0, 4))}/>
              </div>
              <div><strong>Опасный груз</strong><span>Верхняя строка — номер опасности<br/>Нижняя строка — номер ООН</span><div className="placard-actions"><button className="confirm-recognition" disabled={recognizing || placard.hazard.length < 2 || placard.un.length !== 4} onClick={() => confirmRecognition(placard)}>Подтвердить</button><button className="dismiss-placard" onClick={() => dismissPlacard(placard.id)}>Очистить</button></div></div>
            </article>)}
          </div>
          <p className="recognition-warning">Проверьте табличку. При необходимости исправьте цифры непосредственно на ней и подтвердите груз.</p>
        </section>
    </aside>
    <section className="emergency-sheet panel">
      {loadError !== null && <p className="result-error">Локальная база не загружена: {loadError}</p>}
      {selected === null ? <div className="emergency-empty"><h2>Выберите опасный груз</h2><p>Найдите его по названию, номеру ООН, химической формуле или номеру опасности.</p></div> : <>
        <header className={`identification-status ${status}`}><strong>{status === 'manual' ? '✓ Выбрано из автономного справочника' : status === 'confirmed' ? '✓ Маркировка подтверждена пользователем' : '● Предварительно распознано'}</strong><span>{new Date().toLocaleString('ru-RU')}</span></header>
        <div className="emergency-sheet-scroll">
          <section className="goods-hero"><div className="goods-formula-large">UN</div><div><h1>{substanceProfile?.name ?? selected.description}</h1>{substanceProfile !== undefined && substanceProfile.aliases.length > 0 && <small className="goods-alias">Также: {substanceProfile.aliases.join('; ')}</small>}<strong>UN {selected.un}</strong><p>Класс: <b>{selected.className === '2' && selected.classificationCode.includes('T') ? '2.3' : selected.className || '—'}</b> <span>Классификационный код: <b>{selected.classificationCode || '—'}</b></span></p><p>№ опасности (Кемлера): <b>{selected.hazardNumber || '—'}</b> <span>Группа упаковки: <b>{selected.packingGroup || '—'}</b></span></p></div><HazardSigns good={selected}/><aside><span>Аварийная карточка</span><strong>№ {officialCard?.cardNumber ?? '—'}</strong>{groupCard && <em className="group-card-label" title={`Карточка № ${officialCard?.cardNumber ?? '—'} применяется к группе опасных грузов. Характеристики конкретного вещества отображаются отдельно.`}>Групповая аварийная карточка</em>}<small>{officialCard === undefined ? 'Не найдена в проверенной локальной базе' : `Редакция: ${officialCard.source.revision}`}</small></aside></section>
          {officialCard === undefined ? <section className="unverified-emergency-card"><h2>Для UN {selected.un} аварийная карточка не найдена в локальной нормативной базе редакции 01.01.2026</h2><p>Оперативные рекомендации не формируются и не подменяются сведениями похожего вещества. Проверьте груз по наименованию.</p></section> : <>
            {groupCard && <section className="official-card-scope"><strong>Официальная групповая АК № {officialCard.cardNumber}</strong><span>Карточка назначена грузу UN {selected.un}. Проверенные индивидуальные сведения имеют приоритет; остальные разделы заполнены общими требованиями этой АК.</span></section>}
            <section className="critical-actions"><h2>! Критически важно</h2>{critical.length > 0 ? <ul>{critical.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{unavailableSpecificText}</p>}</section>
            <div className="emergency-sections emergency-card-grid">
              <section className="card-properties"><header><CardIcon name="properties" alt="Лабораторная колба"/><b>01</b><h2>Основные свойства</h2></header><div><TextItems items={pilotEmergency?.mainProperties.value ?? substanceProfile?.mainProperties ?? sentences(officialCard.mainProperties ?? '')} fallback={unavailableSpecificText}/></div></section>
              <section className="card-fire"><header><CardIcon name="fire" alt="Пламя"/><b>02</b><h2>Пожаро- и взрывоопасность</h2></header><div><TextItems items={pilotEmergency?.fireExplosionHazards.value ?? substanceProfile?.fireExplosionHazard ?? sentences(officialCard.fireExplosionHazard ?? '')} fallback={unavailableSpecificText}/></div></section>
              <section className="card-human"><header><CardIcon name="human-hazard" alt="Опасность для человека"/><b>03</b><h2>Опасность для человека</h2></header><div>{substanceProfile?.hazardMarker && <strong className="specific-hazard-marker">{substanceProfile.hazardMarker}</strong>}<div className="human-hazard-columns"><div><h3>Опасен при:</h3>{exposureRoutes.length > 0 ? <ul className="exposure-routes">{exposureRoutes.map((route) => <li key={route}>☑ {route}</li>)}</ul> : <p>Пути воздействия приведены в описании опасности.</p>}</div><div><h3>Основные проявления:</h3><TextItems items={pilotEmergency?.healthHazards.value ?? substanceProfile?.humanHazard ?? sentences([officialCard.humanHazard.description, officialCard.humanHazard.symptoms].filter(Boolean).join(' '))} fallback={unavailableSpecificText}/></div></div></div></section>
              <section className="card-ppe"><header><CardIcon name="ppe" alt="Средства индивидуальной защиты"/><b>04</b><h2>Средства индивидуальной защиты</h2></header><div><TextItems items={pilotEmergency?.ppe.value ?? substanceProfile?.ppe ?? sentences([officialCard.ppe.respiratory, officialCard.ppe.skin, officialCard.ppe.eyes, officialCard.ppe.other].filter(Boolean).join(' '))} fallback={unavailableSpecificText}/>{substanceProfile?.ppeWarning && <p className="ppe-warning">{substanceProfile.ppeWarning}</p>}</div></section>
              <section className="card-actions"><header><CardIcon name="actions" alt="Необходимые действия"/><b>05</b><h2>Необходимые действия</h2></header><div>{pilotEmergency?.emergencyActions.value !== null && pilotEmergency?.emergencyActions.value !== undefined ? <TextItems items={pilotEmergency.emergencyActions.value} fallback={unavailableSpecificText}/> : <>{substanceProfile !== undefined && <><h3>Особенности для UN {selected.un}</h3><TextItems items={substanceProfile.specificActions} fallback={unavailableSpecificText}/></>}<h3>{groupCard ? `Общие требования групповой аварийной карточки № ${officialCard.cardNumber}` : `Требования аварийной карточки № ${officialCard.cardNumber}`}</h3><SourceList value={officialCard.actions.general}/><SourceList value={officialCard.actions.leakOrSpill}/><SourceList value={officialCard.actions.fire}/></>}</div></section>
              <div className="emergency-card-stack">
                <section className="card-neutralization"><header><CardIcon name="neutralization" alt="Локализация последствий"/><b>06</b><h2>Локализация и устранение последствий</h2></header><div><TextItems items={pilotEmergency?.consequenceControl.value?.actions ?? substanceProfile?.responseActions ?? sentences(officialCard.neutralization ?? officialCard.actions.leakOrSpill ?? '')} fallback={unavailableSpecificText}/></div></section>
                <section className="card-first-aid"><header><CardIcon name="first-aid" alt="Первая помощь"/><b>07</b><h2>Меры первой помощи</h2></header><div><TextItems items={pilotEmergency?.firstAid.value ?? substanceProfile?.firstAid ?? sentences(officialCard.firstAid ?? '')} fallback={unavailableSpecificText}/></div></section>
              </div>
            </div>
            {groupCard && <details className="official-group-card"><summary>Официальный текст групповой аварийной карточки № {officialCard.cardNumber}</summary><p>Карточка относится к группе из {emergencyLookup.cardUNNumbers.length} грузов. Её общие требования показаны в рабочих разделах; проверенные индивидуальные сведения для UN {selected.un} имеют приоритет.</p><h3>Основные свойства группы</h3><p>{sourceText(officialCard.mainProperties)}</p><h3>Пожаро- и взрывоопасность группы</h3><p>{sourceText(officialCard.fireExplosionHazard)}</p><h3>Опасность для человека</h3><p>{sourceText(officialCard.humanHazard.description)}</p><h3>СИЗ по карточке</h3><p>{sourceText(officialCard.ppe.respiratory)}</p><h3>Необходимые действия</h3><p>{sourceText(officialCard.actions.general)} {sourceText(officialCard.actions.leakOrSpill)} {sourceText(officialCard.actions.fire)}</p><h3>Нейтрализация</h3><p>{sourceText(officialCard.neutralization)}</p><h3>Первая помощь</h3><p>{sourceText(officialCard.firstAid)}</p></details>}
            {validatedRecord !== undefined && <section className="transport-data-block"><h2>Транспортные данные</h2><div><p><b>Автомобиль — ДОПОГ 2025:</b> UN {validatedRecord.transport.unNumber.value}; класс {validatedRecord.transport.hazardClass.value}; код {validatedRecord.transport.classificationCode.value}; знаки {validatedRecord.transport.hazardLabels.value?.join(', ')}.</p><p><b>Железная дорога:</b> групповая железнодорожная аварийная карточка № {validatedRecord.transportInstructions.rail.value?.emergencyCardNumber}. Её текст хранится отдельно и не используется как свойства вещества.</p></div></section>}
            <section className="emergency-additional"><div className="source-mark">▤</div><div><h2>Источники данных</h2><p><b>Сопоставление:</b> UN {selected.un} → АК № {officialCard.cardNumber}{groupCard ? ' (групповая; общие требования дополнены индивидуальными сведениями при их наличии)' : ''}</p><small>{officialCard.source.document}<br/><b>Редакция базы: {officialCard.source.revision}</b> · действует с {new Date(`${officialCard.source.effectiveDate}T00:00:00`).toLocaleDateString('ru-RU')}</small><div className="profile-sources">{validatedRecord !== undefined ? validatedRecord.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.title} · {source.edition}</a>) : substanceProfile?.sources.filter((source) => source.type !== 'emergency-card').map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.title} · {source.edition}</a>)}</div></div><div className="source-links"><a className="normative-source-link" href={officialCard.source.sourceUrl} target="_blank" rel="noreferrer">Открыть официальный документ ↗</a>{officialCard.source.amendmentUrl && <a className="normative-source-link secondary" href={officialCard.source.amendmentUrl} target="_blank" rel="noreferrer">Открыть изменение ↗</a>}</div></section>
          </>}
        </div>
      </>}
    </section>
  </main>;
}
