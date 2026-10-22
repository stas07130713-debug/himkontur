import { useEffect, useMemo, useRef, useState } from 'react';
import type { DistrictMapObject } from './district-map-model';
import { districtObjectSearchText } from './district-map-model';
import { objectResultText } from './district-object-search';
import { UiIcon } from './UiIcon';

type Props = Readonly<{
  objects: readonly DistrictMapObject[];
  showBuildings: boolean;
  showHydrants: boolean;
  onShowBuildingsChange: (value: boolean) => void;
  onShowHydrantsChange: (value: boolean) => void;
  onFocus: (object: DistrictMapObject) => void;
  onSearchSelectionChange?: (object: DistrictMapObject | null) => void;
  compact?: boolean;
  resetSignal?: number;
}>;

export function DistrictObjectToolbar(props: Props) {
  const [buildingQuery, setBuildingQuery] = useState('');
  const [hydrantQuery, setHydrantQuery] = useState('');
  const [focusedKind, setFocusedKind] = useState<'building' | 'nppv' | null>(null);
  const buildingInputRef = useRef<HTMLInputElement>(null);
  const hydrantInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.resetSignal === undefined) return;
    setBuildingQuery('');
    setHydrantQuery('');
    setFocusedKind(null);
  }, [props.resetSignal]);
  const buildingResults = useMemo(() => {
    const needle = buildingQuery.trim().toLocaleLowerCase('ru-RU');
    if (needle === '') return [];
    return props.objects
      .filter((object) => object.kind === 'building' && districtObjectSearchText(object).includes(needle))
      .slice(0, 20);
  }, [buildingQuery, props.objects]);
  const hydrantResults = useMemo(() => {
    const needle = hydrantQuery.trim().toLocaleLowerCase('ru-RU');
    if (needle === '') return [];
    return props.objects
      .filter((object) => object.kind !== 'building' && districtObjectSearchText(object).includes(needle))
      .slice(0, 20);
  }, [hydrantQuery, props.objects]);

  const searchRow = (
    kind: 'building' | 'nppv',
    query: string,
    setQuery: (value: string) => void,
    results: readonly DistrictMapObject[],
    visible: boolean,
    onVisibleChange: (value: boolean) => void,
  ) => {
    const isBuilding = kind === 'building';
    const showResults = focusedKind === kind && query.trim() !== '';
    return (
      <div className={`district-object-search-row ${kind}`}>
        <div className="district-search">
          <span aria-hidden="true"><UiIcon name="search" /></span>
          <input
            ref={kind === 'building' ? buildingInputRef : hydrantInputRef}
            value={query}
            onFocus={() => setFocusedKind(kind)}
            onBlur={() => window.setTimeout(() => setFocusedKind((current) => current === kind ? null : current), 150)}
            onChange={(event) => { setFocusedKind(kind); setQuery(event.currentTarget.value); props.onSearchSelectionChange?.(null); }}
            placeholder={isBuilding ? 'Найти здание' : 'Найти элемент НППВ'}
            aria-label={isBuilding ? 'Поиск здания на карте' : 'Поиск элемента наружного противопожарного водоснабжения на карте'}
          />
          {query !== '' && <button aria-label="Очистить поиск" onMouseDown={(event) => event.preventDefault()} onClick={() => {
            setQuery('');
            setFocusedKind(kind);
            props.onSearchSelectionChange?.(null);
            window.requestAnimationFrame(() => (kind === 'building' ? buildingInputRef.current : hydrantInputRef.current)?.focus());
          }}><UiIcon name="close" /></button>}
        </div>
        <label className="district-layer-toggle">
          <input type="checkbox" checked={visible} onChange={(event) => onVisibleChange(event.currentTarget.checked)} />
          {isBuilding ? 'Нумерация зданий' : 'НППВ'}
        </label>
        {showResults && (
          <div className="district-search-results">
            {results.length === 0 ? <p>Совпадений не найдено</p> : results.map((object) => {
              const resultText = objectResultText(object, query);
              return (
                <button key={object.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { props.onFocus(object); props.onSearchSelectionChange?.(object); setQuery(object.kind === 'building' && object.mapRole === 'rescue-service' ? 'АСС' : object.number); setFocusedKind(null); }}>
                  <b>{object.kind === 'building' && object.mapRole === 'rescue-service' ? 'АСС' : object.number}</b>
                  <span><strong>{resultText.title}</strong>{resultText.description !== '' && <small>{resultText.description}</small>}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`district-object-toolbar${props.compact === true ? ' compact' : ''}`}>
      {searchRow('building', buildingQuery, setBuildingQuery, buildingResults, props.showBuildings, props.onShowBuildingsChange)}
      {searchRow('nppv', hydrantQuery, setHydrantQuery, hydrantResults, props.showHydrants, props.onShowHydrantsChange)}
    </div>
  );
}
