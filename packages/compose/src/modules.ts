// Composition root: the list of modules this app loads (backend 01 §2). Adding a module means adding it here.
import {
  AppError,
  type Database,
  type KernelServices,
  type MessageSender,
  type RouteTable,
} from '@archova/kernel';
import {
  AI_PERMISSIONS,
  createAiModule,
  type AiApi,
  type AiConfig,
  type ModelProvider,
  type RasterizePage,
} from '@archova/mod-ai';
import { createAccessModule } from '@archova/mod-access';
import {
  TRIAL_ENTITLEMENTS,
  createBillingModule,
  type EntitlementProvider,
} from '@archova/mod-billing';
import { createBackofficeModule, type BackofficeConfig } from '@archova/mod-backoffice';
import { DEFECTS_PERMISSIONS, createDefectsModule } from '@archova/mod-defects';
import {
  FINANCIALS_PERMISSIONS,
  createFinancialsModule,
  type EvidenceSigner,
} from '@archova/mod-financials';
import { PRECON_PERMISSIONS, createPreconModule } from '@archova/mod-precon';
import { QUALITY_PERMISSIONS, createQualityModule, type QualityApi } from '@archova/mod-quality';
import { INSURANCE_PERMISSIONS, createInsuranceModule } from '@archova/mod-insurance';
import { SAFETY_PERMISSIONS, createSafetyModule } from '@archova/mod-safety';
import { ESTIMATING_PERMISSIONS, createEstimatingModule } from '@archova/mod-estimating';
import {
  INTEGRATIONS_PERMISSIONS,
  createIntegrationsModule,
  type AccountingDeps,
  type WebhooksDeps,
} from '@archova/mod-integrations';
import { DIARY_PERMISSIONS, createDiaryModule, type DiaryApi } from '@archova/mod-diary';
import { DOCUMENTS_PERMISSIONS, createDocumentsModule } from '@archova/mod-documents';
import {
  createFilesModule,
  createMemoryTileUrls,
  type MalwareScanner,
  type ObjectStore,
  type TileUrls,
} from '@archova/mod-files';
import { createIdentityModule, type IdentityConfig } from '@archova/mod-identity';
import { MEETINGS_PERMISSIONS, createMeetingsModule } from '@archova/mod-meetings';
import { BIM_PERMISSIONS, createBimModule } from '@archova/mod-bim';
import { OWNERPORTAL_PERMISSIONS, createOwnerPortalModule } from '@archova/mod-ownerportal';
import { createNotificationsModule } from '@archova/mod-notifications';
import { createBookmarksModule } from '@archova/mod-bookmarks';
import { createRecentsModule } from '@archova/mod-recents';
import { createPlatformModule } from '@archova/mod-platform';
import {
  WORKFORCE_PERMISSIONS,
  createWorkforceModule,
  type NumberVault,
} from '@archova/mod-workforce';
import { RFIS_PERMISSIONS, createRfisModule } from '@archova/mod-rfis';
import { EXPORTS_PERMISSIONS, createExportsModule } from '@archova/mod-exports';
import { REPORTING_PERMISSIONS, createReportingModule } from '@archova/mod-reporting';
import { SEARCH_PERMISSIONS, createSearchModule } from '@archova/mod-search';
import { SCHEDULING_PERMISSIONS, createSchedulingModule } from '@archova/mod-scheduling';
import { SUBMITTALS_PERMISSIONS, createSubmittalsModule } from '@archova/mod-submittals';
import {
  CORRESPONDENCE_PERMISSIONS,
  createCorrespondenceModule,
} from '@archova/mod-correspondence';
import { CONVERSATIONS_PERMISSIONS, createConversationsModule } from '@archova/mod-conversations';
import { SYNC_PERMISSIONS, createSyncModule } from '@archova/mod-sync';

/** Permission keys declared by feature modules, registered with `access` next to the foundation keys. */
export const MODULE_PERMISSIONS = [
  AI_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  RFIS_PERMISSIONS,
  SUBMITTALS_PERMISSIONS,
  CORRESPONDENCE_PERMISSIONS,
  CONVERSATIONS_PERMISSIONS,
  DEFECTS_PERMISSIONS,
  MEETINGS_PERMISSIONS,
  OWNERPORTAL_PERMISSIONS,
  BIM_PERMISSIONS,
  SCHEDULING_PERMISSIONS,
  REPORTING_PERMISSIONS,
  SEARCH_PERMISSIONS,
  EXPORTS_PERMISSIONS,
  FINANCIALS_PERMISSIONS,
  QUALITY_PERMISSIONS,
  PRECON_PERMISSIONS,
  SAFETY_PERMISSIONS,
  INSURANCE_PERMISSIONS,
  ESTIMATING_PERMISSIONS,
  INTEGRATIONS_PERMISSIONS,
  DIARY_PERMISSIONS,
  WORKFORCE_PERMISSIONS,
  SYNC_PERMISSIONS,
];

