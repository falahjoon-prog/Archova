// F26 / X58 on-demand induction translation (ai/12 §2 I4, compliance/08 §4, compliance/03 §6). The approved English
// version is translated slide by slide and question by question, with numbers, phone numbers, codes and kept terms
// protected by placeholders. Each slide's translation is translated back and checked; a slide or question that
// fails stays in English with "ask your supervisor" in the worker's language. The result is cached per version,
// language, glossary and prompt version, and its hash goes in the worker's completion record. The English version
// stays the official one.
//
// A module API function, not a route: `workforce` calls it from the worker's route once the X45 access link has
// authorised the worker for that induction (Sam). Until then, tests call it with a stub version.
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { translatePrompt, translationCheckPrompt } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext } from '@archova/kernel';
import {
  TRANSLATION_LANGUAGES,
  glossaryFor,
  protectText,
  restoreText,
  type TranslationLanguage,
} from '../domain/translation';
import { translations } from '../infra/tables';
import { mapLimit } from './drawing-register';
import type { Gateway } from './gateway';
import type { InductionVersionContent } from './induction-qa';

export interface InductionTranslationDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  /** Defaults to TRANSLATION_LANGUAGES; tests pass an enabled test language. */
  languages?: readonly TranslationLanguage[];
}

/** One slide as the worker sees it: translated, or the English with the kept-in-English note. */
export interface TranslatedSlide {
  slide: number;
  translated: boolean;
  title: string;
  points: string[];
  script: string[];
}

export interface TranslatedQuestion {
  id: string;
  translated: boolean;
  question: string;
  options: string[];
}

export interface InductionTranslation {
  language: string;
  nativeName: string;
  /** Fixed label: "Machine translation for understanding. The English version is the official one." */
  label: string;
  /** Fixed note shown on anything left in English. */
  keptInEnglish: string;
  versionId: string;
  version: number;
  glossaryVersion: number;
  slides: TranslatedSlide[];
  quiz: TranslatedQuestion[];
  /** Share of slides and questions translated; the rest are in English. */
  backTranslationScore: number;
  /** SHA-256 of what the worker sees, for the completion's evidence record (compliance/04 §3). */
  translationHash: string;
}

/** Slides and questions translated at once. */
const CONCURRENCY = 4;

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

type Unit = Array<{ id: string; text: string }>;

