import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWeather } from './weather';

const POINT = { latitude: 67.939, longitude: 32.873 };

afterEach(() => vi.unstubAllGlobals());

describe('weather at the accident date and time', () => {
  it('requests the entered date and interpolates the exact entered minute', async () => {
    const accident = new Date(2026, 8, 1, 11, 20);
    let requestedUrl = '';
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(JSON.stringify({ hourly: {
      time: ['2026-09-01T11:00', '2026-09-01T12:00'],
      temperature_2m: [10, 13],
      wind_speed_10m: [3, 6],
      wind_direction_10m: [350, 20],
      cloud_cover: [20, 50],
      snow_depth: [0, 0]
    } }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const weather = await fetchWeather(POINT, accident.toISOString());

    expect(requestedUrl).toContain('latitude=67.939');
    expect(requestedUrl).toContain('longitude=32.873');
    expect(requestedUrl).toContain('start_date=2026-09-01');
    expect(weather.observedAt).toBe(accident.toISOString());
    expect(weather.temperatureC).toBeCloseTo(11, 8);
    expect(weather.windSpeedMps).toBeCloseTo(4, 8);
    expect(weather.windFromDegrees).toBeCloseTo(0, 8);
    expect(weather.cloudCoverPercent).toBeCloseTo(30, 8);
  });

  it('uses the historical archive for an old accident and tolerates absent snow data', async () => {
    const accident = new Date(2020, 0, 1, 11, 0);
    let requestedUrl = '';
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(JSON.stringify({ hourly: {
      time: ['2020-01-01T11:00'],
      temperature_2m: [-7],
      wind_speed_10m: [2],
      wind_direction_10m: [45],
      cloud_cover: [100],
      snow_depth: [null]
    } }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const weather = await fetchWeather(POINT, accident.toISOString());

    expect(requestedUrl).toContain('archive-api.open-meteo.com/v1/archive');
    expect(weather.dataKind).toBe('archive');
    expect(weather.snowDepthM).toBe(0);
  });

  it('rejects dates beyond the available forecast horizon', async () => {
    const accident = new Date(Date.now() + 17 * 86_400_000);
    await expect(fetchWeather(POINT, accident.toISOString())).rejects.toThrow('будущей даты');
  });
});
