import { exportAiSettings, importAiSettings } from '@/lib/ops/ai-config'
import { z } from 'zod'
import { chooseModel, connectProvider, modelChoices, currentProvider, disconnectProvider, keyBalance, providerStatus, answerChoices } from '@/lib/agent/provider-key'
import { requireRole } from '@/lib/ops/core'
import { acceptProposal, listProposals, myProposals, rejectProposal, removeProposalOp } from '@/lib/ops/proposals'
import * as settings from '@/lib/ops/settings'
import { createShare, listShares, revokeShare } from '@/lib/ops/share'
import { setupStatus } from '@/lib/ops/setup-status'
import { suggest } from '@/lib/ops/suggest'
import { updateStatus } from '@/lib/update-check'
import { applyUpdate, installKind, updateHow, updateRunning } from '@/lib/self-update'
import * as tokens from '@/lib/ops/tokens'
import { get, human, role, type Route } from '../router'
import { backupNow, backupStatus } from '@/lib/ops/auto-backup'
import { addKey, listServices, removeKey } from '@/lib/ai/services'
import { usageReport } from '@/lib/ai/usage'
import { METHODS, methodsStatus, removeMethod, saveMethod } from '@/lib/sign-in-methods'

const method = (id: string) => z.enum(METHODS).parse(id)

