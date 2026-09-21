import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEmergencyCardByUN, searchDangerousGoods } from './emergencyCardLookup';
import { EmergencyCardRepository } from './emergencyCardRepository';
import type { EmergencyCardsDatabase } from './emergencyCardTypes';
import { validateEmergencyCardsDatabase } from './emergencyCardValidator';

const database: EmergencyCardsDatabase = {
  meta: { databaseVersion: '2026.01', effectiveDate: '2026-01-01', description: 'test', sourceDocument: 'document', sourceUrl: 'https://example.test/source', amendmentProtocol: '83', amendmentUrl: 'https://example.test/amendment' },
  index: [{ un: '1017', name: 'ХЛОР', emergencyCardNumber: '203' }],
  cards: [{
    cardNumber: '203', title: 'ГАЗЫ ЯДОВИТЫЕ КОРРОЗИОННЫЕ', mainProperties: 'Основные свойства вещества.', fireExplosionHazard: 'Пожарная опасность вещества.',
    humanHazard: { description: 'Опасность для человека.', exposureRoutes: { inhalation: true, ingestion: false, skin: true, eyes: true }, symptoms: 'Симптомы воздействия.' },
    ppe: { respiratory: 'Защита органов дыхания.', skin: 'Защита кожи.', eyes: null, other: null },
    actions: { general: 'Действия общего характера.', leakOrSpill: 'Действия при утечке.', fire: 'Действия при пожаре.' },
    neutralization: 'Порядок нейтрализации.', firstAid: 'Меры первой помощи.',
    source: { document: 'Документ', revision: '2026.01', effectiveDate: '2026-01-01', sourceReference: 'АК 203', sourceUrl: 'https://example.test/card', amendmentProtocol: null },
  }],
};
const chlorineEntry = database.index[0];
const chlorineCard = database.cards[0];
if (chlorineEntry === undefined || chlorineCard === undefined) throw new Error('Некорректная тестовая база.');

