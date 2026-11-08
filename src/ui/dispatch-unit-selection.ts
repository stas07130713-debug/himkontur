export type DispatchUnitSelectionItem = Readonly<{
  id: string;
  kind: 'department' | 'site';
  parentDepartmentId?: string;
}>;

export function nextDispatchUnitSelection(
  current: ReadonlySet<string>,
  unit: DispatchUnitSelectionItem,
  units: readonly DispatchUnitSelectionItem[],
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(unit.id)) {
    next.delete(unit.id);
    if (unit.kind === 'department') {
      units.filter((candidate) => candidate.parentDepartmentId === unit.id).forEach((candidate) => next.delete(candidate.id));
    }
  } else {
    next.add(unit.id);
    if (unit.kind === 'site' && unit.parentDepartmentId !== undefined) next.add(unit.parentDepartmentId);
  }
  return next;
}
