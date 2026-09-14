export const SUBSTANCE_PRESENTATION: Readonly<Record<string, Readonly<{ formula: string; un: string }>>> = {
  acrolein: { formula: 'C₃H₄O', un: '' },
  'ammonia-pressurized': { formula: 'NH₃', un: '1005' },
  'ammonia-isothermal': { formula: 'NH₃', un: '1005' },
  acetonitrile: { formula: 'CH₃CN', un: '1648' },
  'acetone-cyanohydrin': { formula: 'C₄H₇NO', un: '1541' },
  arsine: { formula: 'AsH₃', un: '2188' },
  'hydrogen-fluoride': { formula: 'HF', un: '1052' },
  'hydrogen-chloride': { formula: 'HCl', un: '1050' },
  'hydrogen-bromide': { formula: 'HBr', un: '1048' },
  'hydrogen-cyanide': { formula: 'HCN', un: '1051' },
  dimethylamine: { formula: '(CH₃)₂NH', un: '1032' },
  methylamine: { formula: 'CH₃NH₂', un: '1061' },
  'methyl-bromide': { formula: 'CH₃Br', un: '1062' },
  'methyl-chloride': { formula: 'CH₃Cl', un: '1063' },
  'methyl-acrylate': { formula: 'C₄H₆O₂', un: '1919' },
  'methyl-mercaptan': { formula: 'CH₃SH', un: '1064' },
  acrylonitrile: { formula: 'C₃H₃N', un: '1093' },
  'nitrogen-oxides': { formula: 'NOₓ', un: '' },
  'ethylene-oxide': { formula: 'C₂H₄O', un: '1040' },
  'sulfur-dioxide': { formula: 'SO₂', un: '1079' },
  'hydrogen-sulfide': { formula: 'H₂S', un: '1053' },
  'carbon-disulfide': { formula: 'CS₂', un: '1131' },
  'hydrochloric-acid': { formula: 'HCl', un: '1789' },
  trimethylamine: { formula: '(CH₃)₃N', un: '1083' },
  formaldehyde: { formula: 'CH₂O', un: '2209' },
  phosgene: { formula: 'COCl₂', un: '1076' },
  fluorine: { formula: 'F₂', un: '1045' },
  'phosphorus-trichloride': { formula: 'PCl₃', un: '1809' },
  'phosphoryl-chloride': { formula: 'POCl₃', un: '1810' },
  chlorine: { formula: 'Cl₂', un: '1017' },
  chloropicrin: { formula: 'CCl₃NO₂', un: '1580' },
  'cyanogen-chloride': { formula: 'CNCl', un: '1589' },
  ethyleneimine: { formula: 'C₂H₅N', un: '1185' },
  'ethylene-sulfide': { formula: 'C₂H₄S', un: '' },
  'ethyl-mercaptan': { formula: 'C₂H₅SH', un: '2363' }
};

export function substanceFormula(id: string): string {
  return SUBSTANCE_PRESENTATION[id]?.formula ?? 'АХОВ';
}

export function substanceUnNumber(id: string): string {
  const value = SUBSTANCE_PRESENTATION[id]?.un;
  return value === undefined || value.length === 0 ? 'ОГ' : value;
}
