import type { EmergencyCardsDatabase, EmergencyCardsValidationReport, ValidationIssue } from './emergencyCardTypes';

const OCR_PATTERNS: readonly RegExp[] = [
  /(?:^|\s)Ш\s*[—-]\s*/u,
  /(?:^|\s)ГУ\s*[—-]\s*/u,
  /(?:^|\s)1\s*[—-]\s*вдых/iu,
  /(?:^|\s)1У\s*[—-]/u,
  /�/u,
];

function allCardText(card: EmergencyCardsDatabase['cards'][number]): string {
  return [card.title, card.mainProperties, card.fireExplosionHazard, card.humanHazard.description, card.humanHazard.symptoms,
    card.ppe.respiratory, card.ppe.skin, card.ppe.eyes, card.ppe.other, card.actions.general, card.actions.leakOrSpill,
    card.actions.fire, card.neutralization, card.firstAid].filter((value): value is string => typeof value === 'string').join('\n');
}

export function validateEmergencyCardsDatabase(database: EmergencyCardsDatabase): EmergencyCardsValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const cardNumbers = new Set<string>();
  const duplicateCards = new Set<string>();
  for (const [index, card] of database.cards.entries()) {
    const path = `cards[${index}]`;
    if (!/^(?:\d{3}|ERG-\d{3})$/u.test(card.cardNumber)) errors.push({ code: 'INVALID_CARD_NUMBER', message: 'Некорректный номер аварийной карточки или руководства ERG.', path: `${path}.cardNumber` });
    if (cardNumbers.has(card.cardNumber)) duplicateCards.add(card.cardNumber);
    cardNumbers.add(card.cardNumber);
    const hazardSections = [card.mainProperties, card.fireExplosionHazard, card.humanHazard.description, card.humanHazard.symptoms];
    const responseSections = [card.actions.general, card.actions.leakOrSpill, card.actions.fire, card.neutralization, card.firstAid];
    if (hazardSections.every((value) => value === null || value.trim().length === 0)
      && responseSections.every((value) => value === null || value.trim().length === 0)) {
      errors.push({ code: 'EMPTY_CARD', message: `Карточка ${card.cardNumber} не содержит ни сведений об опасности, ни аварийных действий.`, path });
    }
    if (hazardSections.some((value) => typeof value === 'string' && value.trim().length > 0)
      && responseSections.every((value) => value === null || value.trim().length === 0)) {
      warnings.push({ code: 'NO_RESPONSE_SECTION_IN_SOURCE', message: `В карточке ${card.cardNumber} отсутствуют аварийные действия в опубликованном источнике.`, path });
    }
    if (Object.values(card.humanHazard.exposureRoutes).some((value) => typeof value !== 'boolean')) errors.push({ code: 'INVALID_EXPOSURE_ROUTE', message: `В карточке ${card.cardNumber} маршруты воздействия должны быть boolean.`, path: `${path}.humanHazard.exposureRoutes` });
    const text = allCardText(card);
    for (const pattern of OCR_PATTERNS) if (pattern.test(text)) errors.push({ code: 'OCR_ARTIFACT', message: `В карточке ${card.cardNumber} найден подозрительный OCR-фрагмент: ${pattern.source}`, path });
    try { new URL(card.source.sourceUrl); } catch { errors.push({ code: 'INVALID_SOURCE_URL', message: `В карточке ${card.cardNumber} указана некорректная ссылка на источник.`, path: `${path}.source.sourceUrl` }); }
    if (card.source.amendmentUrl) try { new URL(card.source.amendmentUrl); } catch { errors.push({ code: 'INVALID_AMENDMENT_URL', message: `В карточке ${card.cardNumber} указана некорректная ссылка на изменение.`, path: `${path}.source.amendmentUrl` }); }
  }
  for (const cardNumber of duplicateCards) errors.push({ code: 'DUPLICATE_CARD', message: `Номер карточки ${cardNumber} встречается повторно.` });

  const seenEntries = new Set<string>();
  const duplicateUN = new Set<string>();
  const missingCards = new Set<string>();
  for (const [index, entry] of database.index.entries()) {
    const path = `index[${index}]`;
    if (!/^\d{4}$/u.test(entry.un)) errors.push({ code: 'INVALID_UN', message: 'Номер ООН должен состоять из четырёх цифр.', path: `${path}.un` });
    if (entry.name.trim().length === 0) errors.push({ code: 'EMPTY_NAME', message: `Для UN ${entry.un} отсутствует наименование.`, path: `${path}.name` });
    const entryKey = `${entry.un}\u0000${entry.name}\u0000${entry.emergencyCardNumber}\u0000${entry.classificationCode ?? ''}`;
    if (seenEntries.has(entryKey)) duplicateUN.add(entry.un);
    seenEntries.add(entryKey);
    if (!cardNumbers.has(entry.emergencyCardNumber)) missingCards.add(entry.emergencyCardNumber);
  }
  for (const un of duplicateUN) errors.push({ code: 'DUPLICATE_UN', message: `Для UN ${un} найдена полностью дублирующаяся строка индекса.` });
  const entriesByUN = new Map<string, typeof database.index>();
  for (const entry of database.index) entriesByUN.set(entry.un, [...(entriesByUN.get(entry.un) ?? []), entry]);
  for (const [un, entries] of entriesByUN) {
    const cards = new Set(entries.map((entry) => entry.emergencyCardNumber));
    if (cards.size > 1) warnings.push({ code: 'AMBIGUOUS_UN', message: `UN ${un} требует уточнения наименования или классификационного шифра для выбора одной из карточек: ${[...cards].join(', ')}.` });
  }
  const profiles = database.profiles ?? [];
  const profileUN = new Set<string>();
  for (const [index, profile] of profiles.entries()) {
    const path = `profiles[${index}]`;
    if (!/^\d{4}$/u.test(profile.un)) errors.push({ code: 'INVALID_PROFILE_UN', message: 'Номер ООН профиля должен состоять из четырёх цифр.', path: `${path}.un` });
    if (profileUN.has(profile.un)) errors.push({ code: 'DUPLICATE_PROFILE', message: `Для UN ${profile.un} найден повторный индивидуальный профиль.`, path });
    profileUN.add(profile.un);
    if (profile.name.trim().length === 0) errors.push({ code: 'EMPTY_PROFILE_NAME', message: `Для профиля UN ${profile.un} отсутствует наименование.`, path: `${path}.name` });
    if (!cardNumbers.has(profile.emergencyCardNumber)) errors.push({ code: 'BROKEN_PROFILE_CARD_LINK', message: `Профиль UN ${profile.un} ссылается на отсутствующую АК ${profile.emergencyCardNumber}.`, path: `${path}.emergencyCardNumber` });
    if (!database.index.some((entry) => entry.un === profile.un && entry.emergencyCardNumber === profile.emergencyCardNumber)) errors.push({ code: 'PROFILE_INDEX_MISMATCH', message: `Связь UN ${profile.un} → АК ${profile.emergencyCardNumber} отсутствует в нормативном индексе.`, path });
    if (profile.mainProperties.length === 0 || profile.fireExplosionHazard.length === 0 || profile.humanHazard.length === 0) errors.push({ code: 'INCOMPLETE_SUBSTANCE_PROFILE', message: `Индивидуальный профиль UN ${profile.un} не содержит обязательные сведения об опасности.`, path });
    if (profile.sources.length === 0) errors.push({ code: 'MISSING_PROFILE_SOURCE', message: `Для индивидуального профиля UN ${profile.un} не указан источник.`, path: `${path}.sources` });
    for (const [sourceIndex, source] of profile.sources.entries()) try { new URL(source.url); } catch { errors.push({ code: 'INVALID_PROFILE_SOURCE_URL', message: `Для UN ${profile.un} указана некорректная ссылка на источник.`, path: `${path}.sources[${sourceIndex}].url` }); }
  }
  const linkedUNByCard = new Map<string, Set<string>>();
  for (const entry of database.index) {
    const linked = linkedUNByCard.get(entry.emergencyCardNumber) ?? new Set<string>();
    linked.add(entry.un);
    linkedUNByCard.set(entry.emergencyCardNumber, linked);
  }
  for (const [un, entries] of entriesByUN) {
    const groupCards = [...new Set(entries.map((entry) => entry.emergencyCardNumber))].filter((cardNumber) => (linkedUNByCard.get(cardNumber)?.size ?? 0) > 1);
    if (groupCards.length > 0 && !profileUN.has(un)) warnings.push({ code: 'MISSING_GROUP_CARD_SUBSTANCE_PROFILE', message: `[HAZMAT DATA WARNING] UN ${un} references group emergency card ${groupCards.join(', ')}, but substance-specific properties are missing.`, path: `index.UN${un}` });
  }
  for (const card of missingCards) errors.push({ code: 'BROKEN_CARD_LINK', message: `Индекс ссылается на отсутствующую карточку ${card}.` });
  const referenced = new Set(database.index.map((entry) => entry.emergencyCardNumber));
  const orphanCards = database.cards.map((card) => card.cardNumber).filter((number) => !referenced.has(number));
  for (const card of orphanCards) warnings.push({ code: 'ORPHAN_CARD', message: `Карточка ${card} не используется индексом.` });
  return {
    databaseVersion: database.meta.databaseVersion,
    totalUN: database.index.length,
    totalCards: database.cards.length,
    errors,
    warnings,
    orphanCards,
    missingCards: [...missingCards],
    duplicateUN: [...duplicateUN],
    ocrSuspiciousFragments: errors.filter((issue) => issue.code === 'OCR_ARTIFACT').map((issue) => issue.message),
  };
}
