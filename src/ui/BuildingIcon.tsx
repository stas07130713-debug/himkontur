import type { ControlKind } from './ControlPalette';
import { appAssetUrl } from './app-url';

type Props = Readonly<{ kind: ControlKind; compact?: boolean }>;

export function BuildingIcon({ kind, compact = false }: Props) {
  return <img className={`building-icon ${kind}${compact ? ' compact' : ''}`} src={appAssetUrl(`assets/controls/${kind}-v4.png`)} alt="" aria-hidden="true"/>;
}
