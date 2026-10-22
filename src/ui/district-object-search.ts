import type { DistrictMapObject } from './district-map-model';
import { planningDocumentLabel } from './district-map-model';

export function objectResultText(object: DistrictMapObject, query: string): Readonly<{ title: string; description: string }> {
  if (object.kind === 'hydrant') return { title: object.owner.trim() || 'Принадлежность не указана', description: '' };
  if (object.kind === 'reservoir') return {
    title: object.owner.trim() || 'Принадлежность не указана',
    description: object.volumeM3 === null ? 'Пожарный водоём' : `Объём ${object.volumeM3.toLocaleString('ru-RU')} м³`,
  };
  if (object.mapRole === 'rescue-service') {
    const fullName = object.workshopFull.trim() !== '' ? object.workshopFull.trim() : object.territoryNames[0]?.fullName.trim() ?? 'Аварийно-спасательная служба';
    const shortName = object.workshopShort.trim() !== '' ? object.workshopShort.trim() : object.territoryNames[0]?.shortName.trim() ?? 'АСС';
    return { title: shortName, description: fullName };
  }
  if (object.objectType === 'territory') {
    const names = object.territoryNames
      .flatMap((unit) => [unit.fullName.trim(), unit.shortName.trim()])
      .filter(Boolean);
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    const matched = names.find((name) => name.toLocaleLowerCase('ru-RU').includes(needle));
    return { title: matched ?? names[0] ?? 'Территория', description: names.filter((name) => name !== matched).slice(0, 2).join(' · ') };
  }
  const workshop = object.workshopShort.trim() || object.workshopFull.trim() || 'Цех не указан';
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const candidates = [
    object.inventoryNumber?.trim() === '' ? '' : `Инвентарный № ${object.inventoryNumber}`,
    ...object.planningDocuments.map(planningDocumentLabel),
    ...object.departments.flatMap((unit) => [unit.fullName.trim(), unit.shortName.trim()]),
    ...object.sites.flatMap((unit) => [unit.fullName.trim(), unit.shortName.trim()]),
  ].filter(Boolean);
  const matched = candidates.find((candidate) => candidate.toLocaleLowerCase('ru-RU').includes(needle));
  const department = object.departments
    .map((unit) => unit.fullName.trim() || unit.shortName.trim())
    .find(Boolean);
  const site = object.sites
    .map((unit) => unit.fullName.trim() || unit.shortName.trim())
    .find(Boolean);
  // A number search normally has no textual candidate match. In that case the
  // most useful second line is the department name, followed by the site.
  const fallback = department ?? site ?? 'Отделение и участок не указаны';
  return { title: workshop, description: matched ?? fallback };
}
