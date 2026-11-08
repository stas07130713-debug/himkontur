import { describe, expect, it } from 'vitest';
import { nextDispatchUnitSelection, type DispatchUnitSelectionItem } from './dispatch-unit-selection';

const department: DispatchUnitSelectionItem = { id: 'department-1', kind: 'department' };
const site: DispatchUnitSelectionItem = { id: 'site-1', kind: 'site', parentDepartmentId: department.id };
const independentSite: DispatchUnitSelectionItem = { id: 'site-2', kind: 'site' };
const units = [department, site, independentSite];

describe('dispatch unit selection', () => {
  it('starts empty and selects a parent department with its site', () => {
    expect([...nextDispatchUnitSelection(new Set(), site, units)]).toEqual(['site-1', 'department-1']);
  });

  it('removes child sites when their department is deselected', () => {
    expect([...nextDispatchUnitSelection(new Set(['department-1', 'site-1']), department, units)]).toEqual([]);
  });

  it('allows a site without a hierarchy to be selected independently', () => {
    expect([...nextDispatchUnitSelection(new Set(), independentSite, units)]).toEqual(['site-2']);
  });
});
