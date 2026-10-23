export function BuildingNumberPlate({ number, prefix }: Readonly<{ number: string; prefix: string }>) {
  return <svg className={`district-legend-building prefix-${prefix}`} viewBox="-21 -13 42 26" aria-hidden="true">
    <path d="M-21-13h42v26h-42z" />
    <text x="0" y="4" textAnchor="middle">{number}</text>
  </svg>;
}
