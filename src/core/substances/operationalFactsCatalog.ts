export type WaterCompatibility = 'safe' | 'restricted' | 'prohibited' | 'not-stated';

export type OperationalFacts = Readonly<{
  workplacePdk: Readonly<{
    value: string;
    source: string;
    sourceUrl: string;
  }>;
  water: Readonly<{
    compatibility: WaterCompatibility;
    label: string;
    description: string;
    source: string;
    sourceUrl: string;
  }>;
}>;

// Здесь хранятся только значения, для которых в локальной базе закреплена
// точная нормативная ссылка. Для остальных UN интерфейс честно показывает,
// что ПДК в привязанной карточке не приведена, и не формирует число догадкой.
export const OPERATIONAL_FACTS_CATALOG: Readonly<Record<string, OperationalFacts>> = {
  '1017': {
    workplacePdk: {
      value: '1 мг/м³',
      source: 'СанПиН 1.2.3685-21, таблица 2.1 — воздух рабочей зоны',
      sourceUrl: 'https://www.consultant.ru/document/cons_doc_LAW_375839/fa69e15a74de57cbe09d347462434c11fcfeeaca/',
    },
    water: {
      compatibility: 'restricted',
      label: 'Ограниченно совместимо',
      description: 'Хлор растворяется в воде. Распылённую воду применяют для изоляции газового облака. Нельзя допускать попадания воды в ёмкость с хлором и направлять сплошную струю на жидкий хлор.',
      source: 'Аварийная карточка № 203',
      sourceUrl: 'https://www.mintrans.gov.ru/documents/6/825',
    },
  },
  '1789': {
    workplacePdk: {
      value: '5 мг/м³',
      source: 'ГОСТ 857-95, пункт 4.4 — пары соляной кислоты в воздухе рабочей зоны',
      sourceUrl: 'https://normativ.kontur.ru/document?documentId=99017&moduleId=9&view=mobile-app',
    },
    water: {
      compatibility: 'safe',
      label: 'Совместима с водой',
      description: 'Соляная кислота является водным раствором хлористого водорода и смешивается с водой. При разбавлении кислоту добавляют в воду постепенно и с перемешиванием: смешение сопровождается нагреванием и при неправильном порядке возможно разбрызгивание.',
      source: 'ГОСТ 3118-77; ГОСТ 4517-2016',
      sourceUrl: 'https://docs.cntd.ru/document/1200017281',
    },
  },
};