export function createInductionTranslationService(deps: InductionTranslationDeps) {
  const { database } = deps;
  const languages = deps.languages ?? TRANSLATION_LANGUAGES;

  /** Languages a worker may pick: only those reviewed and passing their eval. */
  function availableLanguages() {
    return languages
      .filter((l) => l.enabled && l.labels)
      .map((l) => ({ code: l.code, name: l.name, nativeName: l.nativeName }));
  }

  /**
   * Translates one unit (a slide's items, or a question and its options). Returns the translated texts by id, or
   * null when anything fails: a refusal, a missing item, a changed placeholder, or a meaning check that fails.
   */
  async function translateUnit(
    ctx: TenantContext,
    lang: TranslationLanguage,
    projectId: string,
    unit: Unit,
  ): Promise<Map<string, string> | null> {
    const protectedItems = unit.map((u) => ({ id: u.id, ...protectText(u.text) }));
    const glossary = glossaryFor(unit.map((u) => u.text).join('\n'), lang.glossary);
    const run = await deps.gateway.runTask(
      ctx,
      translatePrompt,
      {
        language: lang.name,
        glossary,
        items: protectedItems.map((p) => ({ id: p.id, text: p.text })),
      },
      { projectId },
    );
    if (run.status !== 'ok') return null;
    const raw = new Map(run.output.items.map((i) => [i.id, i.text]));
    const restored = new Map<string, string>();
    for (const p of protectedItems) {
      const t = raw.get(p.id);
      const back = t === undefined ? null : restoreText(t, p.tokens);
      if (back === null || !back.trim()) return null;
      restored.set(p.id, back);
    }

    const check = await deps.gateway.runTask(
      ctx,
      translationCheckPrompt,
      {
        language: lang.name,
        items: protectedItems.map((p) => ({
          id: p.id,
          english: p.text,
          translated: raw.get(p.id)!,
        })),
      },
      { projectId },
    );
    if (check.status !== 'ok') return null;
    const verdicts = new Map(check.output.items.map((i) => [i.id, i.meaningPreserved]));
    if (!protectedItems.every((p) => verdicts.get(p.id) === true)) return null;
    return restored;
  }

  /** The induction version in the worker's language, translated on first request and then served from cache. */
  async function translate(
    ctx: TenantContext,
    version: InductionVersionContent,
    languageCode: string,
  ): Promise<InductionTranslation> {
    const lang = languages.find((l) => l.code === languageCode);
    if (!lang || !lang.enabled || !lang.labels)
      throw new AppError(
        'ai.translation.language_unavailable',
        "Nova doesn't translate into this language yet. The English version is available.",
      );
    const labels = lang.labels;
    const english = { slides: version.slides, quiz: version.quiz ?? [] };
    const sourceHash = sha256(english);
    const key = and(
      eq(translations.sourceType, 'induction_version'),
      eq(translations.sourceId, version.versionId),
      eq(translations.sourceHash, sourceHash),
      eq(translations.language, lang.code),
      eq(translations.glossaryVersion, lang.glossary.version),
      eq(translations.promptVersion, translatePrompt.version),
    );
    const cached = await database.withTenantTx(
      ctx,
      (scope) =>
        scope.tx.select({ payload: translations.payload }).from(translations).where(key).limit(1),
      { readOnly: true },
    );
    if (cached[0]) return cached[0].payload as InductionTranslation;

    const slideUnits: Unit[] = english.slides.map((s) => [
      { id: 't', text: s.title },
      ...s.points.map((text, i) => ({ id: `p${i}`, text })),
      ...s.script.map((text, i) => ({ id: `s${i}`, text })),
    ]);
    const quizUnits: Unit[] = english.quiz.map((q) => [
      { id: 'q', text: q.question },
      ...q.options.map((text, i) => ({ id: `o${i}`, text })),
    ]);
    const done = await mapLimit([...slideUnits, ...quizUnits], CONCURRENCY, (u) =>
      translateUnit(ctx, lang, version.projectId, u),
    );

    const slides: TranslatedSlide[] = english.slides.map((s, i) => {
      const t = done[i];
      return t
        ? {
            slide: i + 1,
            translated: true,
            title: t.get('t')!,
            points: s.points.map((_, j) => t.get(`p${j}`)!),
            script: s.script.map((_, j) => t.get(`s${j}`)!),
          }
        : {
            slide: i + 1,
            translated: false,
            title: s.title,
            points: [...s.points],
            script: [...s.script],
          };
    });
    const quiz: TranslatedQuestion[] = english.quiz.map((q, i) => {
      const t = done[slideUnits.length + i];
      return t
        ? {
            id: q.id,
            translated: true,
            question: t.get('q')!,
            options: q.options.map((_, j) => t.get(`o${j}`)!),
          }
        : { id: q.id, translated: false, question: q.question, options: [...q.options] };
    });
    const units = slides.length + quiz.length;
    const translatedCount = done.filter((d) => d !== null).length;
    const shown = { language: lang.code, label: labels.label, slides, quiz };
    const result: InductionTranslation = {
      language: lang.code,
      nativeName: lang.nativeName,
      label: labels.label,
      keptInEnglish: labels.keptInEnglish,
      versionId: version.versionId,
      version: version.version,
      glossaryVersion: lang.glossary.version,
      slides,
      quiz,
      backTranslationScore: units ? translatedCount / units : 1,
      translationHash: sha256(shown),
    };

    return database.withTenantTx(ctx, async (scope) => {
      await scope.tx
        .insert(translations)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId: version.projectId,
          sourceType: 'induction_version',
          sourceId: version.versionId,
          sourceHash,
          language: lang.code,
          glossaryVersion: lang.glossary.version,
          promptVersion: translatePrompt.version,
          payload: result,
          translationHash: result.translationHash,
          backTranslationScore: result.backTranslationScore,
          status: 'ready',
          createdBy: scope.ctx.userId,
        })
        .onConflictDoNothing();
      // Two workers asking at once: both translate, the first row wins and both get it.
      const [row] = await scope.tx
        .select({ payload: translations.payload })
        .from(translations)
        .where(key)
        .limit(1);
      return row!.payload as InductionTranslation;
    });
  }

  return { translate, availableLanguages };
}

export type InductionTranslationService = ReturnType<typeof createInductionTranslationService>;
