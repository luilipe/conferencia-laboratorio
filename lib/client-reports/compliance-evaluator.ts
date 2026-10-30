import type { LabResult, ReferenceRule, ReportValue } from './types.ts';
import { normalizeParameter, normalizeUnit } from './values.ts';

export type ComplianceEvaluation = {
  parameter: string;
  pointId: string | null;
  valueStr: string;
  limitStr: string;
  situation: 'Conforme' | 'Não conforme' | 'Não avaliado';
  referenceSource: string;
  isCompliant: boolean | null;
};

export type LegalStandard = {
  parameter: string;
  aliases: string[];
  unit: string;
  min: number | null;
  max: number | null;
  systemTypes: ('industrial' | 'sanitary' | 'water')[];
  legalSource: string;
  ruleLabel: string;
};

/** Validated legal standards for industrial/sanitary effluent and drinking water */
export const VALIDATED_LEGAL_STANDARDS: LegalStandard[] = [
  // Metais e inorgânicos (CONAMA 430/2011 Art. 16 e Decreto SP 8.468/1976 Art. 18)
  { parameter: 'Manganês Dissolvido', aliases: ['Manganês dissolvido', 'manganes dissolvido'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Manganês Total', aliases: ['Manganês', 'manganes total', 'manganes'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'Dec. Estadual 8.468/76 Art. 18', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Mercúrio', aliases: ['Mercúrio', 'mercurio'], unit: 'mg/L', min: null, max: 0.01, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,01 mg/L' },
  { parameter: 'Níquel', aliases: ['Níquel', 'niquel'], unit: 'mg/L', min: null, max: 2.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 2,0 mg/L' },
  { parameter: 'Prata', aliases: ['Prata', 'prata'], unit: 'mg/L', min: null, max: 0.02, systemTypes: ['industrial', 'sanitary'], legalSource: 'Dec. Estadual 8.468/76 Art. 18', ruleLabel: 'VMP 0,02 mg/L' },
  { parameter: 'Chumbo', aliases: ['Chumbo', 'chumbo'], unit: 'mg/L', min: null, max: 0.5, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,5 mg/L' },
  { parameter: 'Cádmio', aliases: ['Cádmio', 'cadmio'], unit: 'mg/L', min: null, max: 0.2, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,2 mg/L' },
  { parameter: 'Cobre Total', aliases: ['Cobre', 'cobre total'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Cobre Dissolvido', aliases: ['cobre dissolvido'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Cromo Total', aliases: ['Cromo', 'cromo total'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Cromo Hexavalente', aliases: ['cromo hexavalente', 'cromo vi'], unit: 'mg/L', min: null, max: 0.1, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,1 mg/L' },
  { parameter: 'Cromo Trivalente', aliases: ['cromo trivalente', 'cromo iii'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Zinco', aliases: ['Zinco', 'zinco'], unit: 'mg/L', min: null, max: 5.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 5,0 mg/L' },
  { parameter: 'Arsênio', aliases: ['Arsênio', 'arsenio'], unit: 'mg/L', min: null, max: 0.5, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,5 mg/L' },
  { parameter: 'Bário', aliases: ['Bário', 'bario'], unit: 'mg/L', min: null, max: 5.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 5,0 mg/L' },
  { parameter: 'Boro', aliases: ['Boro', 'boro'], unit: 'mg/L', min: null, max: 5.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 5,0 mg/L' },
  { parameter: 'Estanho', aliases: ['Estanho', 'estanho'], unit: 'mg/L', min: null, max: 4.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 4,0 mg/L' },
  { parameter: 'Ferro Dissolvido', aliases: ['ferro dissolvido'], unit: 'mg/L', min: null, max: 15.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 15,0 mg/L' },
  { parameter: 'Selênio', aliases: ['Selênio', 'selenio'], unit: 'mg/L', min: null, max: 0.3, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,3 mg/L' },

  // Físico-químicos e agregados
  { parameter: 'DBO', aliases: ['DBO5', 'DBO₅', 'dbo'], unit: 'mg/L', min: null, max: 60.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'Dec. Estadual 8.468/76 Art. 18 / CONAMA 430', ruleLabel: 'VMP 60 mg/L (ou rem. ≥ 60%)' },
  { parameter: 'Sólidos Sedimentáveis', aliases: ['SOLIDOS SEDIMENTAVEIS', 'SÓLIDOS SEDIMENTAVÉIS', 'SS30', 'SS60'], unit: 'mL/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mL/L' },
  { parameter: 'Óleos Minerais', aliases: ['oleos minerais', 'Óleos Minerais '], unit: 'mg/L', min: null, max: 20.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 20 mg/L' },
  { parameter: 'Óleos Vegetais/Gorduras Animais', aliases: ['Óleos Vegetais e Gordura Animal', 'oleos vegetais'], unit: 'mg/L', min: null, max: 50.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 50 mg/L' },
  { parameter: 'Óleos e Graxas', aliases: ['Óleos & Graxas (Substâncias Solúveis em Hexano)', 'ÓLEOS E GRAXAS', 'OLEOS E GRAXAS', 'Óleos e Graxas Totais'], unit: 'mg/L', min: null, max: 100.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'Dec. Estadual 8.468/76 Art. 18', ruleLabel: 'VMP 100 mg/L' },
  { parameter: 'pH', aliases: ['pH (campo)', 'pH á 25°C', 'ph'], unit: '', min: 6.0, max: 9.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'Faixa 6,0 a 9,0' },
  { parameter: 'Temperatura', aliases: ['Temperatura da Amostra', 'Temperatura Ambiente', 'temperatura'], unit: '°C', min: null, max: 40.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: '< 40 °C' },
  { parameter: 'Fluoreto', aliases: ['FLOURETO', 'fluoreto'], unit: 'mg/L', min: null, max: 10.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 10 mg/L' },
  { parameter: 'Sulfeto', aliases: ['sulfeto'], unit: 'mg/L', min: null, max: 1.0, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Sulfato', aliases: ['sulfato'], unit: 'mg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'Dec. Estadual 8.468/76 Art. 19 A', ruleLabel: 'VMP 1000 mg/L' },
  { parameter: 'Cianeto Total', aliases: ['Cianeto total', 'cianeto'], unit: 'mg/L', min: null, max: 0.2, systemTypes: ['industrial', 'sanitary'], legalSource: 'Dec. Estadual 8.468/76 Art. 18', ruleLabel: 'VMP 0,2 mg/L' },
  { parameter: 'Cianeto Livre', aliases: ['cianeto livre'], unit: 'mg/L', min: null, max: 0.2, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,2 mg/L' },
  { parameter: 'Fenóis Totais (Índice de Fenóis)', aliases: ['Fenol Total', 'fenois totais'], unit: 'mg/L', min: null, max: 0.5, systemTypes: ['industrial', 'sanitary'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 0,5 mg/L' },

  // Compostos Orgânicos Voláteis (VOCs)
  { parameter: 'Benzeno', aliases: ['benzeno'], unit: 'µg/L', min: null, max: 1200.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,2 mg/L' },
  { parameter: 'Tolueno', aliases: ['tolueno'], unit: 'µg/L', min: null, max: 1200.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,2 mg/L' },
  { parameter: 'Xilenos (Total)', aliases: ['Xilenos', 'xilenos'], unit: 'µg/L', min: null, max: 1600.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,6 mg/L' },
  { parameter: 'Clorofórmio', aliases: ['cloroformio'], unit: 'µg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Tricloroeteno', aliases: ['tricloroeteno'], unit: 'µg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Tetracloreto de Carbono', aliases: ['tetracloreto de carbono'], unit: 'µg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Estireno', aliases: ['estireno'], unit: 'µg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },
  { parameter: 'Etilbenzeno', aliases: ['etilbenzeno'], unit: 'µg/L', min: null, max: 1000.0, systemTypes: ['industrial'], legalSource: 'CONAMA 430/2011 Art. 16', ruleLabel: 'VMP 1,0 mg/L' },

  // Água Tratada / Potabilidade (Portaria GM/MS 888/2021)
  { parameter: 'CLORO RESIDUAL LIVRE', aliases: ['Cloro', 'Cloro residual livre', 'cloro'], unit: 'mg/L', min: 0.2, max: 2.0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: '0,2 a 2,0 mg/L' },
  { parameter: 'TURBIDEZ', aliases: ['Turbidez', 'turbidez'], unit: 'uT', min: null, max: 5.0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: 'VMP 5,0 uT' },
  { parameter: 'COR APARENTE', aliases: ['Cor', 'Cor aparente', 'cor'], unit: 'uH', min: null, max: 15.0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: 'VMP 15 uH' },
  { parameter: 'ESCHERICHIA COLI', aliases: ['Escherichia coli', 'E. coli', 'coli'], unit: '', min: null, max: 0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: 'Ausência em 100 mL' },
  { parameter: 'COLIFORMES TOTAIS', aliases: ['Coliformes totais'], unit: '', min: null, max: 0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: 'Ausência em 100 mL' },
  { parameter: 'C ontagem de bactérias heterotróficas', aliases: ['Bactérias heterotróficas', 'bacterias heterotroficas'], unit: 'UFC/mL', min: null, max: 500.0, systemTypes: ['water'], legalSource: 'Portaria GM/MS 888/2021', ruleLabel: 'VMP 500 UFC/mL' }
];

function matchLegalStandard(parameter: string, systemType: 'industrial' | 'sanitary' | 'water'): LegalStandard | null {
  const norm = normalizeParameter(parameter).trim().toLowerCase();
  for (const std of VALIDATED_LEGAL_STANDARDS) {
    if (!std.systemTypes.includes(systemType)) continue;
    if (std.parameter.toLowerCase() === norm || std.aliases.some(a => a.toLowerCase() === norm)) {
      return std;
    }
  }
  return null;
}

export function evaluateLabResultCompliance(
  result: LabResult,
  systemType: 'industrial' | 'sanitary' | 'water',
  customReferences: ReferenceRule[] = []
): ComplianceEvaluation {
  const pNorm = normalizeParameter(result.parameter);
  const point = result.pointId ?? '';
  const isTreated = /tratad|saida|saída|consumo/i.test(point) || point === 'tratado';
  const isRaw = /bruto|entrad|equaliz/i.test(point) || point === 'bruto';

  // Format value string
  const val = result.value;
  let valStr = val.raw;
  if (val.value !== null) {
    const formattedNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 5 }).format(val.value);
    valStr = `${val.operator && val.operator !== '=' ? val.operator + ' ' : ''}${formattedNum}${val.unit ? ' ' + val.unit : ''}`;
  } else if (val.qualitative) {
    valStr = val.qualitative;
  }

  // Check custom references approved for this station first
  const custom = customReferences.find(r => r.approvedByUid && normalizeParameter(r.parameter) === pNorm && (!r.pointId || r.pointId === point));
  if (custom) {
    let compliant = true;
    if (val.value !== null) {
      if (custom.max !== null && val.value > custom.max) compliant = false;
      if (custom.min !== null && val.value < custom.min) compliant = false;
    }
    const limitParts: string[] = [];
    if (custom.min !== null) limitParts.push(`mín ${custom.min}`);
    if (custom.max !== null) limitParts.push(`máx ${custom.max}`);
    const limitStr = `${limitParts.join(' a ')} ${custom.unit} (${custom.source})`;
    return {
      parameter: result.parameter,
      pointId: result.pointId,
      valueStr: valStr,
      limitStr,
      situation: compliant ? 'Conforme' : 'Não conforme',
      referenceSource: custom.source,
      isCompliant: compliant
    };
  }

  // For raw inlet (efluente bruto / entrada), legal discharge limits apply to treated output,
  // so mark it clearly as raw influent characterization
  if (isRaw) {
    return {
      parameter: result.parameter,
      pointId: result.pointId,
      valueStr: valStr,
      limitStr: '— (Monitoramento de entrada)',
      situation: 'Não avaliado',
      referenceSource: 'Caracterização de efluente bruto',
      isCompliant: null
    };
  }

  // Look up validated legal standard
  const std = matchLegalStandard(result.parameter, systemType);
  if (!std) {
    return {
      parameter: result.parameter,
      pointId: result.pointId,
      valueStr: valStr,
      limitStr: '—',
      situation: 'Não avaliado',
      referenceSource: 'Critério legal a homologar',
      isCompliant: null
    };
  }

  // Determine compliance
  let compliant = true;
  if (val.value !== null) {
    // If operator is < or <=, value represents detection/quantification limit
    if (val.operator === '<' || val.operator === '<=') {
      if (std.max !== null && val.value > std.max) {
        compliant = false;
      }
    } else {
      if (std.max !== null && val.value > std.max) {
        compliant = false;
      }
      if (std.min !== null && val.value < std.min) {
        compliant = false;
      }
    }
  } else if (val.qualitative) {
    if (/aus[eê]ncia/i.test(std.ruleLabel)) {
      compliant = /aus[eê]nte|aus[eê]ncia/i.test(val.qualitative);
    }
  }

  return {
    parameter: result.parameter,
    pointId: result.pointId,
    valueStr: valStr,
    limitStr: `${std.ruleLabel} (${std.legalSource})`,
    situation: compliant ? 'Conforme' : 'Não conforme',
    referenceSource: std.legalSource,
    isCompliant: compliant
  };
}

export function determineSystemType(clientId: string, stationId: string): 'industrial' | 'sanitary' | 'water' {
  if (clientId === 'demo14' || /eta|agua|po[cç]o/i.test(stationId)) return 'water';
  if (stationId === 'biologico' || /sanit[aá]r|biolog/i.test(stationId)) return 'sanitary';
  return 'industrial';
}
