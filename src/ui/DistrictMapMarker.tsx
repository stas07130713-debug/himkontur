import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { DistrictFireReservoir, DistrictHydrant, DistrictMapObject } from './district-map-model';
import { buildingPrefix, hydrantNetworkCode } from './district-map-model';

type Props = Readonly<{
  object: DistrictMapObject;
  x: number;
  y: number;
  selected: boolean;
  highlighted?: boolean;
  editing?: boolean;
  detailLevel?: 'compact' | 'full';
  scale?: number;
  onSelect: () => void;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  onHoverChange?: (hovered: boolean) => void;
  interactionDisabled?: boolean;
}>;

function HydrantSymbolContents({ object, detailLevel = 'full' }: Readonly<{ object: DistrictHydrant; detailLevel?: 'compact' | 'full' }>): ReactNode {
  const network = hydrantNetworkCode(object);
  const number = object.hydrantType === 'foam'
    ? object.number.replace(/^ПП?Г[-\s]*/iu, 'ППГ-')
    : object.number.replace(/^ППГ[-\s]*/iu, 'ПГ-');
  return <>
    <line className="hydrant-network-line" x1={detailLevel === 'full' ? -43 : -12} y1="0" x2={detailLevel === 'full' ? 43 : 12} y2="0" />
    {detailLevel === 'full' && <>
      <rect className="hydrant-label-back" x="-47" y="-16" width="36" height="14" rx="3" />
      <rect className="hydrant-label-back" x="11" y="-16" width="36" height="14" rx="3" />
      <text className="hydrant-map-label" x="-29" y="-6" textAnchor="middle">{number}</text>
      <text className="hydrant-map-label" x="29" y="-6" textAnchor="middle">{network}</text>
    </>}
    <circle className="hydrant-symbol-base" r="10" />
    <path className="hydrant-symbol-half" d="M0-10A10 10 0 0 1 0 10Z" />
    <circle className="hydrant-symbol-outline" r="10" />
  </>;
}

export function HydrantPlanSymbol({ object, className = '' }: Readonly<{ object: DistrictHydrant; className?: string }>) {
  return <svg className={`hydrant-plan-symbol type-${object.hydrantType} status-${object.status}${className === '' ? '' : ` ${className}`}`} viewBox="-42 -19 84 38" aria-label={`${object.hydrantType === 'foam' ? 'Пенный пожарный гидрант' : 'Пожарный гидрант'} ${object.number}, ${hydrantNetworkCode(object)}`}><HydrantSymbolContents object={object} /></svg>;
}

function ReservoirSymbolContents(): ReactNode {
  return <>
    <rect className="reservoir-symbol-square" x="-14" y="-14" width="28" height="28" rx="2" />
    <text className="reservoir-symbol-letters" x="0" y="5" textAnchor="middle">ПВ</text>
  </>;
}

export function FireReservoirPlanSymbol({ object, className = '' }: Readonly<{ object: DistrictFireReservoir; className?: string }>) {
  return <svg className={`reservoir-plan-symbol${className === '' ? '' : ` ${className}`}`} viewBox="-18 -18 36 36" aria-label={`Пожарный водоём ${object.number}`}><ReservoirSymbolContents /></svg>;
}

function namedLine(fullName: string, shortName: string): string {
  if (shortName.trim() === '') return fullName.trim();
  if (fullName.trim() === '') return shortName.trim();
  return `${shortName.trim()} — ${fullName.trim()}`;
}

