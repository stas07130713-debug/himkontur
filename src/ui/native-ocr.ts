import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeOcrElement = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

export function placardDigitsFromNativeElements(
  elements: readonly NativeOcrElement[],
  isKnownPair: (hazard: string, un: string) => boolean,
): NativePlacardDigits | undefined {
  const tokens = elements.flatMap((element) => {
    const digits = element.text.replace(/\D/gu, '');
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
