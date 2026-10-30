"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ChartNoAxesColumnIncreasing,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderClock,
  History,
  ListChecks,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  CircleHelp,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  UploadCloud,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CORPORATE_EMAIL_DOMAIN,
  CORPORATE_EMAIL_SUFFIX,
  isCorporateEmail,
  normalizeEmail,
} from "@/lib/auth-policy";
import { firebaseConfigured, getFirebaseServices } from "@/lib/firebase";
import {
  createConference,
  archiveConference,
  listConferences,
  loadConferenceItems,
  loadUserProfile,
  saveItemReview,
} from "@/lib/firestore";
import { parseBillingPdf, parseCollectionFiles } from "@/lib/file-processing";
import {
  CLASSIFICATION_SHORT_LABELS,
  reconcileSamples,
} from "@/lib/reconciliation";
import type {
  Classification,
  ConferenceDraft,
  ConferenceRecord,
  ReconciliationItem,
  ReviewDecision,
  UserProfile,
} from "@/lib/types";
import { ComplianceFeature } from "./ComplianceFeature";
import { AnalysisScheduleFeature } from "./AnalysisScheduleFeature";
import { ClientReportsFeature } from "./client-reports/ClientReportsFeature";

type View = "dashboard" | "new" | "result" | "history" | "compliance" | "analysis-schedule" | "client-reports";
type AuthState = "loading" | "anonymous" | "authenticated";
type Theme = "light" | "dark";

const CURRENCY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const NUMBER = new Intl.NumberFormat("pt-BR");

const TUTORIAL_STORAGE_PREFIX = "conferencia-laboratorial:tutorial:v1:";
const THEME_STORAGE_KEY = "conferencia-laboratorial:theme";
const SIDEBAR_STORAGE_KEY = "conferencia-laboratorial:sidebar";

type TutorialStep = {
  title: string;
  text: string;
};

type FeatureTutorial = {
  label: string;
  title: string;
  description: string;
  steps: TutorialStep[];
};

const FEATURE_TUTORIALS: Record<View, FeatureTutorial> = {
  "client-reports": {
    label: "Relatórios de clientes",
    title: "Prepare e revise o relatório mensal",
    description: "Conserve a origem dos dados e confira o documento antes de emitir.",
    steps: [
      { title: "Escolha cliente e mês", text: "Inicie um dos oito modelos ou retome uma versão no histórico." },
      { title: "Importe e confira", text: "Envie as fontes conhecidas, use entrada manual ou importe o TXT das fotos da Demo01. Resolva pontos, unidades e pendências." },
      { title: "Salve e revise", text: "Revise textos, cálculos e prévia. Salve a versão e registre a revisão técnica; modelos sem homologação emitem rascunhos." },
      { title: "Baixe os arquivos", text: "Word, PDF e Excel usam a mesma versão. Correções em versões salvas criam uma nova versão e preservam a anterior." },
    ],
  },
  dashboard: {
    label: "Resumo do faturamento",
    title: "Acompanhe o trabalho sem perder tempo",
    description: "Veja o que está em andamento, o que precisa de decisão e acesse rapidamente as atividades recentes.",
    steps: [
      { title: "Leia os indicadores", text: "Os cartões resumem conferências abertas, pendências, itens conciliados e revisões concluídas." },
      { title: "Comece uma conferência", text: "Use o botão Nova conferência para enviar o PDF da medição e as planilhas de coleta." },
      { title: "Retome de onde parou", text: "Abra uma atividade recente ou consulte todo o histórico pelo menu lateral." },
    ],
  },
  new: {
    label: "Conferir faturamento",
    title: "Cruze cobrança e coletas em poucos passos",
    description: "Prepare os arquivos e deixe o sistema separar automaticamente os itens que exigem revisão.",
    steps: [
      { title: "Identifique a medição", text: "Informe competência, fornecedor e, se necessário, o número da medição." },
      { title: "Envie os arquivos", text: "Adicione um PDF de cobrança e uma ou mais planilhas Excel com as coletas." },
      { title: "Confira os arquivos", text: "Revise os nomes exibidos e remova qualquer arquivo incorreto antes de processar." },
      { title: "Processe e revise", text: "O cruzamento ocorre no navegador e o resultado destaca somente as divergências." },
    ],
  },
  result: {
    label: "Resultado",
    title: "Resolva somente o que precisa de decisão",
    description: "Use os filtros para localizar divergências, comparar as fontes e registrar uma decisão auditável.",
    steps: [
      { title: "Filtre os resultados", text: "Alterne entre todos os itens, pendentes e categorias de divergência." },
      { title: "Abra um item", text: "Compare cobrança e coleta lado a lado, incluindo origem e valores encontrados." },
      { title: "Registre a decisão", text: "Aprove ou conteste com um comentário. O sistema registra responsável e horário." },
    ],
  },
  history: {
    label: "Conferências anteriores",
    title: "Encontre e reabra conferências anteriores",
    description: "Consulte o resultado, o progresso e o responsável de cada conferência em um único lugar.",
    steps: [
      { title: "Localize a conferência", text: "Use a busca para filtrar por medição, fornecedor, competência ou responsável." },
      { title: "Entenda o status", text: "O progresso mostra quantas divergências já foram decididas e quais ainda aguardam revisão." },
      { title: "Abra ou remova", text: "Clique na linha para reabrir. Administradores também podem remover registros do histórico." },
    ],
  },
  compliance: {
    label: "Auditoria das análises",
    title: "Audite laudos com as regras aplicáveis",
    description: "Importe os documentos, confirme a identificação e gere uma análise organizada para auditoria.",
    steps: [
      { title: "Adicione os laudos", text: "Envie os PDFs do período que deseja analisar." },
      { title: "Confirme o contexto", text: "Revise cliente, ponto de coleta, datas e demais dados identificados." },
      { title: "Analise e exporte", text: "Confira não conformidades e gere o relatório consolidado quando estiver pronto." },
    ],
  },
  "analysis-schedule": {
    label: "Acompanhar análises",
    title: "Organize publicações e pendências do mês",
    description: "Importe os dados laboratoriais e acompanhe quais análises foram publicadas, parciais ou ainda estão pendentes.",
    steps: [
      { title: "Escolha o mês", text: "Defina a competência que será acompanhada antes de importar os dados." },
      { title: "Importe e valide", text: "Envie a planilha, confira a prévia e corrija alertas de competência antes de confirmar." },
      { title: "Acompanhe o andamento", text: "Consulte os status por cliente e use o resumo pronto para comunicação e acompanhamento." },
    ],
  },
};