export function DistrictMapMarker({ object, x, y, selected, highlighted = false, editing = false, detailLevel = 'full', scale = 1, onSelect, onPointerDown, onHoverChange, interactionDisabled = false }: Props) {
  const pointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (interactionDisabled) return;
    if (onPointerDown !== undefined) {
      onPointerDown(event);
      return;
    }
    // Selection is intentionally delayed until click. Opening the side card on
    // pointerdown changes the map width before pointerup and can retarget the
    // same gesture to the map background, making the card flash and disappear.
    event.stopPropagation();
  };
  if (object.kind === 'hydrant') {
    const hoverLines = [object.owner.trim(), `Сеть: ${hydrantNetworkCode(object)}`].filter(Boolean);
    return (
    <g data-object-id={object.id} transform={`translate(${x} ${y})`} className={`district-map-marker hydrant-marker type-${object.hydrantType} status-${object.status}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}${editing ? ' editable' : ''}${interactionDisabled ? ' interaction-disabled' : ''}`} onClick={(event) => { if (interactionDisabled) return; event.stopPropagation(); onSelect(); }} onPointerDown={pointerDown} onPointerEnter={() => { if (!interactionDisabled) onHoverChange?.(true); }} onPointerLeave={() => onHoverChange?.(false)}>
      <g transform={`scale(${scale})`}>
        <rect className="marker-hit-area" x={detailLevel === 'full' ? -42 : -18} y="-20" width={detailLevel === 'full' ? 84 : 36} height="40" rx="5" />
        <circle className="marker-halo" r="18" />
        <HydrantSymbolContents object={object} detailLevel={detailLevel} />
      </g>
      <foreignObject className="district-marker-hover-card" x="25" y={-18 - hoverLines.length * 9} width="245" height={42 + hoverLines.length * 19}>
        <div><strong>{object.hydrantType === 'foam' ? 'Пенный пожарный гидрант' : 'Пожарный гидрант'} {object.number}</strong>{hoverLines.map((line, index) => <span key={`${object.id}-hover-${index}`}>{line}</span>)}</div>
      </foreignObject>
    </g>
    );
  }
  if (object.kind === 'reservoir') {
    const hoverLines = [
      object.owner.trim(),
      object.volumeM3 === null ? '' : `Объём: ${object.volumeM3.toLocaleString('ru-RU')} м³`,
    ].filter(Boolean);
    return (
      <g data-object-id={object.id} transform={`translate(${x} ${y})`} className={`district-map-marker reservoir-marker status-${object.status}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}${editing ? ' editable' : ''}${interactionDisabled ? ' interaction-disabled' : ''}`} onClick={(event) => { if (interactionDisabled) return; event.stopPropagation(); onSelect(); }} onPointerDown={pointerDown} onPointerEnter={() => { if (!interactionDisabled) onHoverChange?.(true); }} onPointerLeave={() => onHoverChange?.(false)}>
        <g transform={`scale(${scale})`}>
          <rect className="marker-hit-area" x="-18" y="-18" width="36" height="36" rx="5" />
          <circle className="marker-halo" r="20" />
          <ReservoirSymbolContents />
        </g>
        <foreignObject className="district-marker-hover-card" x="25" y={-18 - hoverLines.length * 9} width="245" height={42 + hoverLines.length * 19}>
          <div><strong>Пожарный водоём {object.number}</strong>{hoverLines.map((line, index) => <span key={`${object.id}-hover-${index}`}>{line}</span>)}</div>
        </foreignObject>
      </g>
    );
  }
  const installation = object.objectType === 'installation';
  const hoverLines = [
    ...(object.objectType === 'territory'
      ? object.territoryNames.map((unit) => namedLine(unit.fullName, unit.shortName))
      : installation
        ? [object.installationName?.trim() ?? '', namedLine(object.workshopFull, object.workshopShort)]
        : [namedLine(object.workshopFull, object.workshopShort)]),
    ...(!installation ? object.departments.map((unit) => namedLine(unit.fullName, unit.shortName)) : []),
    ...(!installation ? object.sites.map((unit) => namedLine(unit.fullName, unit.shortName)) : []),
    !installation && (object.inventoryNumber ?? '').trim() !== '' ? `Инвентарный №: ${object.inventoryNumber}` : '',
    ...object.planningDocuments
      .filter((document) => document.number.trim() !== '')
      .map((document) => `${document.kind}: ${document.number}`),
  ].filter((line) => line !== '');
  const rescueService = object.mapRole === 'rescue-service';
  const currentRescueFullName = object.workshopFull.trim();
  const currentRescueShortName = object.workshopShort.trim();
  const legacyRescueFullName = object.territoryNames[0]?.fullName.trim() ?? '';
  const legacyRescueShortName = object.territoryNames[0]?.shortName.trim() ?? '';
  const rescueFullName = currentRescueFullName !== '' ? currentRescueFullName : legacyRescueFullName !== '' ? legacyRescueFullName : 'Аварийно-спасательная служба';
  const rescueShortName = currentRescueShortName !== '' ? currentRescueShortName : legacyRescueShortName !== '' ? legacyRescueShortName : 'АСС';
  const visibleHoverLines = rescueService
    ? [namedLine(rescueFullName, rescueShortName), ...hoverLines.filter((line) => !line.includes(rescueFullName))]
    : hoverLines;
  const markerLabel = rescueService ? 'АСС' : object.number;
  return (
    <g data-object-id={object.id} transform={`translate(${x} ${y})`} className={`district-map-marker building-number-marker prefix-${buildingPrefix(object.number)}${object.objectType === 'territory' ? ' territory' : ''}${installation ? ' installation' : ''}${rescueService ? ' rescue-service-marker' : ''}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}${editing ? ' editable' : ''}${interactionDisabled ? ' interaction-disabled' : ''}`} onClick={(event) => { if (interactionDisabled) return; event.stopPropagation(); onSelect(); }} onPointerDown={pointerDown} onPointerEnter={() => { if (!interactionDisabled) onHoverChange?.(true); }} onPointerLeave={() => onHoverChange?.(false)}>
      <g transform={`scale(${scale})`}><circle className="marker-halo" r="25" /><path d="M-21-13h42v26h-42z" /><text x="0" y="6" textAnchor="middle">{markerLabel}</text></g>
      <foreignObject className="district-marker-hover-card" x="25" y={-18 - visibleHoverLines.length * 9} width="245" height={42 + visibleHoverLines.length * 19}>
        <div><strong>{rescueService ? 'Аварийно-спасательная служба' : installation ? 'Наружная установка' : `${object.objectType === 'territory' ? 'Территория' : 'Здание'} ${object.number}`}</strong>{visibleHoverLines.map((line, index) => <span key={`${object.id}-hover-${index}`}>{line}</span>)}</div>
      </foreignObject>
    </g>
  );
}
