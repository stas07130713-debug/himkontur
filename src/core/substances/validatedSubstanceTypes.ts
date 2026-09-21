export type QualityStatus =
  | 'verified'
  | 'verified_two_sources'
  | 'single_source'
  | 'conflict'
  | 'manual_review_required'
  | 'not_available'
  | 'legacy'
  | 'deprecated';

export type SourcePurpose = 'identity' | 'individual-profile' | 'transport' | 'rail-emergency';

export type SourceReference = Readonly<{
  id: string;
  title: string;
  organization: string;
  url: string;
  edition: string;
  accessedAt: string;
  purpose: SourcePurpose;
}>;

export type SourcedValue<T> = Readonly<{
  value: T | null;
  sourceIds: readonly string[];
  status: QualityStatus;
  verifiedAt: string;
}>;

export type ChemicalEntity = Readonly<{
  id: string;
  name: SourcedValue<string>;
  casNumber: SourcedValue<string>;
  formula: SourcedValue<string>;
  synonyms: SourcedValue<readonly string[]>;
}>;

export type ProductForm = Readonly<{
  id: string;
  chemicalId: string;
  displayName: SourcedValue<string>;
  physicalForm: SourcedValue<string>;
  concentration: SourcedValue<string>;
  isAnhydrous: boolean;
  isSolution: boolean;
  isRefrigeratedLiquid: boolean;
}>;

export type TransportEntry = Readonly<{
  id: string;
  productFormId: string;
  unNumber: SourcedValue<string>;
  officialTransportName: SourcedValue<string>;
  hazardClass: SourcedValue<string>;
  classificationCode: SourcedValue<string>;
  kemlerCode: SourcedValue<string>;
  packingGroup: SourcedValue<string>;
  hazardLabels: SourcedValue<readonly string[]>;
  specialProvisions: SourcedValue<readonly string[]>;
}>;

export type EmergencyProfile = Readonly<{
  productFormId: string;
  mainProperties: SourcedValue<readonly string[]>;
  fireExplosionHazards: SourcedValue<readonly string[]>;
  healthHazards: SourcedValue<readonly string[]>;
  exposureRoutes: SourcedValue<readonly string[]>;
  ppe: SourcedValue<readonly string[]>;
  emergencyActions: SourcedValue<readonly string[]>;
  consequenceControl: SourcedValue<Readonly<{ operation: 'neutralization' | 'containment' | 'absorption' | 'dilution' | 'controlled_dispersion' | 'collection' | 'disposal' | 'no_neutralization'; actions: readonly string[] }>>;
  firstAid: SourcedValue<readonly string[]>;
  flags: Readonly<{
    isCryogenic: boolean;
    isToxicGas: boolean;
    isCorrosive: boolean;
    isOxidizer: boolean;
    isFlammable: boolean;
    isExplosive: boolean;
    isWaterReactive: boolean;
    isEnvironmentalHazard: boolean;
    isAsphyxiant: boolean;
  }>;
}>;

export type TransportInstructions = Readonly<{
  transportEntryId: string;
  road: SourcedValue<readonly string[]>;
  rail: SourcedValue<Readonly<{ emergencyCardNumber: string; cardType: 'individual' | 'group'; instructions: readonly string[] }>>;
}>;

export type ValidatedSubstanceRecord = Readonly<{
  schemaVersion: 2;
  recordId: string;
  recordStatus: QualityStatus;
  chemical: ChemicalEntity;
  productForm: ProductForm;
  transport: TransportEntry;
  emergency: EmergencyProfile;
  transportInstructions: TransportInstructions;
  sources: readonly SourceReference[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
  verifiedBy: string;
  sourceVersion: string;
  changeReason: string;
}>;

export type SubstanceValidationIssue = Readonly<{
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  code: string;
  message: string;
  path?: string;
}>;

export type SubstanceValidationResult = Readonly<{
  validForPublication: boolean;
  issues: readonly SubstanceValidationIssue[];
}>;