export interface ModuleOptions {
  identity: IdentityConfig;
  files: { store: ObjectStore; scanner: MalwareScanner; tiles?: TileUrls };
  entitlements?: EntitlementProvider;
  ai: { config: AiConfig; provider?: ModelProvider; rasterizePage?: RasterizePage };
  /** One-time codes for access links (X45). */
  messages: MessageSender;
  /** The web origin access links point at. */
  linkBaseUrl: string;
  backoffice: BackofficeConfig;
  /** Outbound webhooks: the vault that seals signing secrets and the sender used for the test event. */
  webhooks: WebhooksDeps;
  /** Xero and MYOB sign-in, token sealing and the fetch used for provider calls (integrations/02). */
  accounting: AccountingDeps;
  /** Seals full wallet and worker credential numbers (compliance/05 §7). */
  walletVault: NumberVault;
  /** Signs sealed claim evidence (compliance/01 §4). */
  evidenceSigner?: EvidenceSigner;
}

export async function loadModules(services: KernelServices, opts: ModuleOptions) {
  // The identity module is built first; it tells an org's admins about partner app changes through platform, built later.
  let platformApi: ReturnType<typeof createPlatformModule>['api'] | null = null;
  const identity = await createIdentityModule(services, {
    ...opts.identity,
    partnerApps: {
      ...opts.identity.partnerApps,
      notifyAdmins: async (orgId, subject, text) => {
        const admins = await platformApi!.orgAdminContacts(orgId);
        await Promise.all(
          admins.map((a) =>
            opts.messages.email(a.email, { subject, text: `Hi ${a.name},\n\n${text}` }),
          ),
        );
      },
    },
  });
  const billing = createBillingModule(
    services,
    opts.entitlements ? { entitlements: opts.entitlements } : {},
  );
  // backoffice grants Nova credits through `ai` and its support view reads through platform; both are built after it.
  let aiApi: AiApi | null = null;
  const backoffice = createBackofficeModule(services, {
    catalogue: billing.api.catalogue,
    accounts: billing.api.accounts,
    adjustments: billing.api.adjustments,
    credits: () => ({ grantCredits: aiApi!.grantCredits }),
    supportReads: () => ({
      projects: (orgId, staffId, projectIds) =>
        platformApi!.listProjectsForSupport(orgId, staffId, projectIds),
    }),
    projectInOrg: () => (orgId, projectId) => platformApi!.projectInOrg(orgId, projectId),
    notifyStaff: async (emails, subject, text) => {
      await Promise.all(emails.map((e) => opts.messages.email(e, { subject, text })));
    },
    notifySupportSession: async (notice) => {
      const admins = await platformApi!.orgAdminContacts(notice.orgId);
      // No one to tell means no session: the company must always be able to learn who is looking.
      if (admins.length === 0)
        throw new AppError(
          'backoffice.support_notify_failed',
          'This company has no active admin to tell.',
        );
      const scope = notice.projectIds ? 'only the projects you chose' : 'your whole company';
      // Every admin must be told; one failed send fails the lot so the session does not stand.
      await Promise.all(
        admins.map((a) =>
          opts.messages.email(a.email, {
            subject: 'Archova support has opened a session on your account',
            text: [
              `Hi ${a.name},`,
              '',
              `${notice.staffName} from Archova support opened a view-only session on your company for ticket ${notice.ticketRef}.`,
              `It can see ${scope}, and ends at ${notice.expiresAt.toISOString()}.`,
              'Every page they view is listed under Settings, Support access, where you can withdraw access at any time.',
              '',
              'If you did not expect this, withdraw access now and tell us.',
            ].join('\n'),
          }),
        ),
      );
    },
    config: opts.backoffice,
  });
  // access ↔ platform reference each other's public interfaces; resolve lazily.
  let access: ReturnType<typeof createAccessModule> | null = null;
  const platform = createPlatformModule(services, {
    identity: identity.api,
    access: () => access!.api,
    defaultEntitlements: TRIAL_ENTITLEMENTS,
    supportAccess: backoffice.api.support,
    hasOpenSupportSession: backoffice.api.support.hasOpenSession,
    onOrgCreated: async (scope, org, entitlements) => {
      // Every new company starts on a trial with an end date; the trial-expiry job moves it to read-only after that.
      const account = await billing.api.accounts.startTrial(scope.tx, org.id, new Date());
      await backoffice.api.directory.upsert(scope.tx, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        planCode: entitlements.plan,
        state: entitlements.state,
        trialEndsAt: account.trialEndsAt,
      });
    },
  });
  platformApi = platform.api;
  access = createAccessModule(services, {
    lookupProjectMember: (scope, projectId, userId) =>
      platform.api.getProjectMembership(scope, projectId, userId),
    extraPermissions: MODULE_PERMISSIONS,
  });
  const files = createFilesModule(services, {
    access: access.api,
    store: opts.files.store,
    scanner: opts.files.scanner,
    tiles: opts.files.tiles ?? createMemoryTileUrls(),
    uploadPermissions: {
      // Anyone who can sign in on a project can upload their own white card and licence photos.
      workforce: 'workforce.attendance.sign_in_self',
      // The assigned subcontractor's "after" photo when marking a defect ready for review (DEF-AC5).
      defects: 'defects.defects.respond',
      // Photos on an observation, and a SWMS document from the subcontractor who wrote it.
      quality: 'quality.observations.create',
      safety: 'safety.swms.submit',
      // A subcontractor attaches their quote PDF to a tender package they were invited to.
      estimating: 'estimating.quotes.submit',
      // A subcontractor attaches the shop drawing package to the item they are responsible for.
      submittals: 'submittals.submittals.submit',
      // A subcontractor attaches supporting records to a notice or reply.
      correspondence: 'correspondence.items.respond',
    },
  });

  const documents = createDocumentsModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    identity: identity.api,
    links: {
      messages: opts.messages,
      entitlements: billing.api.entitlements.forOrg,
      baseUrl: opts.linkBaseUrl,
    },
  });

  const rfis = createRfisModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  const submittals = createSubmittalsModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    messages: opts.messages,
    baseUrl: opts.linkBaseUrl,
    logger: services.logger,
  });

  const correspondence = createCorrespondenceModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
  });

  const conversations = createConversationsModule(services, {
    platform: platform.api,
    identity: identity.api,
  });

  const defects = createDefectsModule(services, {
    access: access.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
  });

  const meetings = createMeetingsModule(services, {
    access: access.api,
    live: {
      rfisOverdue: (scope, projectId, opts) => rfis.api.overdueForMeeting(scope, projectId, opts),
      submittalsDue: (scope, projectId, opts) =>
        submittals.api.dueForMeeting(scope, projectId, opts),
      defectsOpen: (scope, projectId, opts) => defects.api.openForMeeting(scope, projectId, opts),
      delayLines: (scope, projectId, opts) => diaryApi!.delayLines(scope, projectId, opts),
    },
    platform: platform.api,
    messages: opts.messages,
    baseUrl: opts.linkBaseUrl,
    logger: services.logger,
  });

  const bim = createBimModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    rfis: rfis.api,
  });

  const ownerportal = createOwnerPortalModule(services, {
    access: access.api,
    platform: platform.api,
  });

  const notifications = createNotificationsModule(services);
  const bookmarks = createBookmarksModule(services);
  const recents = createRecentsModule(services);

  const financials = createFinancialsModule(services, {
    access: access.api,
    platform: platform.api,
    ...(opts.evidenceSigner ? { signer: opts.evidenceSigner } : {}),
    // workforce is built later; the report only calls this at request time.
    timesheetMinutes: (scope, projectId) =>
      workforce.api.timesheetMinutesByCostCode(scope, projectId),
  });

  // quality needs safety (stop-work on a SWMS) and safety needs quality (an incident action may link to an
  // inspection or observation), so safety asks for it lazily.
  let qualityApi: QualityApi | null = null;
  const safety = createSafetyModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    sources: {
      exists: (scope, projectId, type, sourceId) =>
        qualityApi!.sourceExists(scope, projectId, type, sourceId),
    },
  });

  const quality = createQualityModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    safety: safety.api,
  });
  qualityApi = quality.api;

  const insurance = createInsuranceModule(services, { platform: platform.api, files: files.api });

  // diary is created after ai (it doesn't need ai); the summary route reads the day through it lazily.
  let diaryApi: DiaryApi | null = null;
  const precon = createPreconModule(services, { platform: platform.api });

  const estimating = createEstimatingModule(services, {
    access: access.api,
    prequal: precon.api,
    platform: platform.api,
    documents: documents.api,
    files: files.api,
    financials: financials.api,
    links: {
      messages: opts.messages,
      entitlements: billing.api.entitlements.forOrg,
      baseUrl: opts.linkBaseUrl,
      senderName: async (userId) => {
        const u = await identity.api.getUser(userId);
        return u ? `${u.name} (${u.email})` : 'a member of the team';
      },
    },
  });

  const integrations = createIntegrationsModule(services, {
    platform: platform.api,
    files: files.api,
    webhooks: opts.webhooks,
    accounting: opts.accounting,
  });

  const ai = createAiModule(services, {
    config: opts.ai.config,
    orgTimeZone: async (scope) => (await platform.api.getOrg(scope)).timezone,
    readFile: (scope, fileId, maxBytes) => files.api.readFileBytes(scope, fileId, maxBytes),
    assert: async (scope, key, target) => {
      await access!.api.assert(scope, key, target);
    },
    can: (scope, key, target) => access!.api.can(scope, key, target),
    sources: (scope, projectId, only) => documents.api.aiSources(scope, projectId, only),
    accessScopes: (scope, projectId) => documents.api.aiAccessScopes(scope, projectId),
    rfiSources: (scope, projectId, only) => rfis.api.aiSources(scope, projectId, only),
    rfiAccessScopes: (scope, projectId) => rfis.api.aiAccessScopes(scope, projectId),
    defectSources: (scope, projectId, only) => defects.api.aiSources(scope, projectId, only),
    defectAccessScopes: (scope, projectId) => defects.api.aiAccessScopes(scope, projectId),
    diarySources: (scope, projectId, only) => diaryApi!.aiSources(scope, projectId, only),
    diaryAccessScopes: (scope, projectId) => diaryApi!.aiAccessScopes(scope, projectId),
    similarRfis: (scope, projectId, input) => rfis.api.findSimilar(scope, projectId, input),
    rfiForAnswer: (scope, projectId, rfiId) => rfis.api.forAnswerDraft(scope, projectId, rfiId),
    getDrawingRevision: (scope, projectId, id) =>
      documents.api.getDrawingRevision(scope, projectId, id),
    getPreviousDrawingRevision: (scope, projectId, id) =>
      documents.api.getPreviousDrawingRevision(scope, projectId, id),
    getMarkup: (scope, projectId, revisionId, markupId) =>
      documents.api.getMarkup(scope, projectId, revisionId, markupId),
    openRfisOnDrawing: (scope, projectId, ids) => rfis.api.openOnDrawing(scope, projectId, ids),
    projectCompanies: (scope, projectId) =>
      platform.api.projectCompaniesWithTrades(scope, projectId),
    openDefectsNear: (scope, projectId, input) => defects.api.openNear(scope, projectId, input),
    quotePackage: (scope, projectId, packageId) =>
      estimating.api.scopeForQuoteReading(scope, projectId, packageId),
    laborFacts: (scope, projectId, costCodeId) =>
      financials.api.laborFactsForNova(scope, projectId, costCodeId),
    quoteForNegotiation: (scope, projectId, packageId, quoteId) =>
      estimating.api.quoteForNegotiation(scope, projectId, packageId, quoteId),
    budgetReviewFacts: (scope, projectId) => financials.api.budgetReviewFacts(scope, projectId),
    dayForSummary: (scope, projectId, date) => diaryApi!.dayForSummary(scope, projectId, date),
    meetingForMinutes: (scope, projectId, meetingId) =>
      meetings.api.forMinutesDraft(scope, projectId, meetingId),
    ...(opts.ai.provider ? { provider: opts.ai.provider } : {}),
    ...(opts.ai.rasterizePage ? { rasterizePage: opts.ai.rasterizePage } : {}),
  });
  aiApi = ai.api;

  const diary = createDiaryModule(services, {
    access: access.api,
    platform: platform.api,
    files: files.api,
    // workforce is built later; the gap flag only calls this at request time.
    siteActivityDays: (scope, projectId, from, to) =>
      workforce.api.siteActivityDays(scope, projectId, from, to),
  });

  diaryApi = diary.api;

  const scheduling = createSchedulingModule({
    database: services.database as Database,
    diary: diary.api,
    rfis: rfis.api,
    submittals: submittals.api,
    platform: platform.api,
    access: access.api,
  });

  const exportsModule = createExportsModule(services, { store: opts.files.store });

  const workforce = createWorkforceModule(services, {
    vault: opts.walletVault,
    access: access.api,
    platform: platform.api,
    identity: identity.api,
    files: files.api,
    documents: documents.api,
    hooks: { onVersionPublished: (ctx, content) => ai.api.indexInductionVersion(ctx, content) },
    clearanceSwms: safety.api.workerSwms,
    clearanceInsurance: async (scope, projectId, companyId) => {
      const c = await insurance.api.companyClearance(scope, projectId, companyId);
      return {
        state: c.state,
        // Nothing to check when the project sets no requirements and the company has nothing recorded.
        checked: c.requirementsSet || c.coverCount > 0,
        messages: c.issues.map((i) => ({ level: i.level, text: i.message })),
      };
    },
    links: {
      access: access.api,
      platform: platform.api,
      files: files.api,
      entitlements: billing.api.entitlements.forOrg,
      messages: opts.messages,
      ai: {
        askInduction: ai.api.askInduction,
        translateInduction: ai.api.translateInduction,
        translationLanguages: ai.api.translationLanguages,
      },
      baseUrl: opts.linkBaseUrl,
      redis: services.redis,
      logger: services.logger,
    },
  });

  // Built after workforce, safety, precon and financials: the tender-readiness pack reads all four.
  const reporting = createReportingModule({
    database: services.database as Database,
    identity: identity.api,
    platform: platform.api,
    access: access.api,
    rfis: rfis.api,
    defects: defects.api,
    submittals: submittals.api,
    claims: financials.api.reporting.claims,
    variations: financials.api.reporting.variations,
    incidents: safety.api.reporting,
    programme: scheduling.api.reporting,
    budget: { portfolioSummary: financials.api.budgetSummary },
    precon: precon.api,
    workforce: workforce.api,
    safety: safety.api,
    financials: financials.api,
    scheduling: scheduling.api,
  });

  const search = createSearchModule({
    database: services.database as Database,
    platform: platform.api,
    sources: {
      rfi: rfis.api,
      document: documents.api,
      defect: defects.api,
      submittal: submittals.api,
      correspondence: correspondence.api,
    },
  });

  const sync = createSyncModule(services, {
    access: access.api,
    sources: [
      defects.api.syncSource,
      diary.api.syncSource,
      rfis.api.syncSource,
      documents.api.syncSource,
      documents.api.drawingsSyncSource,
      workforce.api.syncSource,
      quality.api.syncSource,
      safety.api.syncSource,
    ],
    commands: [
      ...defects.api.syncCommands,
      ...diary.api.syncCommands,
      ...quality.api.syncCommands,
      ...safety.api.syncCommands,
      ...documents.api.syncCommands,
      ...files.api.syncCommands,
    ],
    accessState: platform.api.getProjectAccessState,
  });

  const all = [
    identity,
    platform,
    access,
    billing,
    backoffice,
    files,
    ai,
    documents,
    rfis,
    submittals,
    correspondence,
    conversations,
    defects,
    meetings,
    ownerportal,
    bim,
    notifications,
    bookmarks,
    recents,
    financials,
    quality,
    precon,
    safety,
    insurance,
    estimating,
    integrations,
    diary,
    scheduling,
    reporting,
    search,
    exportsModule,
    workforce,
    sync,
  ];
  const routes: RouteTable = {};
  for (const m of all) {
    for (const [id, handler] of Object.entries(m.routes)) {
      if (id in routes) throw new Error(`Operation ${id} registered by two modules`);
      (routes as Record<string, unknown>)[id] = handler;
    }
  }
  return {
    database: services.database as Database,
    identity,
    platform,
    access,
    billing,
    backoffice,
    files,
    ai,
    documents,
    rfis,
    submittals,
    correspondence,
    conversations,
    defects,
    meetings,
    ownerportal,
    bim,
    notifications,
    bookmarks,
    recents,
    financials,
    quality,
    precon,
    safety,
    insurance,
    estimating,
    integrations,
    sync,
    diary,
    scheduling,
    reporting,
    search,
    exportsModule,
    workforce,
    routes,
  };
}

export type Modules = Awaited<ReturnType<typeof loadModules>>;
