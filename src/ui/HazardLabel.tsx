import { type CSSProperties } from 'react';
import { appAssetUrl } from './app-url';

export type HazardLabelData = Readonly<{ code: string; primary: boolean; conditional?: boolean }>;

const LABEL_NAMES: Readonly<Record<string, string>> = {
  '1': 'Взрывчатые вещества и изделия', '1.1': 'Опасность взрыва массой', '1.2': 'Опасность разбрасывания',
  '1.3': 'Пожарная опасность и небольшая опасность взрыва', '1.4': 'Незначительная опасность взрыва',
  '1.5': 'Очень нечувствительные взрывчатые вещества', '1.6': 'Чрезвычайно нечувствительные изделия',
  '2.1': 'Легковоспламеняющийся газ', '2.2': 'Невоспламеняющийся нетоксичный газ', '2.3': 'Токсичный газ',
  '3': 'Легковоспламеняющаяся жидкость', '4.1': 'Легковоспламеняющееся твёрдое вещество',
  '4.2': 'Самовозгорающееся вещество', '4.3': 'Вещество, выделяющее воспламеняющийся газ при контакте с водой',
  '5.1': 'Окисляющее вещество', '5.2': 'Органический пероксид', '6.1': 'Токсичное вещество',
  '6.2': 'Инфекционное вещество', '7E': 'Делящийся материал',
  '7X': 'Знак категории радиоактивного материала определяется условиями перевозки',
  '8': 'Коррозионное вещество', '9': 'Прочие опасные вещества и изделия', '9A': 'Литиевые батареи',
};

const ASSET_CODE: Readonly<Record<string, string>> = { '1.1': '1', '1.2': '1', '1.3': '1' };

export function HazardLabel({ label }: Readonly<{ label: HazardLabelData }>) {
  const normalized = label.code.toUpperCase();
  const assetCode = ASSET_CODE[normalized] ?? normalized;
  const fileName = assetCode.replace('.', '-');
  const name = LABEL_NAMES[normalized] ?? `Знак опасности ${label.code}`;
  const title = `${label.code} — ${name}${label.primary ? ' (основной)' : ' (дополнительный)'}${label.conditional ? ' · применяется при условии, указанном в ADR' : ''}`;
  const source = appAssetUrl(`assets/adr-labels/${fileName}.png`);
  return <span className="hazard-label-frame" title={title} style={{ '--hazard-image': `url('${source}')` } as CSSProperties}>
    <img className="hazard-label" src={source} alt={title} draggable={false}/>
  </span>;
}
