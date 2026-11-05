import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' })

// Better Auth tables
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  role: text('role').notNull().default('reader'),
  personId: text('person_id'),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: ts('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
})

// Application tables
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  personId: text('person_id'),
  // Set when the link signs an existing user back in instead of creating one.
  userId: text('user_id'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
})

export const persons = sqliteTable('persons', {
  id: text('id').primaryKey(),
  givenName: text('given_name').notNull().default(''),
  surname: text('surname').notNull().default(''),
  maidenName: text('maiden_name').notNull().default(''),
  patronymic: text('patronymic').notNull().default(''),
  otherNames: text('other_names').notNull().default(''),
  sex: text('sex').notNull().default('U'),
  // Dates are free text ("~1876", "1883 or 1886"); the year is only for sorting and display.
  birthDate: text('birth_date').notNull().default(''),
  birthYear: integer('birth_year'),
  birthPlace: text('birth_place').notNull().default(''),
  deathDate: text('death_date').notNull().default(''),
  deathYear: integer('death_year'),
  deathPlace: text('death_place').notNull().default(''),
  living: integer('living', { mode: 'boolean' }).notNull().default(true),
  certainty: text('certainty').notNull().default('family'),
  avatarMediaId: text('avatar_media_id'),
  avatarCrop: text('avatar_crop'),
  updatedAt: integer('updated_at').notNull().default(0),
  // Labels that group people ("Соколовы", "Фронт"), and dated facts (job, move, service).
  tags: text('tags').notNull().default('[]'),
  facts: text('facts').notNull().default('[]'),
  // Where the record comes from: archive, file reference, sheet, link.
  sources: text('sources').notNull().default('[]'),
  // Versions of a value, each with its source and status.
  claims: text('claims').notNull().default('[]'),
})

// Tracked tables deliberately have no foreign keys: undo re-creates rows in any order,
// and purgeOrphans() keeps references consistent.
export const parentChild = sqliteTable('parent_child', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  kind: text('kind').notNull().default('birth'),
  certainty: text('certainty').notNull().default('family'),
}, (t) => [uniqueIndex('parent_child_pair').on(t.parentId, t.childId), index('parent_child_child').on(t.childId)])

export const unions = sqliteTable('unions', {
  id: text('id').primaryKey(),
  aId: text('a_id').notNull(),
  bId: text('b_id').notNull(),
  kind: text('kind').notNull().default('marriage'),
  startDate: text('start_date').notNull().default(''),
  endDate: text('end_date').notNull().default(''),
  place: text('place').notNull().default(''),
  certainty: text('certainty').notNull().default('family'),
}, (t) => [uniqueIndex('unions_pair').on(t.aId, t.bId), index('unions_b').on(t.bId)])

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull(),
  parentPageId: text('parent_page_id'),
  title: text('title').notNull().default(''),
  icon: text('icon').notNull().default(''),
  position: real('position').notNull().default(0),
  content: text('content').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull().default(0),
}, (t) => [index('pages_person').on(t.personId), index('pages_parent').on(t.parentPageId)])

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('image'),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull().default(''),
  mime: text('mime').notNull(),
  width: integer('width').notNull().default(0),
  height: integer('height').notNull().default(0),
  size: integer('size').notNull().default(0),
  caption: text('caption').notNull().default(''),
  date: text('date').notNull().default(''),
  place: text('place').notNull().default(''),
  uploadedBy: text('uploaded_by').notNull().default(''),
  createdAt: integer('created_at').notNull().default(0),
}, (t) => [index('media_created').on(t.createdAt)])

// Boxes are fractions of the photo size, so they survive any thumbnail. Null box: person
// is on the photo, but no frame has been drawn yet.
export const mediaTags = sqliteTable('media_tags', {
  id: text('id').primaryKey(),
  mediaId: text('media_id').notNull(),
  // Empty when someone on the photo has no card: a colleague, a neighbour. Then only `label` says who.
  personId: text('person_id'),
  label: text('label'),
  x: real('x'),
  y: real('y'),
  w: real('w'),
  h: real('h'),
}, (t) => [index('media_tags_media').on(t.mediaId), index('media_tags_person').on(t.personId)])

export const history = sqliteTable('history', {
  id: text('id').primaryKey(),
  at: integer('at').notNull(),
  userId: text('user_id').notNull().default(''),
  actorName: text('actor_name').notNull().default(''),
  summary: text('summary').notNull(),
  personIds: text('person_ids').notNull().default('[]'),
  changes: text('changes').notNull().default('[]'),
  key: text('key'),
  undoOf: text('undo_of'),
  undoneAt: integer('undone_at'),
  tokenId: text('token_id'),
}, (t) => [index('history_at').on(t.at)])

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  // 'reader' sees what a reader sees; 'editor' can propose or make changes.
  role: text('role').notNull(),
  // Writes wait in the review queue unless the owner turned this off.
  review: integer('review', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at'),
  // A token for one job can end by itself. Null means it lasts until revoked.
  expiresAt: integer('expires_at'),
})

// One open draft per token collects its operations until a person accepts or rejects it.
export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  tokenId: text('token_id').notNull(),
  tokenName: text('token_name').notNull(),
  status: text('status').notNull().default('pending'),
  ops: text('ops').notNull().default('[]'),
  idMap: text('id_map').notNull().default('{}'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
  resolvedBy: text('resolved_by'),
  historyId: text('history_id'),
}, (t) => [index('proposals_status').on(t.status)])

// Which part of the family to show and how. Nothing here is a fact about the family, so it is not in the history.
// The row with the id `main` holds hand placements for the chart with nothing filtered.
export const views = sqliteTable('views', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  scope: text('scope').notNull().default('all'),
  focusId: text('focus_id'),
  collapsed: text('collapsed').notNull().default('[]'),
  pins: text('pins').notNull().default('{}'),
  createdBy: text('created_by').notNull().default(''),
  updatedAt: integer('updated_at').notNull().default(0),
})

