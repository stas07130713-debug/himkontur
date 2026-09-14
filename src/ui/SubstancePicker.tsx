import { useEffect, useRef, useState } from 'react';
import type { Substance } from '../core/types';
import { substanceFormula } from './substance-display';

type Props = Readonly<{ substances: readonly Substance[]; value: string; onChange: (id: string) => void }>;

export function SubstancePicker({ substances, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = substances.find((item) => item.id === value) ?? substances[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (selected === undefined) return null;
  return <div className="substance-picker" ref={rootRef}>
    <button type="button" className="substance-picker-button" role="combobox" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((valueOpen) => !valueOpen)}><span className="substance-formula-tile"><small>формула</small><b>{substanceFormula(selected.id)}</b></span><strong>{selected.name}</strong><i aria-hidden="true">⌄</i></button>
    {open && <div className="substance-options" role="listbox" aria-label="Вещество">{substances.map((item) => <button type="button" role="option" aria-selected={item.id === value} className={item.id === value ? 'selected' : ''} key={item.id} onClick={() => { onChange(item.id); setOpen(false); }}><span className="substance-formula-tile"><small>формула</small><b>{substanceFormula(item.id)}</b></span><strong>{item.name}</strong></button>)}</div>}
  </div>;
}
