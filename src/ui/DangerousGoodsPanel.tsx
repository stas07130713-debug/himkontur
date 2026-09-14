import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getEmergencyCardByUN } from '../core/emergencyCards/emergencyCardLookup';
import { EmergencyCardRepository } from '../core/emergencyCards/emergencyCardRepository';
import { SUBSTANCES } from '../core/reference-data';
import { SUBSTANCE_PRESENTATION } from './substance-display';
import { prepareOcrCandidates } from './photo-ocr';
import { HazardLabel, type HazardLabelData } from './HazardLabel';

type DangerousGood = Readonly<{ description: string; un: string; className: string; classificationCode: string; hazardNumber: string; packingGroup: string; transportCategory: string; formula: string; hazardLabels: readonly HazardLabelData[] }>;
type HazardLabelRow = Readonly<{ rowIndex: number; un: string; description: string; hazardLabels: readonly HazardLabelData[]; verificationStatus: 'verified-adr-2025' | 'not-matched-in-adr-2025' }>;
type HazardLabelDatabase = Readonly<{ rows: readonly HazardLabelRow[] }>;
type Mode = 'search' | 'photo';
type Status = 'manual' | 'preliminary' | 'confirmed';
type RecognizedPlacard = Readonly<{ id: number; hazard: string; un: string }>;

const FORMULA_BY_UN = Object.values(SUBSTANCE_PRESENTATION).reduce<Record<string, string>>((result, item) => { if (item.un.length > 0 && result[item.un] === undefined) result[item.un] = item.formula; return result; }, {});
const SEARCH_ALIASES_BY_UN = SUBSTANCES.reduce<Record<string, string>>((result, substance) => { const un = SUBSTANCE_PRESENTATION[substance.id]?.un; if (un !== undefined && un.length > 0) result[un] = `${result[un] ?? ''} ${substance.name}`; return result; }, {});
const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

