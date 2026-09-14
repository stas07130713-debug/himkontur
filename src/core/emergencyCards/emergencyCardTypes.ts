export type ExposureRoutes = Readonly<{
  inhalation: boolean;
  ingestion: boolean;
  skin: boolean;
  eyes: boolean;
}>;

export type EmergencyCardSource = Readonly<{
  document: string;
  revision: string;
  effectiveDate: string;
  sourceReference: string;
  sourceUrl: string;
  amendmentProtocol: string | null;
  amendmentUrl?: string | null;
}>;

export type EmergencyCard = Readonly<{
  cardNumber: string;
  title: string;
  mainProperties: string | null;
  fireExplosionHazard: string | null;
  humanHazard: Readonly<{
    description: string | null;
    exposureRoutes: ExposureRoutes;
    symptoms: string | null;
  }>;
  ppe: Readonly<{
    respiratory: string | null;
    skin: string | null;
    eyes: string | null;
    other: string | null;
  }>;
  actions: Readonly<{
    general: string | null;
    leakOrSpill: string | null;
    fire: string | null;
  }>;
  neutralization: string | null;
  firstAid: string | null;
  source: EmergencyCardSource;
}>;

export type SubstanceProfileSource = Readonly<{
  id: string;
  type: 'emergency-card' | 'substance-properties' | 'emergency-response';
  title: string;
  edition: string;
  url: string;
}>;

export type SubstanceSpecificProfile = Readonly<{
  un: string;
  name: string;
  aliases: readonly string[];
  emergencyCardNumber: string;
  mainProperties: readonly string[];
  fireExplosionHazard: readonly string[];
  humanHazard: readonly string[];
  exposureRoutes: readonly string[];
  hazardMarker: string | null;
  ppe: readonly string[];
  ppeWarning: string | null;
  specificActions: readonly string[];
  responseSectionTitle: string;
  responseActions: readonly string[];
  firstAid: readonly string[];
  critical: readonly string[];
  sources: readonly SubstanceProfileSource[];
}>;

export type DangerousGoodIndexEntry = Readonly<{
  un: string;
  name: string;
  emergencyCardNumber: string;
  classificationCode?: string | null;
}>;

export type EmergencyCardsMeta = Readonly<{
  databaseVersion: string;
  effectiveDate: string;
  description: string;
  sourceDocument: string;
  sourceUrl: string;
  amendmentProtocol: string;
  amendmentUrl: string;
}>;

export type EmergencyCardsDatabase = Readonly<{
  index: readonly DangerousGoodIndexEntry[];
  cards: readonly EmergencyCard[];
  profiles?: readonly SubstanceSpecificProfile[];
  meta: EmergencyCardsMeta;
}>;

export type EmergencyCardLookupResult = Readonly<{
  un: string;
  name: string;
  cardNumber: string;
  card: EmergencyCard;
  cardType: 'individual' | 'group';
  cardUNNumbers: readonly string[];
  profile?: SubstanceSpecificProfile;
}>;

export type ValidationIssue = Readonly<{ code: string; message: string; path?: string }>;
export type EmergencyCardsValidationReport = Readonly<{
  databaseVersion: string;
  totalUN: number;
  totalCards: number;
  errors: readonly ValidationIssue[];
  warnings: readonly ValidationIssue[];
  orphanCards: readonly string[];
  missingCards: readonly string[];
  duplicateUN: readonly string[];
  ocrSuspiciousFragments: readonly string[];
}>;
