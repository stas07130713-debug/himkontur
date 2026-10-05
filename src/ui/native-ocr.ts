import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeOcrElement = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}>;
export type NativePlacardDigits = Readonly<{ hazard: string; un: string }>;

type NativeOcrResult = Readonly<{ elements: readonly NativeOcrElement[] }>;
type HimkonturOcrPlugin = Readonly<{
  recognize: (options: Readonly<{ image: string }>) => Promise<NativeOcrResult>;
}>;

const HimkonturOcr = registerPlugin<HimkonturOcrPlugin>('HimkonturOcr');

export function nativeOcrAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function normalizedNumericText(value: string): string {
  return value
    .toLocaleUpperCase('ru-RU')
    .replace(/[OОQDД]/gu, '0')
    .replace(/[IІL|]/gu, '1')
    .replace(/[ZЗ]/gu, '2')
    .replace(/S/gu, '5')
    .replace(/[BВ]/gu, '8')
    .replace(/\D/gu, '');
}

export function numbersFromNativeElements(elements: readonly NativeOcrElement[]): readonly string[] {
  const values = elements.flatMap((element) => {
    const digits = normalizedNumericText(element.text);
    if (digits.length < 2 || digits.length > 7) return [];
    if (digits.length === 6 || digits.length === 7) return [digits, digits.slice(0, -4), digits.slice(-4)];
    return [digits];
  });
  return [...new Set(values.filter((value) => value.length >= 2 && value.length <= 4))];
}

export function placardDigitsFromNativeRows(
  upperElements: readonly NativeOcrElement[],
  lowerElements: readonly NativeOcrElement[],
  isKnownPair: (hazard: string, un: string) => boolean,
): NativePlacardDigits | undefined {
  const hazards = numbersFromNativeElements(upperElements).filter((value) => value.length === 2 || value.length === 3);
  const uns = numbersFromNativeElements(lowerElements).filter((value) => value.length === 4);
  const pairs = hazards.flatMap((hazard) => uns.flatMap((un) => isKnownPair(hazard, un) ? [{ hazard, un }] : []));
  const unique = pairs.filter((pair, index, all) => all.findIndex((item) => item.hazard === pair.hazard && item.un === pair.un) === index);
  return unique.length === 1 ? unique[0] : undefined;
}

export function placardDigitsFromNativeUn(
  elements: readonly NativeOcrElement[],
  uniqueHazardForUn: (un: string) => string | undefined,
): NativePlacardDigits | undefined {
  const candidates = elements.flatMap((element) => {
    const digits = normalizedNumericText(element.text);
    const confidence = element.confidence;
    const confident = confidence === undefined || confidence < 0 || confidence >= .45;
    return confident && digits.length === 4 ? [digits] : [];
  });
  const uniqueUns = [...new Set(candidates)];
  if (uniqueUns.length !== 1) return undefined;
  const un = uniqueUns[0];
  if (un === undefined) return undefined;
  const hazard = uniqueHazardForUn(un);
  return hazard === undefined ? undefined : { hazard, un };
}

export function placardDigitsFromNativeElements(
  elements: readonly NativeOcrElement[],
  isKnownPair: (hazard: string, un: string) => boolean,
): NativePlacardDigits | undefined {
  const tokens = elements.flatMap((element) => {
    const digits = normalizedNumericText(element.text);
    const groups = digits.length >= 2 && digits.length <= 7 ? [digits] : [];
    return groups.flatMap((group) => {
      if (group.length === 6 || group.length === 7) return [
        { ...element, value: group.slice(0, -4) },
        { ...element, value: group.slice(-4), y: element.y + element.height * .55, height: element.height * .45 },
      ];
      return [{ ...element, value: group }];
    });
  });
  const pairs = tokens.filter((item) => item.value.length === 2 || item.value.length === 3).flatMap((hazard) =>
    tokens.filter((item) => item.value.length === 4).flatMap((un) => {
      const hazardCentreX = hazard.x + hazard.width / 2;
      const unCentreX = un.x + un.width / 2;
      const verticallyOrdered = un.y + un.height / 2 > hazard.y + hazard.height / 2;
      const aligned = Math.abs(unCentreX - hazardCentreX) <= Math.max(hazard.width, un.width, hazard.height * 3);
      return verticallyOrdered && aligned && isKnownPair(hazard.value, un.value) ? [{ hazard: hazard.value, un: un.value }] : [];
    })
  );
  const unique = pairs.filter((pair, index, all) => all.findIndex((item) => item.hazard === pair.hazard && item.un === pair.un) === index);
  return unique.length === 1 ? unique[0] : undefined;
}

export async function recognizeCanvasNatively(canvas: HTMLCanvasElement): Promise<readonly NativeOcrElement[]> {
  const encoded = canvas.toDataURL('image/jpeg', .92).split(',', 2)[1];
  if (encoded === undefined || encoded.length === 0) throw new Error('Не удалось подготовить изображение для Android OCR.');
  const result = await HimkonturOcr.recognize({ image: encoded });
  return result.elements;
}
