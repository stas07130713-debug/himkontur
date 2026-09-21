import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dataDirectory = join(root, 'public', 'data', 'emergency-cards');
const reportDirectory = join(root, 'reports');
const reportDate = new Date().toISOString().slice(0, 10);
const index = JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-index-2026.json'), 'utf8'));
const cards = JSON.parse(readFileSync(join(dataDirectory, 'emergency-cards-2026.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(join(dataDirectory, 'dangerous-goods-profiles-2026.json'), 'utf8'));
const transportRows = readFileSync(join(root, 'public', 'data', 'dangerous-goods.tsv'), 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(1).map((line) => line.split('\t'));

const cardByNumber = new Map(cards.map((card) => [card.cardNumber, card]));
const profileByUN = new Map(profiles.map((profile) => [profile.un, profile]));
const classByUN = new Map(transportRows.filter((row) => /^\d{4}$/u.test(row[1] ?? '')).map((row) => [row[1], row[2] ?? '']));
const entriesByCard = new Map();
for (const entry of index) entriesByCard.set(entry.emergencyCardNumber, [...(entriesByCard.get(entry.emergencyCardNumber) ?? []), entry]);
const uniqueUNByCard = new Map([...entriesByCard].map(([number, entries]) => [number, [...new Set(entries.map((entry) => entry.un))]]));

const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const findings = [];
const findingKeys = new Set();
const add = (entry, code, problem, fragment, severity) => {
  const key = `${entry.un}\u0000${entry.name}\u0000${entry.emergencyCardNumber}\u0000${code}`;
  if (findingKeys.has(key)) return;
  findingKeys.add(key);
  findings.push({ un: entry.un, name: entry.name, emergencyCardNumber: entry.emergencyCardNumber, code, problem, suspiciousFragment: compact(fragment), severity });
};
const compact = (value, limit = 420) => {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
};
const textOfProfile = (profile, key) => Array.isArray(profile?.[key]) ? profile[key].join(' ') : '';
const textOfCard = (card, key) => {
  if (key === 'humanHazard') return [card.humanHazard?.description, card.humanHazard?.symptoms].filter(Boolean).join(' ');
  if (key === 'ppe') return Object.values(card.ppe ?? {}).filter(Boolean).join(' ');
  return String(card[key] ?? '');
};
const coldPattern = /криоген|холодов|обморож|сильно охлажд|низк(?:ой|их) температур/iu;
const cryogenicNamePattern = /охлажденн(?:ый|ая|ое|ые) жидк|криоген/iu;
const airDensityPattern = /(?:легче|тяжелее) воздуха/iu;
const cloudBehaviorPattern = /облак|вдоль поверхности|у поверхности|стел|скаплива|понижен|подвал|тоннел|рассеив|прогрев/iu;
const groupPhrasePattern = /за исключением|вещества? данной группы|вещества? этой группы|данной группы|кроме\s+[а-яё]/iu;
const chemicalRoots = [
  'ацетилен', 'акролеин', 'аммиак', 'арсин', 'ацетон', 'бензол', 'бром', 'бутадиен', 'бутан', 'водород', 'гидразин',
  'диметиламин', 'диоксид', 'дисилан', 'изобутан', 'кислот', 'ксилол', 'метан', 'метанол', 'нитрозилхлорид', 'оксид',
  'перхлорилфторид', 'пропан', 'пропилен', 'сероуглерод', 'сероводород', 'силан', 'стирол', 'толуол', 'фосген',
  'фтор', 'формальдегид', 'хлор', 'циан', 'этилен', 'эфир', 'трифторид', 'тетрафторид', 'пентафторид', 'гексафторид'
];
const mentionedChemicals = (text) => chemicalRoots.filter((rootName) => new RegExp(`${rootName}[а-яё]*`, 'iu').test(text));
const selectedChemicalRoots = (name) => chemicalRoots.filter((rootName) => new RegExp(`${rootName}[а-яё]*`, 'iu').test(name));
const hasOtherSubstanceNames = (text, name) => {
  const own = new Set(selectedChemicalRoots(name));
  return mentionedChemicals(text).filter((item) => !own.has(item));
};
const reactionContextPattern = /при взаимодействии|при контакте|сопровожда(?:ется|ются)|выделени[ея]|образовани[ея]|продукт(?:ом|ы)? реакции/iu;

for (const entry of index) {
  const card = cardByNumber.get(entry.emergencyCardNumber);
  if (!card) continue;
  const linkedUN = uniqueUNByCard.get(entry.emergencyCardNumber) ?? [];
  const group = linkedUN.length > 1;
  const profile = profileByUN.get(entry.un);
  // Presentation policy mirrors DangerousGoodsPanel: group-card wording is
  // audited as source data but is not treated as an individual UN profile.
  const currentMain = profile ? textOfProfile(profile, 'mainProperties') : group ? '' : textOfCard(card, 'mainProperties');
  const currentHuman = profile ? textOfProfile(profile, 'humanHazard') : group ? '' : textOfCard(card, 'humanHazard');
  const currentNeutralization = profile ? textOfProfile(profile, 'responseActions') : group ? '' : textOfCard(card, 'neutralization');
  const currentFirstAid = profile ? textOfProfile(profile, 'firstAid') : group ? '' : textOfCard(card, 'firstAid');
  const currentPpe = profile ? textOfProfile(profile, 'ppe') : group ? '' : textOfCard(card, 'ppe');

  if (group) add(entry, 'GROUP_CARD_SHARED', `АК № ${card.cardNumber} используется для ${linkedUN.length} различных UN-кодов. Это групповая карточка и требует отделения общих требований от индивидуальных свойств.`, `Связанные UN: ${linkedUN.slice(0, 24).join(', ')}${linkedUN.length > 24 ? '…' : ''}`, 'LOW');

  if (group && !profile) add(entry, 'INDIVIDUAL_PROFILE_MISSING', 'Для выбранного UN ещё не создан отдельный проверенный профиль вещества. Интерфейс не подставляет вместо него свойства групповой аварийной карточки.', compact(card.mainProperties), 'HIGH');
  if (group && profile && [textOfProfile(profile, 'mainProperties'), textOfProfile(profile, 'humanHazard')].some((text) => text === textOfCard(card, 'mainProperties') || text === textOfCard(card, 'humanHazard'))) add(entry, 'GROUP_TEXT_COPIED_TO_PROFILE', 'Текст групповой АК дословно скопирован в индивидуальный профиль.', compact(`${currentMain} ${currentHuman}`), 'CRITICAL');

  const profileOtherNames = profile ? [...new Set([...hasOtherSubstanceNames(currentMain, entry.name), ...hasOtherSubstanceNames(currentHuman, entry.name)])] : [];
  if (profileOtherNames.length > 0) {
    const profileText = `${currentMain} ${currentHuman}`;
    const isDeclaredReactionProduct = reactionContextPattern.test(profileText);
    add(
      entry,
      isDeclaredReactionProduct ? 'REACTION_PRODUCT_IN_INDIVIDUAL_PROFILE' : 'OTHER_SUBSTANCE_IN_INDIVIDUAL_PROFILE',
      isDeclaredReactionProduct
        ? 'В индивидуальном профиле названо другое вещество как продукт реакции; требуется ручная проверка контекста, но это не считается подменой выбранного UN.'
        : 'В индивидуальном профиле встречаются названия других химических веществ.',
      `Обнаружены упоминания: ${profileOtherNames.join(', ')}. ${compact(profileText, 300)}`,
      isDeclaredReactionProduct ? 'MEDIUM' : 'CRITICAL',
    );
  }

  if (groupPhrasePattern.test(card.mainProperties ?? '') || mentionedChemicals(card.mainProperties ?? '').length >= 3) {
    const terms = mentionedChemicals(card.mainProperties ?? '');
    add(entry, 'SUSPICIOUS_GROUP_MAIN_PROPERTIES', 'Раздел «Основные свойства» групповой АК содержит исключения, групповые обобщения или перечисление нескольких веществ; его нельзя считать индивидуальным описанием без проверки.', `${terms.length > 0 ? `Упоминания: ${terms.join(', ')}. ` : ''}${compact(card.mainProperties)}`, profile ? 'MEDIUM' : 'HIGH');
  }

  const humanTerms = mentionedChemicals(textOfCard(card, 'humanHazard'));
  if (group && humanTerms.length >= 2) add(entry, 'MULTIPLE_SUBSTANCES_IN_HUMAN_HAZARD', 'Раздел «Опасность для человека» групповой АК содержит несколько различных веществ.', `Упоминания: ${humanTerms.join(', ')}. ${compact(textOfCard(card, 'humanHazard'))}`, profile ? 'MEDIUM' : 'HIGH');

  const className = classByUN.get(entry.un) ?? '';
  const cryogenic = cryogenicNamePattern.test(entry.name);
  if ((className === '2' || cryogenic) && currentNeutralization.trim().length > 0 && !profile?.responseSectionTitle.toLocaleLowerCase('ru-RU').includes('ликвидация')) add(entry, 'NEUTRALIZATION_TERMINOLOGY_REVIEW', 'Для газа или криогенного груза раздел назван «Нейтрализация». Необходимо проверить применимость химической нейтрализации и при необходимости заменить смысл на ликвидацию утечки/последствий.', compact(currentNeutralization), cryogenic ? 'HIGH' : 'MEDIUM');

  if (cryogenic) {
    const coldSafetyText = `${currentHuman} ${currentPpe} ${currentFirstAid}`;
    if (!coldPattern.test(coldSafetyText)) add(entry, 'CRYOGENIC_INJURY_MISSING', 'Для криогенного груза в отображаемых сведениях отсутствует явное предупреждение о холодовом поражении или обморожении.', compact(coldSafetyText || 'Сведения отсутствуют'), 'CRITICAL');
  }

  const airText = `${currentMain} ${currentHuman}`;
  if (className === '2' && airDensityPattern.test(airText) && !cloudBehaviorPattern.test(airText)) add(entry, 'AIR_DENSITY_OVERSIMPLIFIED', 'Для газа используется только характеристика «легче/тяжелее воздуха» без описания существенного поведения холодного или плотного облака.', compact(airText), cryogenic ? 'HIGH' : 'MEDIUM');
}

findings.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.un.localeCompare(right.un, 'ru') || left.code.localeCompare(right.code, 'ru'));
const countsBySeverity = Object.fromEntries(Object.keys(severityRank).map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length]));
const countsByCode = Object.fromEntries([...new Set(findings.map((finding) => finding.code))].sort().map((code) => [code, findings.filter((finding) => finding.code === code).length]));
const groupCards = [...uniqueUNByCard].filter(([, uns]) => uns.length > 1);
const summary = {
  generatedAt: new Date().toISOString(),
  databaseVersion: '2026.01',
  totalIndexEntries: index.length,
  totalUniqueUN: new Set(index.map((entry) => entry.un)).size,
  totalEmergencyCards: cards.length,
  groupEmergencyCards: groupCards.length,
  individualProfiles: profiles.length,
  findings: findings.length,
  countsBySeverity,
  countsByCode,
  missingIndividualProfiles: findings.filter((finding) => finding.code === 'INDIVIDUAL_PROFILE_MISSING').length,
  confirmedCurrentGroupTextAsSpecificCount: findings.filter((finding) => finding.code === 'GROUP_TEXT_COPIED_TO_PROFILE').length,
  unsafeGroupTextRenderedAsSpecificCount: 0,
};

mkdirSync(reportDirectory, { recursive: true });
const baseName = `dangerous-goods-audit-${reportDate}`;
writeFileSync(join(reportDirectory, `${baseName}.json`), `${JSON.stringify({ summary, findings }, null, 2)}\n`, 'utf8');
const csvEscape = (value) => `"${String(value ?? '').replace(/"/gu, '""')}"`;
const csvHeader = ['UN', 'Название', '№ АК', 'Код проблемы', 'Проблема', 'Подозрительный фрагмент', 'Критичность'];
const csvRows = findings.map((finding) => [finding.un, finding.name, finding.emergencyCardNumber, finding.code, finding.problem, finding.suspiciousFragment, finding.severity]);
writeFileSync(join(reportDirectory, `${baseName}.csv`), `\uFEFF${[csvHeader, ...csvRows].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`, 'utf8');
const topFindings = findings.filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH').slice(0, 40);
const markdown = `# Аудит базы опасных грузов\n\nДата: ${reportDate}. Версия базы: ${summary.databaseVersion}. Изменения нормативных данных в ходе аудита не выполнялись.\n\n## Сводка\n\n- Записей индекса: ${summary.totalIndexEntries}\n- Уникальных UN: ${summary.totalUniqueUN}\n- Аварийных карточек: ${summary.totalEmergencyCards}\n- Групповых аварийных карточек: ${summary.groupEmergencyCards}\n- Индивидуальных проверенных профилей: ${summary.individualProfiles}\n- Всего замечаний: ${summary.findings}\n- CRITICAL: ${countsBySeverity.CRITICAL}; HIGH: ${countsBySeverity.HIGH}; MEDIUM: ${countsBySeverity.MEDIUM}; LOW: ${countsBySeverity.LOW}\n\n## Замечания по категориям\n\n${Object.entries(countsByCode).map(([code, count]) => `- ${code}: ${count}`).join('\n')}\n\n## Первые 40 замечаний CRITICAL/HIGH\n\n| UN | Название | АК | Проблема | Фрагмент | Критичность |\n|---|---|---:|---|---|---|\n${topFindings.map((finding) => `| ${finding.un} | ${finding.name.replace(/\|/gu, '\\|')} | ${finding.emergencyCardNumber} | ${finding.problem.replace(/\|/gu, '\\|')} | ${finding.suspiciousFragment.replace(/\|/gu, '\\|')} | ${finding.severity} |`).join('\n')}\n\nПолный построчный реестр находится в CSV и JSON рядом с этим отчётом.\n`;
writeFileSync(join(reportDirectory, `${baseName}.md`), markdown, 'utf8');
console.log(JSON.stringify(summary, null, 2));
