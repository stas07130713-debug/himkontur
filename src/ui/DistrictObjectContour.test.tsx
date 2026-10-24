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

  it('renders a territory as a clickable contour with one rectangular hover card', () => {
    const object: DistrictBuilding = {
      ...baseObject,
      contour: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 1 }],
      territoryNames: [{ id: 'territory-name', fullName: 'Площадка хранения', shortName: 'ПХ' }],
    };
    const markup = renderToStaticMarkup(<svg><DistrictObjectContour object={object} project={project} /></svg>);
    expect(markup).toContain('<polygon');
    expect(markup).toContain('district-contour-hover-card');
    expect(markup).toContain('Площадка хранения');
    expect(markup.match(/district-marker-hover-card/gu)).toHaveLength(1);
  });

  it('shows installation information from its contour instead of a numbered plate', () => {
    const object: DistrictBuilding = {
      ...baseObject,
      objectType: 'installation',
      number: '0',
      installationName: 'Наружная насосная установка',
      workshopFull: 'Цех электролиза никеля',
      workshopShort: 'ЦЭН',
      contour: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 1 }],
    };
    const markup = renderToStaticMarkup(<svg><DistrictObjectContour object={object} project={project} /></svg>);
    expect(markup).toContain('Наружная насосная установка');
    expect(markup).toContain('ЦЭН — Цех электролиза никеля');
  });
});