function normalized(value: string): string { return value.toLocaleLowerCase('ru-RU').replace(/[₀-₉]/gu, (character) => SUBSCRIPT_DIGITS[character] ?? character).replace(/ё/gu, 'е').replace(/[^a-zа-я0-9]+/gu, ''); }
function parseDatabase(text: string, labelDatabase: HazardLabelDatabase): readonly DangerousGood[] {
  return text.replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).flatMap((line, rowIndex) => {
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
}
function sentences(value = ''): readonly string[] { return value.split(/(?<=[.!?])\s+/u).map((item) => item.trim()).filter((item) => item.length > 2); }
function sourceText(value: string | null): string { const text = value?.trim(); return text === undefined || text.length === 0 ? 'Раздел не предусмотрен в опубликованной аварийной карточке.' : text; }
function SourceList({ value }: Readonly<{ value: string | null }>) { const items = sentences(value ?? ''); return items.length > 1 ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{sourceText(value)}</p>; }
function TextItems({ items, fallback }: Readonly<{ items: readonly string[] | undefined; fallback: string }>) { return items !== undefined && items.length > 0 ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="specific-data-missing">{fallback}</p>; }
function CardIcon({ name, alt }: Readonly<{ name: string; alt: string }>) { return <img className="emergency-card-icon" src={new URL(`assets/emergency-card-icons/${name}.png`, document.baseURI).href} alt={alt}/>; }
function ocrNumbers(text: string): readonly string[] { return [...new Set([...text.split(/\r?\n/u).map((line) => line.replace(/\D/gu, '')).filter((value) => /^\d{2,4}$/u.test(value)), ...(text.match(/\d{2,4}/gu) ?? [])])]; }
function hazardDigits(value: string): string { return value.replace(/\D/gu, ''); }

function HazardSigns({ good }: Readonly<{ good: DangerousGood }>) {
  if (good.hazardLabels.length === 0) return <p className="hazard-labels-missing">Знаки опасности<br/>не заполнены</p>;
  return <div className="hazard-signs" aria-label="Знаки опасности">{good.hazardLabels.map((label) => <HazardLabel label={label} key={`${label.code}-${label.primary ? 'primary' : 'subsidiary'}`}/>)}</div>;
}

type Props = Readonly<{ initialQuery?: string; onCalculateSubstance?: (un: string) => void }>;

export function DangerousGoodsPanel({ initialQuery = '1017', onCalculateSubstance }: Props) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState(initialQuery);
  const [database, setDatabase] = useState<readonly DangerousGood[]>([]);
  const [cardRepository, setCardRepository] = useState<EmergencyCardRepository | null>(null);
  const [selected, setSelected] = useState<DangerousGood | null>(null);
  const [status, setStatus] = useState<Status>('manual');
  const [preview, setPreview] = useState<string | null>(null);
  const [recognizedPlacards, setRecognizedPlacards] = useState<readonly RecognizedPlacard[]>([{ id: 0, hazard: '', un: '' }]);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionStage, setRecognitionStage] = useState('');
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { const controller = new AbortController(); void Promise.all([
    Promise.all([
      fetch(new URL('data/dangerous-goods.tsv', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); }),
      fetch(new URL('data/adr-2025-hazard-labels.json', document.baseURI), { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<HazardLabelDatabase>; }),
    ]).then(([text, labels]) => parseDatabase(text, labels)),
    EmergencyCardRepository.load(controller.signal)
  ]).then(([goods, repository]) => { setDatabase(goods); setCardRepository(repository); const exact = goods.find((item) => item.un === initialQuery); if (exact !== undefined) setSelected(exact); }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'неизвестная ошибка'); }); return () => controller.abort(); }, [initialQuery]);
  useEffect(() => { setQuery(initialQuery); const exact = database.find((item) => item.un === initialQuery); if (exact !== undefined) { setSelected(exact); setStatus('manual'); } }, [database, initialQuery]);
  useEffect(() => () => { if (preview !== null) URL.revokeObjectURL(preview); }, [preview]);

  const matches = useMemo(() => { const search = normalized(query.trim()); if (search.length === 0) return []; return database.filter((item) => normalized(item.un).includes(search) || normalized(item.hazardNumber).includes(search) || normalized(item.description).includes(search) || normalized(SEARCH_ALIASES_BY_UN[item.un] ?? '').includes(search) || (item.formula.length > 0 && normalized(item.formula).includes(search))).slice(0, 30); }, [database, query]);
  const emergencyLookup = useMemo(() => selected === null || cardRepository === null ? undefined : getEmergencyCardByUN(cardRepository, selected.un, selected.description, selected.classificationCode), [cardRepository, selected]);
  const officialCard = emergencyLookup?.card;
  const substanceProfile = emergencyLookup?.profile;
  const groupCard = emergencyLookup?.cardType === 'group';
  const supportedSubstance = selected !== null && Object.values(SUBSTANCE_PRESENTATION).some((item) => item.un === selected.un);

  const chooseGood = (good: DangerousGood, nextStatus: Status = 'manual') => { setSelected(good); setStatus(nextStatus); };
  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0]; if (file === undefined) return;
    if (preview !== null) URL.revokeObjectURL(preview); const url = URL.createObjectURL(file); setPreview(url); setRecognizing(true); setRecognitionStage('Поиск и автоматическое увеличение оранжевых табличек…'); setRecognitionError(null); setRecognizedPlacards([]); setStatus('preliminary');
    let worker: Tesseract.Worker | undefined;
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      const base = new URL('.', document.baseURI);
      worker = await createWorker('eng', 1, { workerPath: new URL('ocr/worker.min.js', base).href, corePath: new URL('ocr/core', base).href, langPath: new URL('tessdata', base).href, gzip: false });
      const candidates = await prepareOcrCandidates(file);
      type OcrRead = Readonly<{ region: number; row: 'upper' | 'lower' | 'whole' | 'fallback'; label: string; numbers: readonly string[]; confidence: number }>;
      const reads: OcrRead[] = [];
      for (const [index, candidate] of candidates.entries()) {
        setRecognitionStage(`Распознавание таблички: вариант ${index + 1} из ${candidates.length}…`);
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
      setRecognitionStage('Проверка расположения всех найденных табличек…');
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
        setRecognizedPlacards(recognized);
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
      input.value = '';
    }
  };
  const updatePlacard = (id: number, field: 'hazard' | 'un', value: string) => { setRecognizedPlacards((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item)); setStatus('preliminary'); setRecognitionError(null); };
  const addPlacard = () => setRecognizedPlacards((items) => [...items, { id: Math.max(0, ...items.map((item) => item.id)) + 1, hazard: '', un: '' }]);
  const dismissPlacard = (id: number) => setRecognizedPlacards((items) => items.filter((item) => item.id !== id));
  const confirmRecognition = (placard: RecognizedPlacard) => { const good = database.find((item) => item.un === placard.un && hazardDigits(item.hazardNumber) === placard.hazard); if (good !== undefined) { chooseGood(good, 'confirmed'); setQuery(good.un); } else setRecognitionError('Такая пара номера опасности и номера ООН отсутствует в автономном справочнике ADR. Проверьте обе строки таблички.'); };
  // A group emergency card may contain conditional sentences about several
  // different substances. It must never be presented as a substance profile.
  const officialSpecificAllowed = officialCard !== undefined && !groupCard;
  const critical = substanceProfile?.critical ?? (officialSpecificAllowed ? [...sentences(officialCard.humanHazard.description ?? '').slice(0, 1), ...sentences(officialCard.actions.general ?? '').slice(0, 3)] : []);
  const exposureRoutes = substanceProfile?.exposureRoutes ?? (officialSpecificAllowed ? [officialCard.humanHazard.exposureRoutes.inhalation && 'при вдыхании', officialCard.humanHazard.exposureRoutes.ingestion && 'при проглатывании', officialCard.humanHazard.exposureRoutes.skin && 'при попадании на кожу', officialCard.humanHazard.exposureRoutes.eyes && 'при попадании в глаза'].filter((item): item is string => item !== false) : []);
  const unavailableSpecificText = groupCard
    ? `Индивидуальные сведения для UN ${selected?.un ?? '—'} ещё не прошли предметную проверку. Текст групповой карточки № ${officialCard?.cardNumber ?? '—'} сюда не подставляется.`
    : `Сведения в этом разделе отсутствуют в официальной аварийной карточке № ${officialCard?.cardNumber ?? '—'}.`;

  return <main className="goods-page emergency-workspace">
    <aside className="goods-sidebar panel">
      <div className="goods-mode-tabs"><button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>▣ Поиск по названию / номеру</button><button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>▧ Распознавание с фото</button></div>
      {mode === 'search' ? <section className="goods-search-pane"><label className="goods-search-box"><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Название, UN или номер опасности"/><button onClick={() => { const first = matches[0]; if (first !== undefined) chooseGood(first); }}>Найти</button></label><small>Например: хлор, 1017, UN 1017 или 265.</small><h2>Результаты поиска <b>({matches.length})</b></h2><div className="goods-search-results">{matches.map((good, index) => <button className={selected?.un === good.un && selected.description === good.description ? 'active' : ''} key={`${good.un}-${index}`} onClick={() => chooseGood(good)}><strong>{good.description}{good.formula && ` (${good.formula})`}</strong><span>UN {good.un} · класс {good.className || '—'} · № опасности {good.hazardNumber || '—'}</span><b>›</b></button>)}</div></section> :
        <section className="photo-identification">
          <div className="photo-actions"><label>Выбрать файл<input type="file" accept="image/*" onChange={(event) => void selectPhoto(event)}/></label><label>Сделать фото<input type="file" accept="image/*" capture="environment" onChange={(event) => void selectPhoto(event)}/></label></div>
          {preview === null ? <div className="photo-placeholder">Фотография маркировки</div> : <img className="photo-preview" src={preview} alt="Исходная фотография маркировки"/>}
          <h2>Распознанные таблички {recognizedPlacards.length > 1 && <b>({recognizedPlacards.length})</b>}</h2>
          {recognizing && <p className="recognition-progress">{recognitionStage || 'Распознавание маркировки…'}</p>}
          {recognitionError !== null && <p className="recognition-error" role="alert">{recognitionError}</p>}
          <div className="recognized-placards">
            {recognizedPlacards.map((placard, index) => <article className="recognized-placard" key={placard.id}>
              <div className="adr-placard" aria-label={`Табличка опасного груза ${index + 1}`}>
                <input aria-label={`Номер опасности таблички ${index + 1}`} value={placard.hazard} inputMode="numeric" placeholder="Кемлер" onChange={(event) => updatePlacard(placard.id, 'hazard', event.currentTarget.value.replace(/\D/gu, '').slice(0, 3))}/>
                <input aria-label={`Номер ООН таблички ${index + 1}`} value={placard.un} inputMode="numeric" placeholder="UN" onChange={(event) => updatePlacard(placard.id, 'un', event.currentTarget.value.replace(/\D/gu, '').slice(0, 4))}/>
              </div>
              <div><strong>{recognizedPlacards.length > 1 ? `Табличка ${index + 1}` : 'Опасный груз'}</strong><span>Верхняя строка — номер опасности<br/>Нижняя строка — номер ООН</span><div className="placard-actions"><button className="confirm-recognition" disabled={recognizing || placard.hazard.length < 2 || placard.un.length !== 4} onClick={() => confirmRecognition(placard)}>Подтвердить</button><button className="dismiss-placard" onClick={() => dismissPlacard(placard.id)}>Не учитывать</button></div></div>
            </article>)}
          </div>
          <button className="add-placard" onClick={addPlacard}>＋ Добавить табличку вручную</button>
          <p className="recognition-warning">Проверьте правильность каждой таблички. При необходимости исправьте цифры непосредственно на ней и подтвердите нужный груз.</p>
        </section>}
    </aside>
    <section className="emergency-sheet panel">
      {loadError !== null && <p className="result-error">Локальная база не загружена: {loadError}</p>}
      {selected === null ? <div className="emergency-empty"><h2>Выберите опасный груз</h2><p>Найдите его по названию, номеру ООН, химической формуле или номеру опасности.</p></div> : <>
        <header className={`identification-status ${status}`}><strong>{status === 'manual' ? '✓ Выбрано из автономного справочника' : status === 'confirmed' ? '✓ Маркировка подтверждена пользователем' : '● Предварительно распознано'}</strong><span>{new Date().toLocaleString('ru-RU')}</span></header>
        <div className="emergency-sheet-scroll">
          <section className="goods-hero"><div className="goods-formula-large">UN</div><div><h1>{substanceProfile?.name ?? selected.description}</h1>{substanceProfile !== undefined && substanceProfile.aliases.length > 0 && <small className="goods-alias">Также: {substanceProfile.aliases.join('; ')}</small>}<strong>UN {selected.un}</strong><p>Класс: <b>{selected.className === '2' && selected.classificationCode.includes('T') ? '2.3' : selected.className || '—'}</b> <span>Классификационный код: <b>{selected.classificationCode || '—'}</b></span></p><p>№ опасности (Кемлера): <b>{selected.hazardNumber || '—'}</b> <span>Группа упаковки: <b>{selected.packingGroup || '—'}</b></span></p></div><HazardSigns good={selected}/><aside><span>Аварийная карточка</span><strong>№ {officialCard?.cardNumber ?? '—'}</strong>{groupCard && <em className="group-card-label" title={`Карточка № ${officialCard?.cardNumber ?? '—'} применяется к группе опасных грузов. Характеристики конкретного вещества отображаются отдельно.`}>Групповая аварийная карточка</em>}<small>{officialCard === undefined ? 'Не найдена в проверенной локальной базе' : `Редакция: ${officialCard.source.revision}`}</small></aside></section>
          {supportedSubstance && <button className="calculate-from-goods" onClick={() => onCalculateSubstance?.(selected.un)}>Рассчитать зону распространения →</button>}
          {officialCard === undefined ? <section className="unverified-emergency-card"><h2>Для UN {selected.un} аварийная карточка не найдена в локальной нормативной базе редакции 01.01.2026</h2><p>Оперативные рекомендации не формируются и не подменяются сведениями похожего вещества. Проверьте груз по наименованию.</p></section> : <>
            <section className="critical-actions"><h2>! Критически важно</h2>{critical.length > 0 ? <ul>{critical.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{unavailableSpecificText}</p>}</section>
            <div className="emergency-sections emergency-card-grid">
              <section className="card-properties"><header><CardIcon name="properties" alt="Лабораторная колба"/><b>01</b><h2>Основные свойства</h2></header><div><TextItems items={substanceProfile?.mainProperties ?? (officialSpecificAllowed ? sentences(officialCard.mainProperties ?? '') : undefined)} fallback={unavailableSpecificText}/></div></section>
              <section className="card-fire"><header><CardIcon name="fire" alt="Пламя"/><b>02</b><h2>Пожаро- и взрывоопасность</h2></header><div><TextItems items={substanceProfile?.fireExplosionHazard ?? (officialSpecificAllowed ? sentences(officialCard.fireExplosionHazard ?? '') : undefined)} fallback={unavailableSpecificText}/></div></section>
              <section className="card-human"><header><CardIcon name="human-hazard" alt="Опасность для человека"/><b>03</b><h2>Опасность для человека</h2></header><div>{substanceProfile?.hazardMarker && <strong className="specific-hazard-marker">{substanceProfile.hazardMarker}</strong>}<div className="human-hazard-columns"><div><h3>Опасен при:</h3>{exposureRoutes.length > 0 ? <ul className="exposure-routes">{exposureRoutes.map((route) => <li key={route}>☑ {route}</li>)}</ul> : <p>Пути воздействия приведены в описании опасности.</p>}</div><div><h3>Основные проявления:</h3><TextItems items={substanceProfile?.humanHazard ?? (officialSpecificAllowed ? sentences([officialCard.humanHazard.description, officialCard.humanHazard.symptoms].filter(Boolean).join(' ')) : undefined)} fallback={unavailableSpecificText}/></div></div></div></section>
              <section className="card-ppe"><header><CardIcon name="ppe" alt="Средства индивидуальной защиты"/><b>04</b><h2>Средства индивидуальной защиты</h2></header><div><TextItems items={substanceProfile?.ppe ?? (officialSpecificAllowed ? sentences([officialCard.ppe.respiratory, officialCard.ppe.skin, officialCard.ppe.eyes, officialCard.ppe.other].filter(Boolean).join(' ')) : undefined)} fallback={unavailableSpecificText}/>{substanceProfile?.ppeWarning && <p className="ppe-warning">{substanceProfile.ppeWarning}</p>}</div></section>
              <section className="card-actions"><header><CardIcon name="actions" alt="Необходимые действия"/><b>05</b><h2>Необходимые действия</h2></header><div>{substanceProfile !== undefined && <><h3>Особенности для UN {selected.un}</h3><TextItems items={substanceProfile.specificActions} fallback={unavailableSpecificText}/></>}<h3>{groupCard ? `Общие требования групповой аварийной карточки № ${officialCard.cardNumber}` : `Требования аварийной карточки № ${officialCard.cardNumber}`}</h3><SourceList value={officialCard.actions.general}/><SourceList value={officialCard.actions.leakOrSpill}/><SourceList value={officialCard.actions.fire}/></div></section>
              <div className="emergency-card-stack">
                <section className="card-neutralization"><header><CardIcon name="neutralization" alt="Нейтрализация"/><b>06</b><h2>{substanceProfile?.responseSectionTitle ?? 'Нейтрализация'}</h2></header><div><TextItems items={substanceProfile?.responseActions ?? (officialSpecificAllowed ? sentences(officialCard.neutralization ?? '') : undefined)} fallback={unavailableSpecificText}/></div></section>
                <section className="card-first-aid"><header><CardIcon name="first-aid" alt="Первая помощь"/><b>07</b><h2>Меры первой помощи</h2></header><div><TextItems items={substanceProfile?.firstAid ?? (officialSpecificAllowed ? sentences(officialCard.firstAid ?? '') : undefined)} fallback={unavailableSpecificText}/></div></section>
              </div>
            </div>
            {groupCard && <details className="official-group-card"><summary>Официальный текст групповой аварийной карточки № {officialCard.cardNumber}</summary><p>Этот текст относится ко всей группе из {emergencyLookup.cardUNNumbers.length} грузов и не используется как индивидуальные свойства UN {selected.un}.</p><h3>Основные свойства группы</h3><p>{sourceText(officialCard.mainProperties)}</p><h3>Пожаро- и взрывоопасность группы</h3><p>{sourceText(officialCard.fireExplosionHazard)}</p><h3>Опасность для человека</h3><p>{sourceText(officialCard.humanHazard.description)}</p><h3>СИЗ по карточке</h3><p>{sourceText(officialCard.ppe.respiratory)}</p><h3>Необходимые действия</h3><p>{sourceText(officialCard.actions.general)} {sourceText(officialCard.actions.leakOrSpill)} {sourceText(officialCard.actions.fire)}</p><h3>Нейтрализация</h3><p>{sourceText(officialCard.neutralization)}</p><h3>Первая помощь</h3><p>{sourceText(officialCard.firstAid)}</p></details>}
            <section className="emergency-additional"><div className="source-mark">▤</div><div><h2>Источники данных</h2><p><b>Сопоставление:</b> UN {selected.un} → АК № {officialCard.cardNumber}{groupCard ? ' (групповая)' : ''}</p><small>{officialCard.source.document}<br/><b>Редакция базы: {officialCard.source.revision}</b> · действует с {new Date(`${officialCard.source.effectiveDate}T00:00:00`).toLocaleDateString('ru-RU')}</small>{substanceProfile !== undefined && <div className="profile-sources">{substanceProfile.sources.filter((source) => source.type !== 'emergency-card').map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>{source.title} · {source.edition}</a>)}</div>}</div><div className="source-links"><a className="normative-source-link" href={officialCard.source.sourceUrl} target="_blank" rel="noreferrer">Открыть официальный документ ↗</a>{officialCard.source.amendmentUrl && <a className="normative-source-link secondary" href={officialCard.source.amendmentUrl} target="_blank" rel="noreferrer">Открыть изменение ↗</a>}</div></section>
          </>}
        </div>
      </>}
    </section>
  </main>;
}
