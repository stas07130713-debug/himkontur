import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWeather } from './weather';

const POINT = { latitude: 67.939, longitude: 32.873 };

afterEach(() => vi.unstubAllGlobals());

describe('weather at the accident date and time', () => {
  it('uses the Russian native gateway in installed applications and converts model units', async () => {
    const accident = new Date(Date.now() + 45 * 60_000);
    const lower = new Date(accident); lower.setMinutes(0, 0, 0);
    const upper = new Date(lower.getTime() + 60 * 60_000);
    const payload = JSON.stringify({ result: { structuredContent: { forecast: [
      { time: lower.toISOString(), values: {
        air_temperature_2m: { value: 278.15, unit: 'K' }, wind_speed_10m: { value: 4, unit: 'm s-1' },
        wind_direction_10m: { value: 350, unit: 'degree' }, cloud_area_fraction: { value: .4, unit: '1' },
        surface_snow_thickness: { value: null, unit: 'm' }
      } },
      { time: upper.toISOString(), values: {
        air_temperature_2m: { value: 282.15, unit: 'K' }, wind_speed_10m: { value: 8, unit: 'm s-1' },
        wind_direction_10m: { value: 10, unit: 'degree' }, cloud_area_fraction: { value: .8, unit: '1' },
        surface_snow_thickness: { value: null, unit: 'm' }
      } }
    ] } } });
    vi.stubGlobal('window', { himkonturWeather: { getForecast: vi.fn().mockResolvedValue({ payload }) } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Browser provider blocked')));

    const weather = await fetchWeather({ latitude: 67.7, longitude: 32.7 }, accident.toISOString());

    expect(weather.provider).toBe('ProjectEOL / NOAA GFS');
    expect(weather.temperatureC).toBeGreaterThan(5);
    expect(weather.temperatureC).toBeLessThan(9);
    expect(weather.windSpeedMps).toBeGreaterThan(4);
    expect(weather.windSpeedMps).toBeLessThan(8);
    expect(weather.windFromDegrees < 10 || weather.windFromDegrees > 350).toBe(true);
    expect(weather.cloudCoverPercent).toBeGreaterThan(40);
    expect(weather.cloudCoverPercent).toBeLessThan(80);
    expect(weather.snowDepthM).toBe(0);
  });

  it('requests the entered date and interpolates the exact entered minute', async () => {
    const accident = new Date(2026, 8, 1, 11, 20);
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(requestedUrl);
      if (requestedUrl.includes('api.met.no')) return Promise.reject(new Error('reserve unavailable in this test'));
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

    expect(requestedUrls.some((url) => url.includes('latitude=67.939'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('longitude=32.873'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('start_date=2026-09-01'))).toBe(true);
    expect(weather.observedAt).toBe(accident.toISOString());
    expect(weather.temperatureC).toBeCloseTo(11, 8);
    expect(weather.windSpeedMps).toBeCloseTo(4, 8);
    expect(weather.windFromDegrees).toBeCloseTo(0, 8);
    expect(weather.cloudCoverPercent).toBeCloseTo(30, 8);
  });

  it('uses the independent MET Norway provider when Open-Meteo is unavailable without VPN', async () => {
    const accident = new Date(Date.now() + 30 * 60_000);
    const lower = new Date(accident); lower.setMinutes(0, 0, 0);
    const upper = new Date(lower.getTime() + 60 * 60_000);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('open-meteo.com')) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(JSON.stringify({ properties: { timeseries: [
        { time: lower.toISOString(), data: { instant: { details: { air_temperature: 6, wind_speed: 4, wind_from_direction: 350, cloud_area_fraction: 60 } } } },
        { time: upper.toISOString(), data: { instant: { details: { air_temperature: 8, wind_speed: 6, wind_from_direction: 10, cloud_area_fraction: 80 } } } }
      ] } }), { status: 200 }));
    }));

    const weather = await fetchWeather({ latitude: 68.1, longitude: 33.1 }, accident.toISOString());

    expect(weather.provider).toBe('MET Norway');
    expect(weather.temperatureC).toBeGreaterThan(6);
    expect(weather.temperatureC).toBeLessThan(8);
    expect(weather.windFromDegrees < 10 || weather.windFromDegrees > 350).toBe(true);
  });

  it('uses wttr.in when both model providers are unavailable through the mobile operator', async () => {
    const accident = new Date(2026, 9, 6, 10, 30);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('wttr.in')) return Promise.reject(new TypeError('Blocked by network operator'));
      return Promise.resolve(new Response(JSON.stringify({ weather: [{
        date: '2026-10-06',
        hourly: [
          { time: '900', tempC: '6', windspeedKmph: '18', winddirDegree: '350', cloudcover: '40' },
          { time: '1200', tempC: '9', windspeedKmph: '36', winddirDegree: '20', cloudcover: '100' }
        ]
      }] }), { status: 200 }));
    }));

    const weather = await fetchWeather({ latitude: 68.2, longitude: 33.2 }, accident.toISOString());

    expect(weather.provider).toBe('wttr.in');
    expect(weather.temperatureC).toBeCloseTo(7.5, 8);
    expect(weather.windSpeedMps).toBeCloseTo(7.5, 8);
    expect(weather.windFromDegrees).toBeCloseTo(5, 8);
    expect(weather.cloudCoverPercent).toBeCloseTo(70, 8);
    expect(weather.snowDepthM).toBe(0);
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