export function MvpApp() {
  const [authState, setAuthState] = useState<AuthState>(
    firebaseConfigured ? "loading" : "anonymous",
  );
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured) return;

    let unsubscribe: () => void = () => {};
    let cancelled = false;
    const start = async () => {
      try {
        const { auth, persistenceReady } = getFirebaseServices();
        await persistenceReady;
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
          setProfileChecked(false);
          if (!nextUser) {
            setUser(null);
            setProfile(null);
            setProfileChecked(true);
            setAuthState("anonymous");
            return;
          }

          if (!isCorporateEmail(nextUser.email)) {
            setUser(null);
            setProfile(null);
            setProfileChecked(true);
            setAuthError(
              `Use uma conta corporativa ${CORPORATE_EMAIL_SUFFIX}.`,
            );
            setAuthState("anonymous");
            try {
              await signOut(auth);
            } catch {
              // As regras do Firestore continuam bloqueando a identidade não corporativa.
            }
            return;
          }

          setUser(nextUser);
          setAuthError("");
          if (!nextUser.emailVerified) {
            setProfile(null);
            setProfileChecked(true);
            setAuthState("authenticated");
            return;
          }

          setAuthState("loading");
          try {
            setProfile(await loadUserProfile(nextUser));
          } catch {
            setAuthError(
              "Não foi possível consultar sua autorização no momento. Tente novamente.",
            );
            setProfile(null);
          } finally {
            setProfileChecked(true);
            setAuthState("authenticated");
          }
        });
      } catch {
        setAuthError("Não foi possível iniciar a conexão segura com o Firebase.");
        setAuthState("anonymous");
      }
    };
    void start();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (authState === "loading") return <LoadingScreen />;
  if (!firebaseConfigured) return <FirebaseSetupScreen />;
  if (authState === "anonymous" || !user) return <LoginScreen initialError={authError} />;
  if (!profileChecked) return <LoadingScreen />;
  if (!user.emailVerified) return <EmailVerificationScreen user={user} />;
  if (!profile?.active) {
    return <AccessPendingScreen user={user} profile={profile} error={authError} />;
  }

  return <AuthenticatedApp user={user} profile={profile} />;
}