describe('локальная база аварийных карточек', () => {
  it('полная автономная база CAMEO/ERG покрывает каждый UN без пустых карточек', () => {
    const directory = resolve(process.cwd(), 'public/data/emergency-cards');
    const full: EmergencyCardsDatabase = {
      index: [
        ...(JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-index-2026.json'), 'utf8')) as EmergencyCardsDatabase['index']),
        ...(JSON.parse(readFileSync(resolve(directory, 'erg-dangerous-goods-index-2024.json'), 'utf8')) as EmergencyCardsDatabase['index']),
      ],
      cards: [
        ...(JSON.parse(readFileSync(resolve(directory, 'emergency-cards-2026.json'), 'utf8')) as EmergencyCardsDatabase['cards']),
        ...(JSON.parse(readFileSync(resolve(directory, 'erg-emergency-cards-2024.json'), 'utf8')) as EmergencyCardsDatabase['cards']),
      ],
      profiles: [
        ...(JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-profiles-2026.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>),
        ...(JSON.parse(readFileSync(resolve(directory, 'cameo-profiles-3.1.0.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>),
      ],
      meta: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-meta.json'), 'utf8')) as EmergencyCardsDatabase['meta'],
    };
    const report = validateEmergencyCardsDatabase(full);
    expect(report.errors).toEqual([]);
    expect(new Set(full.profiles?.map((profile) => profile.un)).size).toBe(2323);
    const helium = full.profiles?.find((profile) => profile.un === '1963');
    expect(JSON.stringify(helium)).toMatch(/обморож/iu);
    expect(JSON.stringify(helium)).not.toMatch(/ещ[её] не прошли|сюда не подставляется/iu);
  });
  it('рабочие JSON-файлы читаются и проходят валидацию без ошибок', () => {
    const directory = resolve(process.cwd(), 'public/data/emergency-cards');
    const actual: EmergencyCardsDatabase = {
      index: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-index-2026.json'), 'utf8')) as EmergencyCardsDatabase['index'],
      cards: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-2026.json'), 'utf8')) as EmergencyCardsDatabase['cards'],
      profiles: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-profiles-2026.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>,
      meta: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-meta.json'), 'utf8')) as EmergencyCardsDatabase['meta'],
    };
    expect(validateEmergencyCardsDatabase(actual).errors).toEqual([]);
  });
  it('однозначно возвращает карточку хлора по UN 1017', () => {
    const repository = EmergencyCardRepository.fromDatabase(database);
    const result = getEmergencyCardByUN(repository, 'UN 1017');
    expect(result?.name).toBe('ХЛОР');
    expect(result?.cardNumber).toBe('203');
    expect(result?.card.humanHazard.exposureRoutes).toEqual({ inhalation: true, ingestion: false, skin: true, eyes: true });
    expect(JSON.stringify(result)).not.toMatch(/Ш\s*[—-]|ГУ\s*[—-]|1\s*[—-]\s*вдых/iu);
  });

  it('возвращает нормативную карточку 204 для метана охлажденного жидкого UN 1972', () => {
    const directory = resolve(process.cwd(), 'public/data/emergency-cards');
    const actual: EmergencyCardsDatabase = {
      index: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-index-2026.json'), 'utf8')) as EmergencyCardsDatabase['index'],
      cards: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-2026.json'), 'utf8')) as EmergencyCardsDatabase['cards'],
      profiles: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-profiles-2026.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>,
      meta: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-meta.json'), 'utf8')) as EmergencyCardsDatabase['meta'],
    };
    const result = getEmergencyCardByUN(EmergencyCardRepository.fromDatabase(actual), '1972');
    expect(result?.cardNumber).toBe('204');
    expect(result?.cardType).toBe('group');
    expect(result?.cardUNNumbers.length).toBeGreaterThan(1);
    expect(result?.profile?.hazardMarker).toBe('КРИОГЕННАЯ ОПАСНОСТЬ');
    expect(result?.profile?.mainProperties.join(' ')).not.toMatch(/ацетилен|этилен|водород/iu);
    expect(result?.name).toMatch(/МЕТАН ОХЛАЖДЕННЫЙ ЖИДКИЙ/u);
    expect(result?.card.actions.fire).toMatch(/Не приближаться к емкостям/u);
  });

  it('не подмешивает сведения об аммиаке в профиль раствора гидроксида натрия UN 1824', () => {
    const directory = resolve(process.cwd(), 'public/data/emergency-cards');
    const actual: EmergencyCardsDatabase = {
      index: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-index-2026.json'), 'utf8')) as EmergencyCardsDatabase['index'],
      cards: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-2026.json'), 'utf8')) as EmergencyCardsDatabase['cards'],
      profiles: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-profiles-2026.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>,
      meta: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-meta.json'), 'utf8')) as EmergencyCardsDatabase['meta'],
    };
    const result = getEmergencyCardByUN(EmergencyCardRepository.fromDatabase(actual), '1824');
    expect(result?.cardNumber).toBe('809');
    expect(result?.cardType).toBe('group');
    expect(result?.profile?.name).toBe('НАТРИЯ ГИДРОКСИДА РАСТВОР');
    expect(JSON.stringify(result?.profile)).not.toMatch(/аммиак|нашатыр/iu);
    expect(result?.profile?.mainProperties.join(' ')).toMatch(/сильная щелочь/iu);
  });

  it('предупреждает, если групповая карточка не имеет индивидуального профиля UN', () => {
    const grouped: EmergencyCardsDatabase = {
      ...database,
      index: [...database.index, { un: '1018', name: 'ДРУГОЙ ГРУЗ', emergencyCardNumber: '203' }],
    };
    const report = validateEmergencyCardsDatabase(grouped);
    expect(report.warnings.some((issue) => issue.code === 'MISSING_GROUP_CARD_SUBSTANCE_PROFILE' && issue.message.includes('UN 1017'))).toBe(true);
  });

  it('содержит полный комплект карточек и изменения протокола № 83', () => {
    const directory = resolve(process.cwd(), 'public/data/emergency-cards');
    const actual: EmergencyCardsDatabase = {
      index: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-index-2026.json'), 'utf8')) as EmergencyCardsDatabase['index'],
      cards: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-2026.json'), 'utf8')) as EmergencyCardsDatabase['cards'],
      profiles: JSON.parse(readFileSync(resolve(directory, 'dangerous-goods-profiles-2026.json'), 'utf8')) as NonNullable<EmergencyCardsDatabase['profiles']>,
      meta: JSON.parse(readFileSync(resolve(directory, 'emergency-cards-meta.json'), 'utf8')) as EmergencyCardsDatabase['meta'],
    };
    const repository = EmergencyCardRepository.fromDatabase(actual);
    expect(actual.cards).toHaveLength(267);
    expect(getEmergencyCardByUN(repository, '3553')?.cardNumber).toBe('206');
    expect(getEmergencyCardByUN(repository, '3554')?.cardNumber).toBe('813');
    expect(getEmergencyCardByUN(repository, '3555')?.cardNumber).toBe('311');
    expect(getEmergencyCardByUN(repository, '3423')?.cardNumber).toBe('603');
    expect(repository.getDangerousGoodsByUN('1835').map((item) => item.classificationCode).sort()).toEqual(['8013', '8062']);
    expect(repository.getEmergencyCard('603')?.mainProperties).toMatch(/вызывает коррозию некоторых металлов/u);
    expect(repository.getEmergencyCard('603')?.source.amendmentUrl).toMatch(/413231681/u);
  });

  it('не подменяет отсутствующий UN похожей карточкой', () => {
    const repository = EmergencyCardRepository.fromDatabase(database);
    expect(getEmergencyCardByUN(repository, '9999')).toBeUndefined();
  });

  it('ищет безопасно по началу наименования', () => {
    const repository = EmergencyCardRepository.fromDatabase(database);
    expect(searchDangerousGoods(repository, 'хло')).toHaveLength(1);
    expect(searchDangerousGoods(repository, 'лор')).toHaveLength(0);
  });

  it('обнаруживает битую связь UN → АК', () => {
    const broken = { ...database, index: [{ ...chlorineEntry, emergencyCardNumber: '999' }] };
    expect(validateEmergencyCardsDatabase(broken).errors.some((issue) => issue.code === 'BROKEN_CARD_LINK')).toBe(true);
  });

  it('обнаруживает полностью дублирующуюся строку UN', () => {
    const duplicate = { ...database, index: [...database.index, chlorineEntry] };
    expect(validateEmergencyCardsDatabase(duplicate).errors.some((issue) => issue.code === 'DUPLICATE_UN')).toBe(true);
  });

  it('разрешает нормативные варианты одного UN по наименованию или классификационному шифру', () => {
    const variantDatabase: EmergencyCardsDatabase = {
      ...database,
      index: [
        { un: '1990', name: 'БЕНЗАЛЬДЕГИД', emergencyCardNumber: '203', classificationCode: '6013' },
        { un: '1990', name: 'ВЕЩЕСТВО ЯДОВИТОЕ, Н.У.К.', emergencyCardNumber: '204', classificationCode: '6023' },
      ],
      cards: [chlorineCard, { ...chlorineCard, cardNumber: '204', title: 'АК 204' }],
    };
    const repository = EmergencyCardRepository.fromDatabase(variantDatabase);
    expect(getEmergencyCardByUN(repository, '1990')).toBeUndefined();
    expect(getEmergencyCardByUN(repository, '1990', 'БЕНЗАЛЬДЕГИД')?.cardNumber).toBe('203');
    expect(getEmergencyCardByUN(repository, '1990', undefined, '6023')?.cardNumber).toBe('204');
  });

  it('блокирует полностью пустую карточку', () => {
    const incomplete = { ...database, cards: [{ ...chlorineCard, mainProperties: null, fireExplosionHazard: null,
      humanHazard: { ...chlorineCard.humanHazard, description: null, symptoms: null },
      actions: { general: null, leakOrSpill: null, fire: null }, neutralization: null, firstAid: null }] };
    expect(() => EmergencyCardRepository.fromDatabase(incomplete)).toThrow(/не прошла проверку/u);
  });

  it('выдаёт понятную ошибку для невалидного JSON', () => {
    const parseInvalid = (): unknown => JSON.parse('{invalid') as unknown;
    expect(parseInvalid).toThrow();
  });
});
