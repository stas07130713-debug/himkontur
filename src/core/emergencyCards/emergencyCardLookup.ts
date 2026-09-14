import type { DangerousGoodIndexEntry, EmergencyCard, EmergencyCardLookupResult } from './emergencyCardTypes';
import { EmergencyCardRepository } from './emergencyCardRepository';

function normalized(value: string): string { return value.toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').trim(); }

export function getDangerousGoodByUN(repository: EmergencyCardRepository, unNumber: string, name?: string, classificationCode?: string): DangerousGoodIndexEntry | undefined { return repository.getDangerousGoodByUN(unNumber, name, classificationCode); }
export function getEmergencyCard(repository: EmergencyCardRepository, cardNumber: string): EmergencyCard | undefined { return repository.getEmergencyCard(cardNumber); }
export function getEmergencyCardByUN(repository: EmergencyCardRepository, unNumber: string, name?: string, classificationCode?: string): EmergencyCardLookupResult | undefined {
  const good = repository.getDangerousGoodByUN(unNumber, name, classificationCode);
  if (good === undefined) return undefined;
  const card = repository.getEmergencyCard(good.emergencyCardNumber);
  if (card === undefined) return undefined;
  const cardUNNumbers = repository.getCardUNNumbers(good.emergencyCardNumber);
  const profile = repository.getSubstanceProfile(good.un);
  return { un: good.un, name: good.name, cardNumber: good.emergencyCardNumber, card, cardType: cardUNNumbers.length > 1 ? 'group' : 'individual', cardUNNumbers, ...(profile === undefined ? {} : { profile }) };
}
export function searchDangerousGoods(repository: EmergencyCardRepository, query: string): readonly DangerousGoodIndexEntry[] {
  const value = normalized(query);
  if (value.length === 0) return [];
  const digits = value.replace(/\D/gu, '');
  return repository.listDangerousGoods().filter((entry) => (digits.length > 0 && entry.un.startsWith(digits)) || normalized(entry.name).split(/\s+/u).some((word) => word.startsWith(value)) || normalized(entry.name).startsWith(value));
}
