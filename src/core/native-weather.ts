import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeWeatherResult = Readonly<{ payload: string }>;

type NativeWeatherRequest = Readonly<{
  latitude: number;
  longitude: number;
  start: string;
  hours: number;
}>;

type HimkonturWeatherPlugin = Readonly<{
  getForecast: (options: NativeWeatherRequest) => Promise<NativeWeatherResult>;
}>;

const androidWeather = registerPlugin<HimkonturWeatherPlugin>('HimkonturWeather');

/**
 * Installed applications use a native request here. ProjectEOL deliberately
 * rejects browser origins, while a native HTTP request remains available on
 * Russian networks without depending on a browser, CORS or a VPN.
 */
export async function requestNativeWeather(options: NativeWeatherRequest): Promise<unknown> {
  let result: NativeWeatherResult | undefined;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    result = await androidWeather.getForecast(options);
  } else if (typeof window !== 'undefined' && window.himkonturWeather !== undefined) {
    result = await window.himkonturWeather.getForecast(options);
  }
  if (result === undefined) return undefined;
  return JSON.parse(result.payload) as unknown;
}
