import type { DangerousGoodIndexEntry, EmergencyCard, EmergencyCardsDatabase, EmergencyCardsMeta, SubstanceSpecificProfile } from './emergencyCardTypes';
import { validateEmergencyCardsDatabase } from './emergencyCardValidator';

const DATA_DIRECTORY = 'data/emergency-cards/';

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

function dataUrl(name: string): URL { return new URL(`${DATA_DIRECTORY}${name}`, document.baseURI); }
async function loadJson<T>(name: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(dataUrl(name), signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`Не удалось загрузить ${name}: HTTP ${response.status}`);
  try { return await response.json() as T; } catch { throw new Error(`Файл ${name} содержит некорректный JSON.`); }
}

export class EmergencyCardRepository {
  private constructor(private readonly database: EmergencyCardsDatabase) {}

  static async load(signal?: AbortSignal): Promise<EmergencyCardRepository> {
    const [index, cards, profiles, supplementalIndex, ergCards, cameoProfiles, meta] = await Promise.all([
      loadJson<readonly DangerousGoodIndexEntry[]>('dangerous-goods-index-2026.json', signal),
      loadJson<readonly EmergencyCard[]>('emergency-cards-2026.json', signal),
      loadJson<readonly SubstanceSpecificProfile[]>('dangerous-goods-profiles-2026.json', signal),
      loadJson<readonly DangerousGoodIndexEntry[]>('erg-dangerous-goods-index-2024.json', signal),
      loadJson<readonly EmergencyCard[]>('erg-emergency-cards-2024.json', signal),
      loadJson<readonly SubstanceSpecificProfile[]>('cameo-profiles-3.1.0.json', signal),
      loadJson<EmergencyCardsMeta>('emergency-cards-meta.json', signal),
    ]);
    return EmergencyCardRepository.fromDatabase({ index: [...index, ...supplementalIndex], cards: [...cards, ...ergCards], profiles: [...profiles, ...cameoProfiles], meta });
  }

  static fromDatabase(database: EmergencyCardsDatabase): EmergencyCardRepository {
    const report = validateEmergencyCardsDatabase(database);
    if (report.errors.length > 0) throw new Error(`Локальная база аварийных карточек не прошла проверку: ${report.errors[0]?.message ?? 'неизвестная ошибка'}`);
    return new EmergencyCardRepository(database);
  }

  get meta(): EmergencyCardsMeta { return this.database.meta; }
  getDangerousGoodsByUN(unNumber: string): readonly DangerousGoodIndexEntry[] {
    const un = unNumber.replace(/\D/gu, '').padStart(4, '0');
    return this.database.index.filter((entry) => entry.un === un);
  }
  getDangerousGoodByUN(unNumber: string, name?: string, classificationCode?: string): DangerousGoodIndexEntry | undefined {
    const candidates = this.getDangerousGoodsByUN(unNumber);
    if (candidates.length === 0) return undefined;
    const cardNumbers = new Set(candidates.map((entry) => entry.emergencyCardNumber));
    if (cardNumbers.size === 1) return candidates[0];
    if (classificationCode !== undefined && classificationCode.trim() !== '') {
      const byCode = candidates.filter((entry) => entry.classificationCode === classificationCode);
      if (new Set(byCode.map((entry) => entry.emergencyCardNumber)).size === 1) return byCode[0];
    }
    if (name !== undefined && name.trim() !== '') {
      const value = normalized(name);
      const exact = candidates.filter((entry) => normalized(entry.name) === value);
      if (new Set(exact.map((entry) => entry.emergencyCardNumber)).size === 1) return exact[0];
      const containing = candidates.filter((entry) => normalized(entry.name).includes(value) || value.includes(normalized(entry.name)));
      if (new Set(containing.map((entry) => entry.emergencyCardNumber)).size === 1) return containing[0];
    }
    return undefined;
  }
  getEmergencyCard(cardNumber: string): EmergencyCard | undefined { return this.database.cards.find((card) => card.cardNumber === cardNumber); }
  getCardUNNumbers(cardNumber: string): readonly string[] { return [...new Set(this.database.index.filter((entry) => entry.emergencyCardNumber === cardNumber).map((entry) => entry.un))]; }
  isGroupCard(cardNumber: string): boolean { return this.getCardUNNumbers(cardNumber).length > 1; }
  getSubstanceProfile(unNumber: string): SubstanceSpecificProfile | undefined {
    const un = unNumber.replace(/\D/gu, '').padStart(4, '0');
    return this.database.profiles?.find((profile) => profile.un === un);
  }
  listDangerousGoods(): readonly DangerousGoodIndexEntry[] { return this.database.index; }
}