export const accessRoutes: Route[] = [
  get('proposals', 'Drafts waiting for review (people only)', ({ actor }) => listProposals(actor)),
  get('proposals/mine', "This token's recent drafts", ({ actor }) => myProposals(actor)),
  human('POST', 'proposals/:id/accept', 'Apply a draft', ({ actor, params }) => acceptProposal(actor, params.id)),
  human('POST', 'proposals/:id/reject', 'Reject a draft', ({ actor, params }) => rejectProposal(actor, params.id)),
  human('DELETE', 'proposals/:id/ops/:index', 'Drop one line of a draft', ({ actor, params }) => removeProposalOp(actor, params.id, Number(params.index))),

  human('POST', 'proposals/suggest', 'A reader suggests a correction', async ({ actor, body }) => suggest(actor, await body())),

  human('GET', 'shares', 'Links for viewing without an account', ({ actor }) => listShares(actor)),
  human('POST', 'shares', 'Make a link for viewing', async ({ actor, body }) => createShare(actor, await body())),
  human('DELETE', 'shares/:id', 'Close a link for viewing', ({ actor, params }) => revokeShare(actor, params.id)),

  human('GET', 'backups/status', 'When the server last copied the database by itself', ({ actor }) => backupStatus(actor)),
  human('POST', 'backups/now', 'Copy the database on the server now', ({ actor }) => backupNow(actor)),
  human('GET', 'setup/status', 'What is set up and what is missing', ({ actor, req }) => setupStatus(actor, req.headers)),

  human('GET', 'update', 'Whether a newer release exists, and how this install updates, for the owner', async ({ actor }) => {
    const status = await updateStatus(actor)
    return { ...status, how: status.latest ? updateHow(installKind(), status.latest) : null, updating: updateRunning() }
  }),
  human('POST', 'update', 'Update now, where the install can do it by itself: a checked copy of the database first', ({ actor }) => applyUpdate(actor)),

  human('GET', 'tokens', 'API tokens', ({ actor }) => tokens.listTokens(actor)),
  human('POST', 'tokens', 'Issue an API token', async ({ actor, body }) => tokens.createToken(actor, z.object({ expiresInDays: z.number().int().min(1).max(3650).nullish(), name: z.string().min(1), role: z.enum(['reader', 'editor']), review: z.boolean().default(true) }).parse(await body()))),
  human('DELETE', 'tokens/:id', 'Revoke an API token', ({ actor, params }) => tokens.revokeToken(actor, params.id)),

  human('GET', 'settings', 'Archive settings', () => ({ familyName: settings.getSetting('familyName') ?? '', language: settings.getSetting('language') ?? 'ru', assistantEnabled: settings.getSetting('assistantEnabled') === '1', assistantForReaders: settings.getSetting('assistantForReaders') === '1', assistantProvider: currentProvider()?.label ?? null, assistantModel: currentProvider()?.model ?? null })),
  human('PATCH', 'settings', 'Change archive settings', async ({ actor, body }) => {
    requireRole(actor, 'owner')
    const b = z.object({ familyName: z.string().min(1), language: z.enum(['ru', 'en', 'es', 'ca']), assistantEnabled: z.enum(['0', '1']), assistantForReaders: z.enum(['0', '1']), }).partial().parse(await body())
    Object.entries(b).forEach(([k, v]) => settings.setSetting(k, v!))
  }),
  human('GET', 'invites', 'Open invitations', ({ actor }) => settings.listInvites(actor)),
  human('POST', 'invites', 'Create an invitation', async ({ actor, body }) => settings.createInvite(actor, z.object({ name: z.string().min(1), role, personId: z.string().nullish(), userId: z.string().nullish() }).parse(await body()))),
  human('DELETE', 'invites/:id', 'Revoke an invitation', ({ actor, params }) => settings.revokeInvite(actor, params.id)),
  human('GET', 'users', 'People with access', ({ actor }) => settings.listUsers(actor)),
  human('GET', 'sign-in-methods', 'Ways into the archive besides an invitation', ({ actor }) => methodsStatus(actor)),
  human('PUT', 'sign-in-methods/:id', 'Switch a way of signing in on, with its keys', async ({ actor, params, body }) => saveMethod(actor, method(params.id), await body())),
  human('DELETE', 'sign-in-methods/:id', 'Switch a way of signing in off', ({ actor, params }) => removeMethod(actor, method(params.id))),
  human('GET', 'ai-settings', 'Everything chosen about the AI, as a file with no keys in it', ({ actor }) => exportAiSettings(actor)),
  human('PUT', 'ai-settings', 'Apply such a file: what can be applied is, and the rest is named', async ({ actor, body }) => importAiSettings(actor, await body())),
  human('GET', 'assistant/provider', 'Which AI provider is connected', ({ actor }) => providerStatus(actor)),
  human('GET', 'assistant/choices', 'Services and models the owner added, to pick one for an answer', ({ actor }) => (actor.role === 'owner' ? answerChoices() : [])),
  human('GET', 'ai/usage', 'Who used which AI function this month, from real figures only', ({ actor }) => usageReport(actor)),
  human('GET', 'ai/keys', 'Keys to AI services, and which functions use each', ({ actor }) => listServices(actor)),
  human('PUT', 'ai/keys', 'Add a key to an AI service, checked with it first', async ({ actor, body }) => addKey(actor, await body())),
  human('DELETE', 'ai/keys/:service', 'Remove a key, and switch off what used it', ({ actor, params }) => removeKey(actor, params.service)),
  human('GET', 'assistant/provider/balance', 'What is left on the key, where the provider says it', ({ actor }) => keyBalance(actor)),
  human('PUT', 'assistant/provider', 'Connect an AI provider with a key', async ({ actor, body }) => connectProvider(actor, await body())),
  human('GET', 'assistant/provider/models', 'Models the connected key can use, newest first, with what each can do', ({ actor }) => modelChoices(actor)),
  human('PATCH', 'assistant/provider', 'Choose another model', async ({ actor, body }) => chooseModel(actor, await body())),
  human('DELETE', 'assistant/provider', 'Remove the key set in the app', ({ actor }) => disconnectProvider(actor)),
  human('PATCH', 'users/:id', 'Change a role', async ({ actor, params, body }) => settings.setUserRole(actor, params.id, z.object({ role }).parse(await body()).role)),
  human('DELETE', 'users/:id', 'Remove access', ({ actor, params }) => settings.removeUser(actor, params.id)),
]