function AuthenticatedApp({ user, profile }: { user: User; profile: UserProfile }) {
  const [view, setView] = useState<View>("dashboard");
  const [reportsOpened, setReportsOpened] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tutorial, setTutorial] = useState<{ view: View; step: number } | null>(null);
  const [recent, setRecent] = useState<ConferenceRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [pageError, setPageError] = useState("");
  const [activeConference, setActiveConference] = useState<ConferenceRecord | null>(null);
  const [activeItems, setActiveItems] = useState<ReconciliationItem[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ConferenceRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState("");

  useEffect(() => {
    let preferredTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    let preferredSidebarCollapsed = false;

    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") preferredTheme = storedTheme;
      preferredSidebarCollapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
    } catch {
      // A preferência do sistema ainda funciona quando o armazenamento local está bloqueado.
    }

    const timeout = window.setTimeout(() => {
      setTheme(preferredTheme);
      setSidebarCollapsed(preferredSidebarCollapsed);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // A troca continua válida durante a sessão.
      }
      return next;
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // A barra continua recolhível durante a sessão mesmo sem armazenamento local.
      }
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setLoadingRecent(true);
    try {
      setRecent(await listConferences());
      setPageError("");
    } catch {
      setPageError("Não foi possível carregar o histórico de conferências.");
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(`${TUTORIAL_STORAGE_PREFIX}${view}`)) {
          setTutorial({ view, step: 0 });
        }
      } catch {
        // A ajuda continua disponível pelo botão mesmo se o armazenamento estiver bloqueado.
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [view]);

  const navigate = (next: View) => {
    if (next === "client-reports") setReportsOpened(true);
    setView(next);
    setMobileMenu(false);
  };

  const closeTutorial = (completed: boolean) => {
    if (tutorial) {
      try {
        window.localStorage.setItem(
          `${TUTORIAL_STORAGE_PREFIX}${tutorial.view}`,
          completed ? "completed" : "skipped",
        );
      } catch {
        // Fechar o tutorial não depende da persistência local.
      }
    }
    setTutorial(null);
  };

  const openConference = async (conference: ConferenceRecord) => {
    setOpeningId(conference.id);
    try {
      const items = await loadConferenceItems(conference.id);
      setActiveConference(conference);
      setActiveItems(items);
      navigate("result");
      setPageError("");
    } catch {
      setPageError("Não foi possível abrir os itens desta conferência.");
    } finally {
      setOpeningId(null);
    }
  };

  const onCreated = (conference: ConferenceRecord, items: ReconciliationItem[]) => {
    setActiveConference(conference);
    setActiveItems(items);
    setRecent((current) => [conference, ...current]);
    navigate("result");
  };

  const updateActiveConference = (conference: ConferenceRecord) => {
    setActiveConference(conference);
    setRecent((current) =>
      current.map((entry) => (entry.id === conference.id ? conference : entry)),
    );
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || profile.role !== "administrator") return;
    setDeletingId(deleteCandidate.id);
    setPageError("");
    setPageNotice("");
    try {
      await archiveConference(deleteCandidate.id, user, profile);
      setRecent((current) =>
        current.filter((entry) => entry.id !== deleteCandidate.id),
      );
      if (activeConference?.id === deleteCandidate.id) {
        setActiveConference(null);
        setActiveItems([]);
        navigate("history");
      }
      setPageNotice(
        `A conferência ${deleteCandidate.measurementNumber} foi removida do histórico.`,
      );
      setDeleteCandidate(null);
    } catch {
      setPageError(
        "Não foi possível remover esta conferência do histórico. Verifique sua permissão e tente novamente.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const title =
    view === "client-reports"
      ? "Relatórios de clientes"
    : view === "new"
      ? "Nova conferência de faturamento"
      : view === "analysis-schedule"
        ? "Acompanhamento das análises"
      : view === "compliance"
        ? "Auditoria das análises"
      : view === "result"
        ? "Resultado da conferência"
        : view === "history"
          ? "Conferências anteriores"
          : "Resumo do faturamento";

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`} data-theme={theme}>
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><FlaskConical size={22} /></span>
          <span className="brand-copy"><strong>Conferência</strong><small>Laboratorial</small></span>
        </div>
        <button
          className="sidebar-collapse-button"
          type="button"
          aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <span className="nav-section-label">Faturamento</span>
          <NavButton label="Resumo do faturamento" active={view === "dashboard"} icon={<ChartNoAxesColumnIncreasing />} onClick={() => navigate("dashboard")} />
          <button
            className={`sidebar-primary-action ${view === "new" ? "active" : ""}`}
            type="button"
            aria-label="Conferir faturamento"
            data-nav-label="Conferir faturamento"
            onClick={() => navigate("new")}
          >
            <ClipboardCheck size={19} /> <span className="nav-text">Conferir faturamento</span>
          </button>
          <NavButton label="Conferências anteriores" active={view === "history" || view === "result"} icon={<History />} onClick={() => navigate("history")} />
          <span className="nav-section-label">Análises de água</span>
          <NavButton label="Auditoria das análises" active={view === "compliance"} icon={<FileSearch />} onClick={() => navigate("compliance")} />
          <NavButton label="Acompanhar análises" active={view === "analysis-schedule"} icon={<ListChecks />} onClick={() => navigate("analysis-schedule")} />
          <span className="nav-section-label">Relatórios</span>
          <NavButton label="Relatórios de clientes" active={view === "client-reports"} icon={<FileText />} onClick={() => navigate("client-reports")} />
        </nav>
        <div className="sidebar-foot">
          <button className="sidebar-help" type="button" aria-label="Ajuda desta página" data-nav-label="Ajuda desta página" onClick={() => setTutorial({ view, step: 0 })}>
            <CircleHelp size={18} />
            <span className="sidebar-help-copy"><strong>Ajuda</strong><small>Tutorial desta página</small></span>
          </button>
          <div className="user-card" title={sidebarCollapsed ? `${profile.displayName} · ${profile.role === "administrator" ? "Administrador" : "Revisor"}` : undefined}>
            <span className="avatar">{initials(profile.displayName)}</span>
            <span className="user-card-copy">
              <strong>{profile.displayName}</strong>
              <small>{profile.role === "administrator" ? "Administrador" : "Revisor"}</small>
            </span>
            <button
              className="icon-button inverse"
              title="Sair"
              aria-label="Sair"
              onClick={() => void signOut(getFirebaseServices().auth)}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileMenu && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMobileMenu(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileMenu(true)}>
            <Menu size={21} />
          </button>
          <div><span className="eyebrow">{view === "client-reports" ? "RELATÓRIOS MENSAIS" : view === "compliance" || view === "analysis-schedule" ? "ANÁLISES DE ÁGUA" : "FATURAMENTO LABORATORIAL"}</span><h1>{title}</h1></div>
          <button className="topbar-help" onClick={() => setTutorial({ view, step: 0 })} aria-label={`Abrir tutorial: ${FEATURE_TUTORIALS[view].label}`} title="Ajuda e tutorial">
            <CircleHelp size={18} /><span>Ajuda</span>
          </button>
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "Usar modo claro" : "Usar modo escuro"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {view !== "new" && view !== "compliance" && view !== "analysis-schedule" && view !== "client-reports" && (
            <button className="button primary topbar-action" onClick={() => navigate("new")}>
              <Plus size={18} /> Nova conferência
            </button>
          )}
        </header>

        <div className="page-content">
          {pageError && (
            <div className="alert error-alert"><AlertCircle size={18} /><span>{pageError}</span></div>
          )}
          {pageNotice && (
            <div className="alert success-alert"><CheckCircle2 size={18} /><span>{pageNotice}</span></div>
          )}
          {view === "dashboard" && (
            <Dashboard
              recent={recent}
              loading={loadingRecent}
              openingId={openingId}
              onOpen={openConference}
              onNew={() => navigate("new")}
              onHistory={() => navigate("history")}
            />
          )}
          {view === "new" && (
            <NewConferenceView user={user} profile={profile} onCreated={onCreated} onCancel={() => navigate("dashboard")} />
          )}
          {view === "compliance" && (
            <ComplianceFeature user={user} profile={profile} />
          )}
          {view === "analysis-schedule" && (
            <AnalysisScheduleFeature user={user} profile={profile} />
          )}
          {reportsOpened && <div hidden={view !== "client-reports"}><ClientReportsFeature user={user} profile={profile} /></div>}
          {view === "history" && (
            <HistoryView
              recent={recent}
              loading={loadingRecent}
              openingId={openingId}
              deletingId={deletingId}
              canDelete={profile.role === "administrator"}
              onOpen={openConference}
              onDelete={setDeleteCandidate}
            />
          )}
          {view === "result" && activeConference ? (
            <ResultView
              conference={activeConference}
              items={activeItems}
              user={user}
              profile={profile}
              onItemsChange={setActiveItems}
              onConferenceChange={updateActiveConference}
              onBack={() => navigate("dashboard")}
            />
          ) : view === "result" ? (
            <EmptyState icon={<FolderClock />} title="Nenhuma conferência aberta" text="Abra uma conferência no histórico para visualizar seus resultados.">
              <button className="button primary" onClick={() => navigate("history")}>Abrir histórico</button>
            </EmptyState>
          ) : null}
        </div>
      </main>
      {deleteCandidate && (
        <DeleteConferenceDialog
          conference={deleteCandidate}
          busy={deletingId === deleteCandidate.id}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {tutorial && (
        <FeatureTutorialDialog
          tutorial={FEATURE_TUTORIALS[tutorial.view]}
          step={tutorial.step}
          onStepChange={(step) => setTutorial((current) => current ? { ...current, step } : null)}
          onSkip={() => closeTutorial(false)}
          onComplete={() => closeTutorial(true)}
        />
      )}
    </div>
  );
}

function Dashboard({
  recent,
  loading,
  openingId,
  onOpen,
  onNew,
  onHistory,
}: {
  recent: ConferenceRecord[];
  loading: boolean;
  openingId: string | null;
  onOpen: (conference: ConferenceRecord) => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  const totals = useMemo(
    () => ({
      inReview: recent.filter((item) => item.status === "in_review").length,
      pending: recent.reduce((total, item) => total + item.summary.pendingReviews, 0),
      matched: recent.reduce((total, item) => total + item.summary.matchedOk, 0),
      reviewed: recent.filter((item) => item.status === "reviewed").length,
    }),
    [recent],
  );

  return (
    <div className="page-stack">
      <section className="welcome-panel">
        <div>
          <span className="section-kicker">CONTROLE MENSAL</span>
          <h2>Concilie a cobrança com as coletas em poucos minutos.</h2>
          <p>Envie o PDF da medição e todos os lotes Excel. O sistema cruza as amostras e separa apenas o que exige decisão.</p>
        </div>
        <button className="button light" onClick={onNew}>Iniciar conferência <ArrowRight size={18} /></button>
      </section>

      <section className="metric-grid">
        <MetricCard icon={<Clock3 />} tone="amber" label="Em revisão" value={NUMBER.format(totals.inReview)} detail="conferências abertas" />
        <MetricCard icon={<AlertCircle />} tone="red" label="Itens pendentes" value={NUMBER.format(totals.pending)} detail="aguardando decisão" />
        <MetricCard icon={<CheckCircle2 />} tone="green" label="Itens conciliados" value={NUMBER.format(totals.matched)} detail="sem divergência" />
        <MetricCard icon={<ShieldCheck />} tone="blue" label="Concluídas" value={NUMBER.format(totals.reviewed)} detail="revisões finalizadas" />
      </section>

      <section className="content-card">
        <div className="card-heading">
          <div><span className="section-kicker">ATIVIDADE</span><h2>Conferências recentes</h2></div>
          {recent.length > 0 && <button className="text-button" onClick={onHistory}>Ver histórico <ChevronRight size={17} /></button>}
        </div>
        {loading ? <TableLoading /> : recent.length ? (
          <ConferenceTable entries={recent.slice(0, 6)} openingId={openingId} onOpen={onOpen} />
        ) : (
          <EmptyState icon={<FileCheck2 />} title="Pronto para a primeira conferência" text="Crie uma conferência para começar a formar o histórico auditável.">
            <button className="button secondary" onClick={onNew}><Plus size={17} /> Nova conferência</button>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function NewConferenceView({
  user,
  profile,
  onCreated,
  onCancel,
}: {
  user: User;
  profile: UserProfile;
  onCreated: (conference: ConferenceRecord, items: ReconciliationItem[]) => void;
  onCancel: () => void;
}) {
  const [competence, setCompetence] = useState(currentCompetence());
  const [supplier, setSupplier] = useState("Laboratório terceirizado");
  const [measurementNumber, setMeasurementNumber] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [excelFiles, setExcelFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("");
  const [error, setError] = useState("");

  const selectPdf = (files: File[]) => {
    const selected = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!selected) return setError("Selecione um arquivo PDF válido.");
    setPdfFile(selected);
    setError("");
  };

  const selectExcel = (files: File[]) => {
    const valid = files.filter((file) => /\.(xlsx|xls)$/i.test(file.name));
    if (!valid.length) return setError("Selecione ao menos uma planilha Excel válida.");
    setExcelFiles((current) => {
      const unique = new Map([...current, ...valid].map((file) => [`${file.name}-${file.size}`, file]));
      return [...unique.values()];
    });
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!competence || !supplier.trim() || !pdfFile || !excelFiles.length) {
      setError("Informe a competência, o fornecedor, um PDF e ao menos uma planilha.");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      setProcessingLabel("Lendo os arquivos no navegador…");
      const [pdfResult, excelResult] = await Promise.all([
        parseBillingPdf(pdfFile),
        parseCollectionFiles(excelFiles),
      ]);
      setProcessingLabel("Cruzando as amostras e classificando divergências…");
      const { items, summary } = reconcileSamples(
        pdfResult.items,
        excelResult.samples,
        pdfResult.metadata,
      );
      const inferredNumber =
        pdfResult.metadata.measurementNumber ||
        measurementNumber.trim() ||
        pdfFile.name.replace(/\.pdf$/i, "");
      const draft: ConferenceDraft = {
        measurementNumber: inferredNumber,
        competence,
        supplier: supplier.trim(),
        status: summary.pendingReviews === 0 ? "reviewed" : "in_review",
        summary,
        pdfMetadata: pdfResult.metadata,
        files: [pdfResult.file, ...excelResult.files],
        items,
      };
      setProcessingLabel("Salvando o resultado e a trilha de auditoria…");
      const conference = await createConference(draft, user, profile);
      onCreated(conference, items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a conferência.");
    } finally {
      setProcessing(false);
      setProcessingLabel("");
    }
  };

  return (
    <form className="page-stack" onSubmit={submit}>
      <section className="workflow-steps" aria-label="Etapas da conferência">
        <span className="workflow-step active"><b>1</b><span>Identificação<small>Dados da medição</small></span></span>
        <span className="workflow-line" />
        <span className="workflow-step active"><b>2</b><span>Arquivos<small>PDF e planilhas</small></span></span>
        <span className="workflow-line" />
        <span className="workflow-step"><b>3</b><span>Resultado<small>Conciliação</small></span></span>
      </section>

      <section className="content-card form-card">
        <div className="card-heading"><div><span className="section-kicker">ETAPA 1</span><h2>Identifique a medição</h2><p>Esses dados facilitam a busca no histórico.</p></div></div>
        <div className="form-grid three-columns">
          <label className="field"><span>Competência <em>*</em></span><input type="month" value={competence} onChange={(event) => setCompetence(event.target.value)} required /></label>
          <label className="field"><span>Fornecedor <em>*</em></span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Nome do laboratório" required /></label>
          <label className="field"><span>Número da medição</span><input value={measurementNumber} onChange={(event) => setMeasurementNumber(event.target.value)} placeholder="Extraído do PDF automaticamente" /></label>
        </div>
      </section>

      <section className="content-card form-card">
        <div className="card-heading"><div><span className="section-kicker">ETAPA 2</span><h2>Selecione os arquivos</h2><p>O conteúdo é processado localmente. Somente o resultado e os metadados são salvos.</p></div><span className="privacy-badge"><ShieldCheck size={16} /> Arquivos não enviados</span></div>
        <div className="upload-grid">
          <FileDropzone title="PDF da medição" description="Um arquivo PDF com a cobrança detalhada" accept="application/pdf,.pdf" multiple={false} icon={<FileText />} onFiles={selectPdf}>
            {pdfFile && <SelectedFile file={pdfFile} tone="pdf" onRemove={() => setPdfFile(null)} />}
          </FileDropzone>
          <FileDropzone title="Planilhas de coleta" description="Selecione todos os lotes .xlsx ou .xls" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" multiple icon={<FileSpreadsheet />} onFiles={selectExcel}>
            {!!excelFiles.length && (
              <div className="selected-file-list">
                {excelFiles.map((file) => <SelectedFile key={`${file.name}-${file.size}`} file={file} tone="excel" onRemove={() => setExcelFiles((current) => current.filter((entry) => entry !== file))} />)}
              </div>
            )}
          </FileDropzone>
        </div>
      </section>

      {error && <div className="alert error-alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {processing && <div className="processing-bar"><LoaderCircle className="spin" size={20} /><span>{processingLabel}</span></div>}
      <div className="form-actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={processing}>Cancelar</button>
        <button type="submit" className="button primary" disabled={processing}>
          {processing ? <LoaderCircle className="spin" size={18} /> : <BarChart3 size={18} />}
          Executar conferência
        </button>
      </div>
    </form>
  );
}

function ResultView({
  conference,
  items,
  user,
  profile,
  onItemsChange,
  onConferenceChange,
  onBack,
}: {
  conference: ConferenceRecord;
  items: ReconciliationItem[];
  user: User;
  profile: UserProfile;
  onItemsChange: (items: ReconciliationItem[]) => void;
  onConferenceChange: (conference: ConferenceRecord) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | Classification>("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReconciliationItem | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const divergences = items.filter((item) => item.classification !== "ok");
  const filtered = divergences.filter((item) => {
    if (filter === "pending" && item.decision !== "pending") return false;
    if (filter !== "all" && filter !== "pending" && item.classification !== filter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [item.pdfSampleNumber, item.excelSampleNumber, item.pdfIdentification, item.excelIdentification]
      .some((value) => value?.toLowerCase().includes(query));
  });
  const progress = conference.summary.divergentItems
    ? Math.round((conference.summary.reviewedItems / conference.summary.divergentItems) * 100)
    : 100;

  const review = async (decision: ReviewDecision, comment: string) => {
    if (!selected) return;
    setReviewing(true);
    setReviewError("");
    try {
      const result = await saveItemReview({
        conferenceId: conference.id,
        itemId: selected.id,
        decision,
        comment,
        user,
        profile,
      });
      const updatedItems = items.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              decision,
              reviewComment: comment,
              reviewedBy: profile.displayName,
              reviewedAt: result.reviewedAt,
            }
          : item,
      );
      const updatedConference: ConferenceRecord = {
        ...conference,
        status: result.pendingReviews === 0 ? "reviewed" : "in_review",
        summary: {
          ...conference.summary,
          reviewedItems: result.reviewedItems,
          pendingReviews: result.pendingReviews,
        },
        updatedAt: result.reviewedAt,
      };
      onItemsChange(updatedItems);
      onConferenceChange(updatedConference);
      setSelected(null);
    } catch {
      setReviewError("Não foi possível registrar a decisão. Tente novamente.");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="result-title-row">
        <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Voltar</button>
        <div className="result-identity"><span>{conference.measurementNumber}</span><small>{formatCompetence(conference.competence)} · {conference.supplier}</small></div>
        <StatusBadge status={conference.status} />
      </div>

      <section className="metric-grid result-metrics">
        <MetricCard icon={<FileText />} tone="blue" label="Itens no PDF" value={NUMBER.format(conference.summary.billingItems)} detail={CURRENCY.format(conference.summary.billedTotal)} />
        <MetricCard icon={<CheckCircle2 />} tone="green" label="Conciliados" value={NUMBER.format(conference.summary.matchedOk)} detail={`${percent(conference.summary.matchedOk, conference.summary.billingItems)}% da cobrança`} />
        <MetricCard icon={<AlertCircle />} tone="red" label="Divergências" value={NUMBER.format(conference.summary.divergentItems)} detail={CURRENCY.format(conference.summary.valueUnderReview)} />
        <MetricCard icon={<ShieldCheck />} tone="teal" label="Revisados" value={`${conference.summary.reviewedItems}/${conference.summary.divergentItems}`} detail={`${progress}% concluído`} />
      </section>

      <section className="review-progress-card">
        <div><span>Progresso da revisão</span><strong>{conference.summary.pendingReviews ? `${conference.summary.pendingReviews} item(ns) pendente(s)` : "Revisão concluída"}</strong></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <b>{progress}%</b>
      </section>

      <section className="content-card results-card">
        <div className="card-heading result-card-heading">
          <div><span className="section-kicker">EXCEÇÕES</span><h2>Itens para revisão</h2><p>Os {NUMBER.format(conference.summary.matchedOk)} itens conciliados foram ocultados para acelerar a análise.</p></div>
          <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar amostra" aria-label="Buscar amostra" /></div>
        </div>
        <div className="filter-tabs" role="tablist" aria-label="Filtrar divergências">
          <FilterButton active={filter === "pending"} onClick={() => setFilter("pending")}>Pendentes <b>{conference.summary.pendingReviews}</b></FilterButton>
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Todas <b>{divergences.length}</b></FilterButton>
          <FilterButton active={filter === "billing_without_collection"} onClick={() => setFilter("billing_without_collection")}>Sem coleta <b>{conference.summary.billingWithoutCollection}</b></FilterButton>
          <FilterButton active={filter === "collection_without_billing"} onClick={() => setFilter("collection_without_billing")}>Não cobrado <b>{conference.summary.collectionWithoutBilling}</b></FilterButton>
          <FilterButton active={filter === "data_mismatch"} onClick={() => setFilter("data_mismatch")}>Dados <b>{conference.summary.dataMismatches}</b></FilterButton>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table className="data-table exception-table">
              <thead><tr><th>Classificação</th><th>Amostra no PDF</th><th>Amostra no Excel</th><th>Valor</th><th>Decisão</th><th><span className="sr-only">Abrir</span></th></tr></thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} onClick={() => setSelected(item)} className="clickable-row">
                    <td><ClassificationBadge classification={item.classification} /></td>
                    <td><strong>{item.pdfSampleNumber ?? "—"}</strong><small>{item.pdfIdentification ?? "Sem item no PDF"}</small></td>
                    <td><strong>{item.excelSampleNumber ?? "—"}</strong><small>{item.excelIdentification ?? "Sem coleta localizada"}</small></td>
                    <td><strong>{item.chargedPrice ? CURRENCY.format(item.chargedPrice) : "—"}</strong></td>
                    <td><DecisionBadge decision={item.decision} /></td>
                    <td><button className="row-action" aria-label={`Revisar ${item.pdfSampleNumber ?? item.excelSampleNumber}`}><ChevronRight size={18} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<CheckCircle2 />} title={filter === "pending" ? "Nenhuma pendência neste filtro" : "Nenhum item encontrado"} text={filter === "pending" ? "Todas as divergências exibidas já receberam uma decisão." : "Ajuste a busca ou escolha outro filtro."} />
        )}
      </section>

      {selected && (
        <ReviewDrawer item={selected} busy={reviewing} error={reviewError} onClose={() => setSelected(null)} onSave={review} />
      )}
    </div>
  );
}

function ReviewDrawer({
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: ReconciliationItem;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (decision: ReviewDecision, comment: string) => void;
}) {
  const [decision, setDecision] = useState<ReviewDecision>(item.decision);
  const [comment, setComment] = useState(item.reviewComment);
  const [validation, setValidation] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (decision === "contested" && !comment.trim()) {
      setValidation("Informe o motivo da contestação.");
      return;
    }
    setValidation("");
    onSave(decision, comment.trim());
  };

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-scrim" onClick={onClose} aria-label="Fechar revisão" />
      <aside className="review-drawer" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header className="drawer-header">
          <div><span className="section-kicker">REVISÃO DE EXCEÇÃO</span><h2 id="review-title">{item.pdfSampleNumber ?? item.excelSampleNumber}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <div className="drawer-body">
          <ClassificationBadge classification={item.classification} />
          <p className="review-note">{item.note}</p>
          <div className="comparison-grid">
            <ComparisonColumn title="Cobrança · PDF" icon={<FileText size={17} />} sample={item.pdfSampleNumber} company={item.pdfCompany} identification={item.pdfIdentification} sampleType={item.pdfSampleType} />
            <ComparisonColumn title="Coleta · Excel" icon={<FileSpreadsheet size={17} />} sample={item.excelSampleNumber} company={item.excelCompany} identification={item.excelIdentification} sampleType={item.excelSampleType} />
          </div>
          <div className="detail-strip">
            <span><small>Valor cobrado</small><strong>{item.chargedPrice ? CURRENCY.format(item.chargedPrice) : "—"}</strong></span>
            <span><small>Página do PDF</small><strong>{item.pdfPage ?? "—"}</strong></span>
            <span><small>Análises</small><strong>{item.analysesCount}</strong></span>
          </div>
          <form className="review-form" onSubmit={submit}>
            <fieldset><legend>Decisão</legend><div className="decision-options">
              <DecisionOption value="pending" current={decision} icon={<Clock3 />} label="Pendente" onSelect={setDecision} />
              <DecisionOption value="approved" current={decision} icon={<Check />} label="Aprovar" onSelect={setDecision} />
              <DecisionOption value="contested" current={decision} icon={<XCircle />} label="Contestar" onSelect={setDecision} />
            </div></fieldset>
            <label className="field"><span>Comentário {decision === "contested" && <em>*</em>}</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder={decision === "contested" ? "Explique o motivo da contestação" : "Registre uma observação, se necessário"} /></label>
            {(validation || error) && <div className="alert error-alert compact"><AlertCircle size={17} /><span>{validation || error}</span></div>}
            <div className="drawer-actions"><button type="button" className="button ghost" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Registrar decisão</button></div>
          </form>
          {item.reviewedBy && <p className="previous-review"><History size={15} /> Última decisão por {item.reviewedBy}{item.reviewedAt ? ` em ${formatDateTime(item.reviewedAt)}` : ""}.</p>}
        </div>
      </aside>
    </div>
  );
}

function HistoryView({
  recent,
  loading,
  openingId,
  deletingId,
  canDelete,
  onOpen,
  onDelete,
}: {
  recent: ConferenceRecord[];
  loading: boolean;
  openingId: string | null;
  deletingId: string | null;
  canDelete: boolean;
  onOpen: (conference: ConferenceRecord) => void;
  onDelete: (conference: ConferenceRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = recent.filter((entry) => [entry.measurementNumber, entry.supplier, entry.competence, entry.createdByName].some((value) => value.toLowerCase().includes(search.toLowerCase())));
  return (
    <section className="content-card history-card">
      <div className="card-heading"><div><span className="section-kicker">AUDITORIA</span><h2>Conferências anteriores</h2><p>{canDelete ? "Consulte ou remova medições do histórico. Esta ação é restrita a administradores." : "Consulte medições, decisões e responsáveis."}</p></div><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar medição, fornecedor…" aria-label="Buscar no histórico" /></div></div>
      {loading ? <TableLoading /> : filtered.length ? <ConferenceTable entries={filtered} openingId={openingId} deletingId={deletingId} onOpen={onOpen} onDelete={canDelete ? onDelete : undefined} /> : <EmptyState icon={<History />} title="Nenhuma conferência encontrada" text="Tente outro termo de busca ou crie uma nova conferência." />}
    </section>
  );
}

function ConferenceTable({
  entries,
  openingId,
  deletingId,
  onOpen,
  onDelete,
}: {
  entries: ConferenceRecord[];
  openingId: string | null;
  deletingId?: string | null;
  onOpen: (conference: ConferenceRecord) => void;
  onDelete?: (conference: ConferenceRecord) => void;
}) {
  return (
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Medição</th><th>Competência</th><th>Resultado</th><th>Progresso</th><th>Responsável</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
      {entries.map((entry) => {
        const progress = entry.summary.divergentItems ? Math.round((entry.summary.reviewedItems / entry.summary.divergentItems) * 100) : 100;
        return <tr key={entry.id} className="clickable-row" onClick={() => onOpen(entry)}><td><strong>{entry.measurementNumber}</strong><small>{entry.supplier}</small></td><td>{formatCompetence(entry.competence)}</td><td><span className="inline-stat success"><CheckCircle2 size={15} />{entry.summary.matchedOk} OK</span><span className="inline-stat danger"><AlertCircle size={15} />{entry.summary.divergentItems} divergências</span></td><td><div className="mini-progress"><span><i style={{ width: `${progress}%` }} /></span><b>{progress}%</b></div></td><td><strong>{entry.createdByName}</strong><small>{entry.createdAt ? formatDateTime(entry.createdAt) : "Agora"}</small></td><td><StatusBadge status={entry.status} /></td><td><div className="row-actions">{onDelete && <button type="button" className="row-action danger-action" aria-label={`Remover ${entry.measurementNumber} do histórico`} title="Remover do histórico" disabled={deletingId === entry.id} onClick={(event) => { event.stopPropagation(); onDelete(entry); }}>{deletingId === entry.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}</button>}<button type="button" className="row-action" aria-label={`Abrir ${entry.measurementNumber}`}>{openingId === entry.id ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}</button></div></td></tr>;
      })}
    </tbody></table></div>
  );
}

function DeleteConferenceDialog({
  conference,
  busy,
  onCancel,
  onConfirm,
}: {
  conference: ConferenceRecord;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-layer">
      <button className="dialog-scrim" onClick={onCancel} aria-label="Cancelar remoção" disabled={busy} />
      <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <span className="dialog-danger-icon"><Trash2 size={23} /></span>
        <h2 id="delete-title">Remover do histórico?</h2>
        <p id="delete-description">A medição <strong>{conference.measurementNumber}</strong> deixará de aparecer nas listas. Os dados e decisões serão preservados para segurança e auditoria.</p>
        <div className="dialog-actions">
          <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="button danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} Remover do histórico</button>
        </div>
      </section>
    </div>
  );
}

function LoginScreen({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState(initialError);

  const changeMode = (nextMode: "sign-in" | "sign-up") => {
    setMode(nextMode);
    setError("");
    setPassword("");
    setPasswordConfirmation("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const corporateEmail = normalizeEmail(email);
    if (!isCorporateEmail(corporateEmail)) {
      setError(`Use seu e-mail corporativo ${CORPORATE_EMAIL_SUFFIX}.`);
      return;
    }
    if (mode === "sign-up" && !displayName.trim()) {
      setError("Informe seu nome para criar a conta.");
      return;
    }
    if (mode === "sign-up" && password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (mode === "sign-up" && password !== passwordConfirmation) {
      setError("As senhas informadas não coincidem.");
      return;
    }

    setBusyAction("email");
    try {
      const { auth, persistenceReady } = getFirebaseServices();
      await persistenceReady;
      if (mode === "sign-up") {
        const credential = await createUserWithEmailAndPassword(
          auth,
          corporateEmail,
          password,
        );
        await updateProfile(credential.user, { displayName: displayName.trim() });
        await sendEmailVerification(credential.user);
      } else {
        await signInWithEmailAndPassword(auth, corporateEmail, password);
      }
    } catch (cause) {
      setError(authErrorMessage(cause, mode));
    } finally {
      setBusyAction(null);
    }
  };

  const continueWithGoogle = async () => {
    setBusyAction("google");
    setError("");
    try {
      const { auth, persistenceReady } = getFirebaseServices();
      await persistenceReady;
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        hd: CORPORATE_EMAIL_DOMAIN,
        prompt: "select_account",
      });
      const credential = await signInWithPopup(auth, provider);
      if (!isCorporateEmail(credential.user.email)) {
        await signOut(auth);
        setError(`Use sua conta Google ${CORPORATE_EMAIL_SUFFIX}.`);
      }
    } catch (cause) {
      setError(authErrorMessage(cause, "google"));
    } finally {
      setBusyAction(null);
    }
  };

  const emailBusy = busyAction === "email";
  const googleBusy = busyAction === "google";

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand"><span className="brand-mark light"><FlaskConical size={25} /></span><span><strong>Conferência</strong><small>Laboratorial</small></span></div>
        <div className="auth-message"><span className="section-kicker light-kicker">CONCILIAÇÃO SEGURA</span><h1>Do arquivo à decisão,<br />com rastreabilidade.</h1><p>Cruze cobranças e coletas, trate somente as exceções e preserve cada decisão em uma trilha de auditoria.</p><div className="auth-feature-row"><span><CheckCircle2 />Conciliação automática</span><span><ShieldCheck />Histórico auditável</span></div></div>
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      </section>
      <section className="auth-form-side">
        <form className="login-card" onSubmit={submit}>
          <div className="login-icon"><UserRound size={24} /></div>
          <span className="section-kicker">ACESSO CORPORATIVO</span>
          <h2>{mode === "sign-up" ? "Crie sua conta" : "Bem-vindo de volta"}</h2>
          <p>
            {mode === "sign-up"
              ? `Cadastre-se somente com seu e-mail ${CORPORATE_EMAIL_SUFFIX}.`
              : "Entre com sua conta corporativa para continuar."}
          </p>
          <div className="auth-mode-tabs" role="tablist" aria-label="Escolha o modo de acesso">
            <button type="button" role="tab" aria-selected={mode === "sign-in"} className={mode === "sign-in" ? "active" : ""} onClick={() => changeMode("sign-in")}>Entrar</button>
            <button type="button" role="tab" aria-selected={mode === "sign-up"} className={mode === "sign-up" ? "active" : ""} onClick={() => changeMode("sign-up")}>Criar conta</button>
          </div>
          <button className="button google-button" type="button" onClick={continueWithGoogle} disabled={busyAction !== null}>
            {googleBusy ? <LoaderCircle className="spin" size={18} /> : <span className="google-mark" aria-hidden="true">G</span>}
            Continuar com Google
          </button>
          <div className="auth-divider"><span>ou use o e-mail corporativo</span></div>
          {mode === "sign-up" && (
            <label className="field"><span>Nome completo</span><input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="Seu nome" required /></label>
          )}
          <label className="field"><span>E-mail corporativo</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder={`nome${CORPORATE_EMAIL_SUFFIX}`} required /></label>
          <label className="field"><span>Senha</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={mode === "sign-up" ? 6 : undefined} placeholder={mode === "sign-up" ? "Mínimo de 6 caracteres" : "Sua senha"} required /></label>
          {mode === "sign-up" && (
            <label className="field"><span>Confirme a senha</span><input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={6} placeholder="Repita a senha" required /></label>
          )}
          {error && <div className="alert error-alert compact"><AlertCircle size={17} /><span>{error}</span></div>}
          <button className="button primary login-button" type="submit" disabled={busyAction !== null}>{emailBusy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />} {mode === "sign-up" ? "Criar conta" : "Entrar"}</button>
          <p className="login-footnote"><ShieldCheck size={15} /> Seus arquivos são processados neste dispositivo.</p>
        </form>
      </section>
    </main>
  );
}

function EmailVerificationScreen({ user }: { user: User }) {
  const [busyAction, setBusyAction] = useState<"check" | "resend" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resend = async () => {
    setBusyAction("resend");
    setError("");
    setMessage("");
    try {
      await sendEmailVerification(user);
      setMessage("Enviamos um novo link de confirmação para seu e-mail.");
    } catch (cause) {
      setError(authErrorMessage(cause, "verification"));
    } finally {
      setBusyAction(null);
    }
  };

  const check = async () => {
    setBusyAction("check");
    setError("");
    setMessage("");
    try {
      await user.reload();
      await user.getIdToken(true);
      if (!user.emailVerified) {
        setError("O e-mail ainda não foi confirmado. Abra o link recebido e tente novamente.");
        return;
      }
      window.location.reload();
    } catch (cause) {
      setError(authErrorMessage(cause, "verification"));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="centered-page">
      <div className="setup-card verification-card">
        <span className="setup-icon"><ShieldCheck /></span>
        <span className="section-kicker">CONFIRME SEU E-MAIL</span>
        <h1>Quase pronto</h1>
        <p>Enviamos um link de confirmação para <strong>{user.email}</strong>. Confirme que este e-mail corporativo é seu para liberar o acesso.</p>
        {message && <div className="alert success-alert compact" role="status"><CheckCircle2 size={17} /><span>{message}</span></div>}
        {error && <div className="alert error-alert compact" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
        <div className="verification-actions">
          <button className="button ghost" type="button" onClick={resend} disabled={busyAction !== null}>{busyAction === "resend" && <LoaderCircle className="spin" size={17} />} Reenviar e-mail</button>
          <button className="button primary" type="button" onClick={check} disabled={busyAction !== null}>{busyAction === "check" ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Já confirmei</button>
        </div>
        <button className="text-button verification-signout" type="button" onClick={() => void signOut(getFirebaseServices().auth)}><LogOut size={15} /> Usar outra conta</button>
      </div>
    </main>
  );
}

function authErrorMessage(
  cause: unknown,
  mode: "sign-in" | "sign-up" | "google" | "verification",
): string {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "";

  if (code === "auth/email-already-in-use") {
    return "Este e-mail já possui conta. Escolha “Entrar”.";
  }
  if (code === "auth/weak-password") {
    return "Escolha uma senha mais forte, com pelo menos 6 caracteres.";
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "E-mail ou senha inválidos. Verifique os dados e tente novamente.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "O acesso com Google foi cancelado.";
  }
  if (code === "auth/popup-blocked") {
    return "O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "Já existe uma conta com este e-mail. Entre usando e-mail e senha.";
  }
  if (code === "auth/too-many-requests") {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (code === "auth/network-request-failed") {
    return "Não foi possível conectar ao serviço de acesso. Verifique sua internet.";
  }

  if (cause instanceof Error && cause.message.includes(CORPORATE_EMAIL_SUFFIX)) {
    return cause.message;
  }
  if (mode === "sign-up") return "Não foi possível criar a conta. Tente novamente.";
  if (mode === "google") return "Não foi possível entrar com o Google. Tente novamente.";
  if (mode === "verification") return "Não foi possível confirmar o e-mail agora. Tente novamente.";
  return "Não foi possível entrar. Verifique os dados e tente novamente.";
}

function FirebaseSetupScreen() {
  return (
    <main className="centered-page"><div className="setup-card"><span className="setup-icon"><FlaskConical /></span><span className="section-kicker">CONFIGURAÇÃO INICIAL</span><h1>Conecte este MVP ao Firebase</h1><p>A interface já está pronta. Copie <code>.env.example</code> para <code>.env.local</code> e preencha as chaves do aplicativo Web criado no console do Firebase.</p><div className="setup-steps"><span><b>1</b>Ative E-mail/senha e Google</span><span><b>2</b>Crie o banco Cloud Firestore</span><span><b>3</b>Publique as regras de segurança</span></div><small>As chaves públicas identificam o projeto; o acesso aos dados continua protegido por login e pelas regras do Firestore.</small></div></main>
  );
}

function AccessPendingScreen({ user, profile, error }: { user: User; profile: UserProfile | null; error: string }) {
  return (
    <main className="centered-page"><div className="setup-card"><span className="setup-icon amber"><ShieldCheck /></span><span className="section-kicker">ACESSO PENDENTE</span><h1>Conta autenticada, acesso ainda não liberado</h1><p>{error || "Peça ao administrador para criar ou ativar seu perfil na coleção users do Firestore."}</p><div className="uid-box"><span>Identificador do usuário</span><code>{user.uid}</code></div>{profile && !profile.active && <p className="muted">O perfil existe, mas está marcado como inativo.</p>}<button className="button secondary" onClick={() => void signOut(getFirebaseServices().auth)}><LogOut size={17} /> Sair</button></div></main>
  );
}

function LoadingScreen() {
  return <main className="loading-page"><span className="brand-mark"><FlaskConical size={25} /></span><LoaderCircle className="spin" size={23} /><span>Preparando a conferência…</span></main>;
}

function FileDropzone({ title, description, accept, multiple, icon, onFiles, children }: { title: string; description: string; accept: string; multiple: boolean; icon: React.ReactNode; onFiles: (files: File[]) => void; children?: React.ReactNode }) {
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => onFiles([...event.target.files ?? []]);
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); onFiles([...event.dataTransfer.files]); };
  return <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}><input className="sr-only" type="file" accept={accept} multiple={multiple} onChange={handleInput} /><span className="dropzone-icon">{icon}</span><strong>{title}</strong><p>{description}</p><span className="dropzone-action"><UploadCloud size={16} /> Selecionar {multiple ? "arquivos" : "arquivo"}</span>{children}</label>;
}

function SelectedFile({ file, tone, onRemove }: { file: File; tone: "pdf" | "excel"; onRemove: () => void }) {
  return <span className="selected-file" onClick={(event) => event.preventDefault()}><span className={`file-type ${tone}`}>{tone === "pdf" ? <FileText size={18} /> : <FileSpreadsheet size={18} />}</span><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><button type="button" className="icon-button" onClick={(event) => { event.preventDefault(); onRemove(); }} aria-label={`Remover ${file.name}`}><X size={17} /></button></span>;
}

function NavButton({ label, active, icon, onClick }: { label: string; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={`nav-button ${active ? "active" : ""}`} aria-label={label} data-nav-label={label} onClick={onClick}>{icon}<span className="nav-text">{label}</span></button>;
}

function FeatureTutorialDialog({
  tutorial,
  step,
  onStepChange,
  onSkip,
  onComplete,
}: {
  tutorial: FeatureTutorial;
  step: number;
  onStepChange: (step: number) => void;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const current = tutorial.steps[step];
  const lastStep = step === tutorial.steps.length - 1;

  return (
    <div className="tutorial-layer" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <button className="tutorial-scrim" aria-label="Ignorar tutorial" onClick={onSkip} />
      <section className="tutorial-dialog">
        <header className="tutorial-header">
          <span className="tutorial-icon"><CircleHelp size={22} /></span>
          <div>
            <span className="section-kicker">GUIA RÁPIDO · {tutorial.label.toUpperCase()}</span>
            <h2 id="tutorial-title">{tutorial.title}</h2>
            <p>{tutorial.description}</p>
          </div>
          <button className="icon-button" onClick={onSkip} aria-label="Fechar tutorial"><X size={19} /></button>
        </header>
        <div className="tutorial-progress" aria-label={`Etapa ${step + 1} de ${tutorial.steps.length}`}>
          {tutorial.steps.map((item, index) => (
            <button
              key={item.title}
              className={index === step ? "active" : index < step ? "complete" : ""}
              onClick={() => onStepChange(index)}
              aria-label={`Abrir etapa ${index + 1}: ${item.title}`}
            />
          ))}
        </div>
        <div className="tutorial-step">
          <span>{step + 1}</span>
          <div><small>ETAPA {step + 1} DE {tutorial.steps.length}</small><h3>{current.title}</h3><p>{current.text}</p></div>
        </div>
        <footer className="tutorial-actions">
          <button className="text-button tutorial-skip" onClick={onSkip}>Ignorar tutorial</button>
          <div>
            {step > 0 && <button className="button ghost" onClick={() => onStepChange(step - 1)}><ArrowLeft size={17} /> Voltar</button>}
            <button className="button primary" onClick={() => lastStep ? onComplete() : onStepChange(step + 1)}>
              {lastStep ? <><Check size={17} /> Concluir</> : <>Próximo <ArrowRight size={17} /></>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function MetricCard({ icon, tone, label, value, detail }: { icon: React.ReactNode; tone: string; label: string; value: string; detail: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>{children}</button>;
}

function ClassificationBadge({ classification }: { classification: Classification }) {
  return <span className={`classification-badge classification-${classification}`}><span />{CLASSIFICATION_SHORT_LABELS[classification]}</span>;
}

function DecisionBadge({ decision }: { decision: ReviewDecision }) {
  return <span className={`decision-badge decision-${decision}`}>{decision === "approved" ? <CheckCircle2 size={14} /> : decision === "contested" ? <XCircle size={14} /> : <Clock3 size={14} />}{decision === "approved" ? "Aprovado" : decision === "contested" ? "Contestado" : "Pendente"}</span>;
}

function StatusBadge({ status }: { status: ConferenceRecord["status"] }) {
  return <span className={`status-badge ${status}`}>{status === "reviewed" ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{status === "reviewed" ? "Concluída" : "Em revisão"}</span>;
}

function DecisionOption({ value, current, icon, label, onSelect }: { value: ReviewDecision; current: ReviewDecision; icon: React.ReactNode; label: string; onSelect: (value: ReviewDecision) => void }) {
  return <button type="button" className={`decision-option ${value} ${current === value ? "selected" : ""}`} onClick={() => onSelect(value)}>{icon}<span>{label}</span>{current === value && <Check size={15} />}</button>;
}

function ComparisonColumn({ title, icon, sample, company, identification, sampleType }: { title: string; icon: React.ReactNode; sample: string | null; company: string | null; identification: string | null; sampleType: string | null }) {
  return <section className="comparison-column"><h3>{icon}{title}</h3><dl><div><dt>Número da amostra</dt><dd>{sample ?? "Não localizado"}</dd></div><div><dt>Empresa</dt><dd>{company || "—"}</dd></div><div><dt>Identificação</dt><dd>{identification || "—"}</dd></div><div><dt>Tipo</dt><dd>{sampleType || "—"}</dd></div></dl></section>;
}

function EmptyState({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{children}</div>;
}

function TableLoading() {
  return <div className="table-loading"><LoaderCircle className="spin" size={21} /> Carregando conferências…</div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatCompetence(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(year), Number(month) - 1, 1))).replace(" de ", "/");
}

function currentCompetence() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
