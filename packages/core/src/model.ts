import { z } from "zod";

/** ISO-8601 timestamp string. */
export const Timestamp = z.iso.datetime({ offset: true });

export const User = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().min(1),
  avatarColor: z.string().optional(),
  createdAt: Timestamp,
});
export type User = z.infer<typeof User>;

/** Workspace-level roles. Document-level access is expressed separately via {@link ShareRole}. */
export const WorkspaceRole = z.enum(["owner", "admin", "member", "guest"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

export const Member = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  role: WorkspaceRole,
  joinedAt: Timestamp,
});
export type Member = z.infer<typeof Member>;

export const ModelChoice = z.object({
  providerId: z.string(),
  model: z.string(),
});
export type ModelChoice = z.infer<typeof ModelChoice>;

export const VoiceTrait = z.object({
  id: z.string(),
  label: z.string(),
  /** Human-readable description injected into prompts, e.g. "Short declarative sentences (avg 11 words)". */
  instruction: z.string(),
  enabled: z.boolean().default(true),
});
export type VoiceTrait = z.infer<typeof VoiceTrait>;

export const RetentionPolicy = z.object({
  /** Keep every automatic snapshot for this many days. */
  keepAllForDays: z.number().int().min(1).default(7),
  /** After that, keep one automatic snapshot per day for this many days. */
  keepDailyForDays: z.number().int().min(0).default(90),
  /** Named versions are never pruned; this flag exists only to make that explicit in exports. */
  keepNamed: z.literal(true).default(true),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

export const EditorPreferences = z.object({
  font: z.enum(["serif", "sans", "mono"]).default("serif"),
  measure: z.enum(["narrow", "medium", "wide"]).default("medium"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  spellcheck: z.boolean().default(true),
});
export type EditorPreferences = z.infer<typeof EditorPreferences>;

export const WorkspaceSettings = z.object({
  defaultModel: ModelChoice.optional(),
  houseRules: z.string().default(""),
  voice: z
    .object({
      learnFromPublished: z.boolean().default(true),
      traits: z.array(VoiceTrait).default([]),
    })
    .default({ learnFromPublished: true, traits: [] }),
  behaviour: z
    .object({
      inlineSuggestions: z.boolean().default(true),
      flagRepeatedPhrasing: z.boolean().default(true),
      showAssistantActivity: z.boolean().default(true),
    })
    .default({ inlineSuggestions: true, flagRepeatedPhrasing: true, showAssistantActivity: true }),
  retention: RetentionPolicy.default({ keepAllForDays: 7, keepDailyForDays: 90, keepNamed: true }),
  dailyGoalWords: z.number().int().min(0).default(500),
  updatedAt: Timestamp.optional(),
  updatedBy: z.string().optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const Workspace = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  createdAt: Timestamp,
  settings: WorkspaceSettings,
});
export type Workspace = z.infer<typeof Workspace>;

export const Collection = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().min(1).max(60),
  /** Hex colour, e.g. #C2410C. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number(),
});
export type Collection = z.infer<typeof Collection>;

export const DocumentStatus = z.enum(["draft", "in_review", "approved", "published", "archived"]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const DocumentMeta = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** A document belongs to at most one collection. */
  collectionId: z.string().nullable(),
  title: z.string(),
  status: DocumentStatus,
  ownerId: z.string(),
  isTemplate: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  wordCount: z.number().int().min(0).default(0),
  /** Per-document override of the workspace default model. */
  modelOverride: ModelChoice.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  publishedAt: Timestamp.optional(),
});
export type DocumentMeta = z.infer<typeof DocumentMeta>;

/** Who or what produced a version. Assistant edits are always attributed, never hidden. */
export const VersionAuthor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string() }),
  z.object({
    kind: z.literal("suggestion"),
    suggestionId: z.string(),
    suggestedBy: z.string(),
    acceptedBy: z.string(),
  }),
  z.object({
    kind: z.literal("assistant"),
    providerId: z.string(),
    model: z.string(),
    requestedBy: z.string(),
  }),
  z.object({ kind: z.literal("system"), reason: z.string() }),
]);
export type VersionAuthor = z.infer<typeof VersionAuthor>;

export const VersionReason = z.enum([
  "autosave",
  "checkpoint",
  "named",
  "restore",
  "assistant",
  "suggestion",
  "import",
  "sync-conflict",
  "voice",
]);
export type VersionReason = z.infer<typeof VersionReason>;

export const Version = z.object({
  id: z.string(),
  documentId: z.string(),
  createdAt: Timestamp,
  author: VersionAuthor,
  reason: VersionReason,
  /** Set for named checkpoints; named versions are never pruned. */
  name: z.string().optional(),
  stats: z.object({
    wordsAdded: z.number().int(),
    wordsRemoved: z.number().int(),
    wordCount: z.number().int(),
  }),
  /** Full document content at this version, as portable Markdown. */
  markdown: z.string(),
});
export type Version = z.infer<typeof Version>;

/**
 * A durable anchor into document text. `start`/`end` are encoded CRDT relative positions that survive
 * edits around them; `quote` plus context let us re-anchor or detect orphaning if they cannot be resolved.
 */
export const TextAnchor = z.object({
  start: z.string(),
  end: z.string(),
  quote: z.string(),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});
export type TextAnchor = z.infer<typeof TextAnchor>;

export const Comment = z.object({
  id: z.string(),
  authorId: z.string(),
  /** Display name at the time of writing, so comments from people not in this workspace still read well. */
  authorName: z.string().optional(),
  body: z.string().min(1),
  mentions: z.array(z.string()).default([]),
  createdAt: Timestamp,
  editedAt: Timestamp.optional(),
});
export type Comment = z.infer<typeof Comment>;

export const CommentThread = z.object({
  id: z.string(),
  documentId: z.string(),
  anchor: TextAnchor,
  status: z.enum(["open", "resolved"]),
  /** True when the anchored text was deleted; the thread is kept and shown detached. */
  orphaned: z.boolean().default(false),
  comments: z.array(Comment).min(1),
  resolvedBy: z.string().optional(),
  resolvedAt: Timestamp.optional(),
});
export type CommentThread = z.infer<typeof CommentThread>;

export const Suggestion = z.object({
  id: z.string(),
  documentId: z.string(),
  authorId: z.string(),
  anchor: TextAnchor,
  /** Text being replaced (empty for a pure insertion). */
  before: z.string(),
  /** Replacement text (empty for a pure deletion). */
  after: z.string(),
  status: z.enum(["pending", "accepted", "dismissed"]),
  createdAt: Timestamp,
  resolvedBy: z.string().optional(),
  resolvedAt: Timestamp.optional(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const ShareRole = z.enum(["view", "comment", "suggest", "edit"]);
export type ShareRole = z.infer<typeof ShareRole>;

export const DocumentShare = z.object({
  id: z.string(),
  documentId: z.string(),
  /** A specific user, or null for a link share. */
  userId: z.string().nullable(),
  role: ShareRole,
  /** Link token for link shares. */
  token: z.string().optional(),
  /** Public read-only links are only allowed for published documents. */
  public: z.boolean().default(false),
  expiresAt: Timestamp.optional(),
  createdBy: z.string(),
  createdAt: Timestamp,
});
export type DocumentShare = z.infer<typeof DocumentShare>;

const ROLE_RANK: Record<ShareRole, number> = { view: 0, comment: 1, suggest: 2, edit: 3 };

/** True when `role` grants at least the capability of `required`. */
export function roleAtLeast(role: ShareRole, required: ShareRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
