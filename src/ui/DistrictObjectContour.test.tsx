import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DistrictBuilding } from './district-map-model';
import { DistrictObjectContour } from './DistrictObjectContour';

const baseObject: DistrictBuilding = {
  id: 'boundary-test',
  kind: 'building',
  objectType: 'territory',
  number: '0.0',
  point: { latitude: 0, longitude: 0 },
  contour: [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }],
  territoryNames: [],
  inventoryNumber: '',
  planningDocuments: [],
  workshopFull: '',
  workshopShort: '',
  departments: [],
  sites: [],
  note: '',
  updatedAtIso: '2026-10-17T00:00:00.000Z',
};

const project = (point: Readonly<{ latitude: number; longitude: number }>) => ({ x: point.longitude * 10, y: point.latitude * 10 });

describe('DistrictObjectContour', () => {
  it('renders the response boundary as an open two-point polyline without a filled polygon', () => {
    const markup = renderToStaticMarkup(<svg><DistrictObjectContour object={{ ...baseObject, mapRole: 'response-boundary' }} project={project} /></svg>);
    expect(markup).toContain('<polyline');
    expect(markup).toContain('response-boundary');
    expect(markup).not.toContain('<polygon');
  });

  it('does not treat an ordinary two-point territory as a completed contour', () => {
    const markup = renderToStaticMarkup(<svg><DistrictObjectContour object={{ ...baseObject, mapRole: 'ordinary' }} project={project} /></svg>);
    expect(markup).not.toContain('<polyline');
    expect(markup).not.toContain('<polygon');
  });
});
