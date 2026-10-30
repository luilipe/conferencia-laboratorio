export type ReportClientId =
  | "demo13"
  | "demo24"
  | "demo08"
  | "demo09"
  | "demo14"
  | "demo02"
  | "demo01"
  | "demo23"
  | "demo25"
  | "demo26"
  | "demo27"
  | "demo18"
  | "demo15"
  | "demo16"
  | "demo17"
  | "demo19"
  | "demo20"
  | "demo21"
  | "demo22"
  | "demo03"
  | "demo04"
  | "demo05"
  | "demo06"
  | "demo07"
  | "demo10"
  | "demo11"
  | "demo12"
  | (string & {});
export type MeasurementStatus = "measured" | "missing" | "invalid" | "not_applicable";
export type ReportValue = { raw: string; value: number | null; operator: "=" | "<" | "<=" | ">" | ">=" | null; qualitative: string | null; unit: string; originalUnit: string; status: MeasurementStatus };
export type SourceRef = { sourceId: string; sheet?: string; cell?: string; page?: number; authorUid?: string; reason?: string; photoId?: string; region?: string; externalRecordId?: string };
export type SourceInfo = { id: string; name: string; sha256: string; kind: "lab" | "operations" | "history" | "reference" | "manual"; size: number; importedAt: string; importedByUid: string; adapterVersion: string; originalText?: string; reviewedText?: string; verificationNotes?: string[] };
export type LabResult = { id: string; labId: string; sampleBase: string; revision: number; sampleNumber: string; stationId: string | null; pointId: string | null; identification: string; company: string; date: string; time: string | null; publicationDate: string | null; parameter: string; value: ReportValue; source: SourceRef; datePrecision?: 'day'|'month'; collectionPeriod?: string; declaredReference?: string; campaignId?: string; modelAlternativeGroup?: string };
export type LabComparisonSelection = { version: 1; previousMonths: 0|1|2|3 };
export type ModelResultSource = Pick<SourceInfo,'id'|'name'|'sha256'|'kind'|'size'|'adapterVersion'|'verificationNotes'>;
export type ModelResultEntry = {clientId:ReportClientId;stationId:string;period:string;sources:ModelResultSource[];records:LabResult[];issues:ReportIssue[]};
export type ModelResultsCatalog = {format:'ouro-fino.normalized-model-results';version:1;entries:ModelResultEntry[]};
export type LabComparison = {months:string[];currentIds:string[];historicalIds:string[];tables:ReportTable[];origins:ReportTable;issues:ReportIssue[]};
export type OperationReading = { id: string; stationId: string; pointId: string; date: string; time: string | null; shift: string | null; treatment: string | null; parameter: string; value: ReportValue; source: SourceRef };
export type MeterReading = { id: string; meterId: string; date: string; time: string | null; cumulative: ReportValue; declaredIntervalVolume: ReportValue | null; source: SourceRef; intervalStart?: string; intervalEnd?: string };
export type SupplyEvent = { id: string; stationId: string; date: string; kind: "delivery" | "consumption"; product: string; quantity: ReportValue; source: SourceRef };
export type JournalEntry = { id: string; date: string; shift: string; order: number; text: string; plantState: "on" | "off" | "unknown"; source: SourceRef };
export type ReportIssue = { id: string; code: string; severity: "blocker" | "warning"; message: string; recordIds: string[]; acknowledgedByUid: string | null; acknowledgement: string | null };
export type ReportMapping = { labId: string; companyAlias: string; identification: string; stationId: string; pointId: string };
export type ImportContext = { clientId: ReportClientId; period: string; actorUid: string; importedAt: string; stationId?: string; mappings?: ReportMapping[]; selectedSheets?: string[]; demo?: boolean };
export type ImportBatch = { sources: SourceInfo[]; lab: LabResult[]; operations: OperationReading[]; meters: MeterReading[]; supplies: SupplyEvent[]; journal: JournalEntry[]; issues: ReportIssue[] };
export type ReportIdentity = { clientDisplayName: string; facilityName: string; requesterName: string; taxId: string; address: string; responsibleName: string; responsibleRegistration: string; issueDate: string; postalCode?:string; city?:string; state?:string; phone?:string; stateRegistration?:string };
export type IdentityField = keyof Omit<ReportIdentity,"issueDate">;
export type ReportModelLayout = {cover?:{yearMarker:'period-year';monthMarker:'period-month';clientLogo:string};font:string;bodySize:number;coverTitle:string;titleLines?:string[];issuePlace?:string;presentationBeforeToc?:boolean;continuousSections?:string[];layoutRevision?:number;footer:string[];margins:{top:number;bottom:number;left:number;right:number};headingSizes?:Record<string,number>};
export type FixedModelText = {laboratoryTables?:{pointId:string;title:string;columns:string[];rows:string[][]}[];layout?:ReportModelLayout;monthlySections?:string[];monthlyRequirements?:Record<string,'required'|'conditional'>;source:{fileName:string;sha256:string};sections:{id:string;title:string;paragraphs:string[];blockIds?:string[]}[]};
export type IdentitySeed = {clientId:ReportClientId;stationId:string;identity:Partial<Omit<ReportIdentity,"issueDate">>;source:{fileName:string;sha256:string};pendingFields:IdentityField[];fixedText?:FixedModelText};
export type IdentityCatalog = {format:"ouro-fino.report-identities";version:1;entries:IdentitySeed[]};
export type IdentityFieldChoice = {field:IdentityField;apply:boolean};
export type ReferenceRule = { id: string; parameter: string; pointId: string; unit: string; min: number | null; max: number | null; source: string; version: string; application: string; approvedByUid: string | null };
export type ClientReportDraft = { editorial?:ReportEditorial; editorialModel?:EditorialModel; aiOrigin?:ReportAiOrigin; id: string; clientId: ReportClientId; stationId: string; period: string; presetVersion: string; revision: number; conclusionState?:ConclusionState; documentRendererVersion?:"3"|"4"; fixedText?:FixedModelText; identity: ReportIdentity; data: ImportBatch; selection: { labComparison?: LabComparisonSelection; optionalChartIds?:string[]; selectedLabIds: string[]; excludedRecordIds: string[]; efficiencyPairs: { parameter: string; inletId: string; outletId: string; declaredId: string | null }[]; meterBaselines: Record<string, MeterReading> }; narratives: { presentation: string; observations: string; conclusion: string; methodology?:string; methodologySource?:string }; references: ReferenceRule[]; acknowledgements: Record<string, { actorUid: string; reason: string }>; corrections: { originalId: string; replacementId: string; actorUid: string; at: string; reason: string }[] };
export type ReportChartDefinition = {id:string;title:string;kind:'line'|'bar';source:'laboratory'|'operations'|'efficiency'|'meters';parameter:string;unit:string|null;pointIds:string[];optional:boolean};
export type ReportPreset = { clientId: ReportClientId; stationId: string; version: string; label: string; requiredSections: string[]; optionalSections: string[]; points: { id: string; label: string }[]; parameters: string[]; enabled: boolean; requiredSources: string[];sectionOrder?:string[];chartDefinitions?:ReportChartDefinition[];sourceBlocks?:Record<string,string[]> };
export type ReportTable = { id: string; title: string; columns: string[]; rows: string[][]; sourceIds: string[] };
export type ReportChart = { id: string; title: string; unit: string;kind?:'line'|'bar';xMode?:'date'|'date-time'|'category';xLabel?:string; series: { id?:string; label: string;reference?:boolean; points: { date: string; value: number | null;key?:string;label?:string;sourceIds?:string[];time?:string|null;shift?:string|null;treatment?:string|null;displayValue?:string }[] }[] };
export type PreparedChart = {kind:'line'|'bar';xMode:'date'|'date-time'|'category';slots:{key:string;label:string;position:number}[];min:number;max:number;series:{id:string;label:string;reference?:boolean;values:(number|null)[];sourceIds:string[][]}[]};
export type ReportSection = { id: string; title: string; orientation: "portrait" | "landscape"; paragraphs: string[]; tables: ReportTable[]; charts: ReportChart[] };
export type ReportDocument = { editorial?:ReportEditorial; modelLayout?:ReportModelLayout; id: string; clientId: ReportClientId; stationId: string; period: string; revision: number; presetVersion: string; rendererVersion: string; mode: "draft" | "finalized"; identity: ReportIdentity; sections: ReportSection[]; sources: SourceInfo[]; issues: ReportIssue[] };
export type MeterInterval = { meterId: string; fromDate: string | null; toDate: string; volume: number | null; unit: string; sourceIds: string[] };
export type SupplyTotal = { product: string; kind: "delivery" | "consumption"; unit: string; quantity: number; sourceIds: string[] };
export type ReportClientSettings = { technicalApproverUid?:string; enabledRendererVersions?:Record<string,string[]>; editorialModels?:Record<string,EditorialModel>; clientId: ReportClientId; identities: Record<string, Omit<ReportIdentity, "issueDate">>; mappings: ReportMapping[]; enabledPresetVersions: string[]; references: ReferenceRule[]; updatedByUid: string; identitySources?:Record<string,{fileName:string;sha256:string;fields:IdentityField[];importedByUid:string;importedAt:string}[]>; labComparisonPreferences?:Record<string,LabComparisonSelection>; enabledOptionalCharts?:Record<string,string[]> };
export type ConclusionState = {dataKey:string;reviewed:boolean;stale?:boolean};
export type ReviewMeta = { actorUid: string; actorName: string; acceptedWarnings: { issueId: string; reason: string }[] };
export type ReportSummary = { id: string; clientId: ReportClientId; stationId: string; period: string; revision: number; currentVersionId: string; status: "draft" | "finalized"; updatedAt: string };
export type ReportVersionSummary = { sha256?:string; reportId: string; versionId: string; revision: number; status: "writing" | "draft" | "finalized"; createdAt: string; createdByUid: string; review: ReviewMeta | null; reviewedAt?: string };
export type StoredReportSnapshot = { draft: ClientReportDraft; document: ReportDocument; version: ReportVersionSummary };
export type SerializedSnapshot = { chunks: { sequence: number; payload: string; sha256: string }[]; sha256: string; totalBytes: number };
export type PhotoOrigin = { foto_id: string; regiao: string | null; legibilidade: "legivel" | "parcial" | "ilegivel" };
export type PhotoDated = { id: string; data: string | null; data_original: string | null; origem_data: "foto" | "foto_e_contexto" | "usuario" | "nao_definida"; origem: PhotoOrigin };
export type PhotoTimed = PhotoDated & { turno: string; hora: string | null };
export type GlobePhotoPackage = {
  formato: "ouro-fino.demo01.fotos"; versao: 1; somente_exemplo: boolean; cliente: "demo01"; estacao: "ete"; competencia: string; lote_id: string; revisao: number;
  fotos: { id: string; arquivo: string | null; descricao: string }[];
  observacoes: (PhotoTimed & { ordem: number; texto_original: string; texto_relatorio: string; estado_ete: "ligada" | "desligada" | "nao_informado" })[];
  medicoes: (PhotoTimed & { ponto_original: string | null; parametro_original: string | null; valor_original: string | null; unidade_original: string | null })[];
  hidrometros: (PhotoTimed & { hidrometro_original: string | null; tipo: "leitura_acumulada" | "volume_informado" | "nao_definido"; valor_original: string | null; unidade_original: string | null; inicio_intervalo: string | null; fim_intervalo: string | null })[];
  insumos: (PhotoTimed & { produto_original: string | null; tipo: "entrega" | "consumo" | "nao_definido"; quantidade_original: string | null; unidade_original: string | null })[];
  resultados_laboratoriais: (PhotoDated & { laboratorio_original: string | null; laudo_original: string | null; amostra_original: string | null; revisao_laudo: number | null; ponto_original: string | null; parametro_original: string | null; resultado_original: string | null; unidade_original: string | null })[];
  confirmacoes: { id: string; registro_id: string; campo: string; valor_confirmado: string; observacao: string }[];
  pendencias: { id: string; registro_id: string | null; foto_id: string | null; campo: string | null; descricao: string }[];
};
export type PreparedGlobePhotoImport = { package: GlobePhotoPackage; batch: ImportBatch; pendingRecordIds: string[] };
export type GlobePhotoChangeSet = { kind: "new" | "duplicate" | "update" | "conflict"; addedIds: string[]; changedIds: string[]; removedIds: string[]; issues: ReportIssue[] };
export type ReportFinding = {id:string;text:string;evidenceIds:string[]};
export type ReportAction = {id:string;findingId:string;proposal:string;responsible:string|null;dueDate:string|null;status:'proposed'|'agreed'|'completed';evidenceIds:string[]};
export type ReportEditorial = {version:'1';summary:ReportFinding[];actions:ReportAction[];scope:string;limitations:string[]};
export type EditorialModel = {version:'1';sections:{id:string;title:string;paragraphs:string[]}[];sourceHash:string;approvedByUid?:string;approvedAt?:string};
export type NarrativeEvidence = {id:string;kind:'result'|'calculation'|'reference'|'event'|'gap';text:string;sourceIds:string[]};
export type NarrativeContext = { inputKey?:string;clientId:ReportClientId;stationId:string;period:string;evidence:NarrativeEvidence[];instructionsVersion:'1'};
export type NarrativeSuggestion = {conclusion:string;summary:ReportFinding[];actions:ReportAction[];limitations:string[];claims:{text:string;evidenceIds:string[]}[]};
export type ReportAiOrigin = {generationId:string;sourceVersionId:string;contextHash:string;model:string;promptVersion:string};
export type ReportServiceRequest = {reportId:string;versionId:string;expectedSha256:string};
