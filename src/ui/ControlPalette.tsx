import { UiIcon } from './UiIcon';
import { BuildingIcon } from './BuildingIcon';
import type { ReactNode } from 'react';

export type ControlKind = 'administrative' | 'industrial' | 'residential';
export type ControlTemplate = Readonly<{ kind: ControlKind; name: string }>;

const TEMPLATES: readonly Omit<ControlTemplate, 'people'>[] = [
  { kind: 'administrative', name: 'Административное здание' },
  { kind: 'industrial', name: 'Производственное здание' },
  { kind: 'residential', name: 'Жилое здание' }
];

export function ControlPalette({ children, onAdd }: Readonly<{ children?: ReactNode; onAdd?: (template: ControlTemplate) => void }>) {
  return <section className="panel control-palette">
    <h2 className="icon-heading"><UiIcon name="pin"/>Контрольные точки</h2>
    <p className="hint">Перетащите здание на карту или нажмите, чтобы добавить точку.</p>
    <div className="control-template-grid">{TEMPLATES.map((template) => <button key={template.kind} type="button" draggable onClick={() => onAdd?.(template)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-ahov-control', JSON.stringify(template)); }}><BuildingIcon kind={template.kind} compact/><strong>{template.name}</strong></button>)}</div>
    {children}
  </section>;
}
