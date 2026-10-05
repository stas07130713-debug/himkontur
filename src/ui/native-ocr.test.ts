import { describe, expect, it } from 'vitest';
import { numbersFromNativeElements, placardDigitsFromNativeElements, placardDigitsFromNativeRows, type NativeOcrElement } from './native-ocr';

const known = (hazard: string, un: string) => `${hazard}/${un}` === '30/1202';
const box = (text: string, x: number, y: number, width = 120, height = 55): NativeOcrElement => ({ text, x, y, width, height });

describe('Android placard OCR result validation', () => {
  it('reads two vertically aligned rows', () => {
    expect(placardDigitsFromNativeElements([box('30', 20, 10), box('1202', 10, 90, 140)], known)).toEqual({ hazard: '30', un: '1202' });
  });

  it('normalizes spaces introduced between photographed digits', () => {
    expect(placardDigitsFromNativeElements([box('3 0', 20, 10), box('1 2 0 2', 10, 90, 140)], known)).toEqual({ hazard: '30', un: '1202' });
  });

  it('normalizes common camera OCR substitutions inside numeric rows', () => {
    expect(numbersFromNativeElements([box('3O', 20, 10), box('IZOZ', 10, 90, 140)])).toEqual(['30', '1202']);
    expect(placardDigitsFromNativeElements([box('3O', 20, 10), box('IZOZ', 10, 90, 140)], known)).toEqual({ hazard: '30', un: '1202' });
  });

  it('prefers independently cropped upper and lower rows over a misleading frame read', () => {
    expect(placardDigitsFromNativeRows([box('30', 20, 10)], [box('1202', 10, 10, 140)], known)).toEqual({ hazard: '30', un: '1202' });
  });

  it('splits a single combined OCR line only when the pair exists in the offline directory', () => {
    expect(placardDigitsFromNativeElements([box('301202', 10, 10, 150, 120)], known)).toEqual({ hazard: '30', un: '1202' });
    expect(placardDigitsFromNativeElements([box('301120', 10, 10, 150, 120)], known)).toBeUndefined();
  });

  it('rejects unrelated or horizontally separated numbers', () => {
    expect(placardDigitsFromNativeElements([box('30', 10, 10), box('1202', 600, 90)], known)).toBeUndefined();
  });
});
