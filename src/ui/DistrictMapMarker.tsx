import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { DistrictHydrant, DistrictMapObject } from './district-map-model';
import { hydrantNetworkCode } from './district-map-model';

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
  return <>
    <line className="hydrant-network-line" x1={detailLevel === 'full' ? -35 : -12} y1="0" x2={detailLevel === 'full' ? 35 : 12} y2="0" />
    {detailLevel === 'full' && <>
      <rect className="hydrant-label-back" x="-39" y="-15" width="28" height="13" rx="3" />
      <rect className="hydrant-label-back" x="11" y="-15" width="28" height="13" rx="3" />
      <text className="hydrant-map-label" x="-25" y="-6" textAnchor="middle">{object.number}</text>
      <text className="hydrant-map-label" x="25" y="-6" textAnchor="middle">{network}</text>
    </>}
    <circle className="hydrant-symbol-base" r="10" />
    <path className="hydrant-symbol-half" d="M0-10A10 10 0 0 1 0 10Z" />
    <circle className="hydrant-symbol-outline" r="10" />
  </>;
}

export function HydrantPlanSymbol({ object, className = '' }: Readonly<{ object: DistrictHydrant; className?: string }>) {
  return <svg className={`hydrant-plan-symbol${className === '' ? '' : ` ${className}`}`} viewBox="-42 -19 84 38" aria-label={`Пожарный гидрант ${object.number}, ${hydrantNetworkCode(object)}`}><HydrantSymbolContents object={object} /></svg>;
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
    onSelect();
  };
  if (object.kind === 'hydrant') {
    const hoverLines = [object.owner.trim(), `Сеть: ${hydrantNetworkCode(object)}`].filter(Boolean);
    return (
    <g data-object-id={object.id} transform={`translate(${x} ${y})`} className={`district-map-marker hydrant-marker status-${object.status}${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}${editing ? ' editable' : ''}${interactionDisabled ? ' interaction-disabled' : ''}`} onClick={(event) => { if (interactionDisabled) return; event.stopPropagation(); onSelect(); }} onPointerDown={pointerDown} onPointerEnter={() => { if (!interactionDisabled) onHoverChange?.(true); }} onPointerLeave={() => onHoverChange?.(false)}>
      <g transform={`scale(${scale})`}>
        <rect className="marker-hit-area" x={detailLevel === 'full' ? -42 : -18} y="-20" width={detailLevel === 'full' ? 84 : 36} height="40" rx="5" />
        <circle className="marker-halo" r="18" />
        <HydrantSymbolContents object={object} detailLevel={detailLevel} />
      </g>
      <foreignObject className="district-marker-hover-card" x="25" y={-18 - hoverLines.length * 9} width="245" height={42 + hoverLines.length * 19}>
        <div><strong>Пожарный гидрант {object.number}</strong>{hoverLines.map((line, index) => <span key={`${object.id}-hover-${index}`}>{line}</span>)}</div>
      </foreignObject>
      <title>Пожарный гидрант {object.number}; {hydrantNetworkCode(object)}</title>
    </g>
    );
  }
  const hoverLines = [
    namedLine(object.workshopFull, object.workshopShort),
    ...object.departments.map((unit) => namedLine(unit.fullName, unit.shortName)),
    ...object.sites.map((unit) => namedLine(unit.fullName, unit.shortName)),
    (object.inventoryNumber ?? '').trim() === '' ? '' : `Инвентарный №: ${object.inventoryNumber}`,
    ...object.planningDocuments
      .filter((document) => document.number.trim() !== '')
      .map((document) => `${document.kind}: ${document.number}`),
  ].filter((line) => line !== '');
  return (
    <g data-object-id={object.id} transform={`translate(${x} ${y})`} className={`district-map-marker building-number-marker${selected ? ' selected' : ''}${highlighted ? ' search-highlight' : ''}${editing ? ' editable' : ''}${interactionDisabled ? ' interaction-disabled' : ''}`} onClick={(event) => { if (interactionDisabled) return; event.stopPropagation(); onSelect(); }} onPointerDown={pointerDown} onPointerEnter={() => { if (!interactionDisabled) onHoverChange?.(true); }} onPointerLeave={() => onHoverChange?.(false)}>
      <g transform={`scale(${scale})`}><circle className="marker-halo" r="25" /><path d="M-21-13h42v26h-42z" /><text x="0" y="6" textAnchor="middle">{object.number}</text></g>
      <foreignObject className="district-marker-hover-card" x="25" y={-18 - hoverLines.length * 9} width="245" height={42 + hoverLines.length * 19}>
        <div><strong>Здание {object.number}</strong>{hoverLines.map((line, index) => <span key={`${object.id}-hover-${index}`}>{line}</span>)}</div>
      </foreignObject>
      <title>{object.number} · {hoverLines.join(' · ')}</title>
    </g>
  );
}
