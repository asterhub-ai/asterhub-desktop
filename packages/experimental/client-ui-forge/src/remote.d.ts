/* Remote types and contribution for @deepseek-ai/dsh-experimental-client-ui-forge */
import type {
  RemoteResult,
  RemoteStreamHandle,
  TypertRemoteInfo,
  TypertRemoteMethod,
} from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MergeMethod } from '@deepseek-ai/dsh-experimental-forge'
import type {
  ForgeBranches,
  ForgeChangeRequestDiff,
  ForgeChangeRequestStatesFrame,
  ForgeLocalDiff,
  ForgeLocalScope,
  ForgePanelState,
} from './types.ts'

export interface TypertRemoteNamespaceForgePanel {
  follow: (session: SessionId, signal?: AbortSignal) => RemoteStreamHandle<ForgePanelState, never>
  changeRequestStates: (signal?: AbortSignal) => RemoteStreamHandle<ForgeChangeRequestStatesFrame, never>
  branches: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<ForgeBranches>>
  track: (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
  dismiss: (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
  refresh: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  localDiff: (session: SessionId, scope: ForgeLocalScope, signal?: AbortSignal) => Promise<RemoteResult<ForgeLocalDiff>>
  localText: (session: SessionId, scope: ForgeLocalScope, path: string, signal?: AbortSignal) => Promise<RemoteResult<string>>
  changeRequestDiff: (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<ForgeChangeRequestDiff>>
  changeRequestText: (session: SessionId, url: string, commit: string, path: string, signal?: AbortSignal) => Promise<RemoteResult<string>>
  markReady: (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
  merge: (session: SessionId, url: string, method: MergeMethod, headSha: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
  requestWorktree: (session: SessionId, from: string | null, signal?: AbortSignal) => Promise<RemoteResult<void>>
  cancelWorktree: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  stopCreation: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  retryWorktree: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  restoreWorktree: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  continueInProject: (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$666f72676550616e656c extends TypertRemoteNamespaceForgePanel {}
  interface TypertRemoteMap {
    'forgePanel/follow': (session: SessionId, signal?: AbortSignal) => RemoteStreamHandle<ForgePanelState, never>
    'forgePanel/changeRequestStates': (signal?: AbortSignal) => RemoteStreamHandle<ForgeChangeRequestStatesFrame, never>
    'forgePanel/branches': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<ForgeBranches>>
    'forgePanel/track': (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/dismiss': (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/refresh': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/localDiff': (session: SessionId, scope: ForgeLocalScope, signal?: AbortSignal) => Promise<RemoteResult<ForgeLocalDiff>>
    'forgePanel/localText': (session: SessionId, scope: ForgeLocalScope, path: string, signal?: AbortSignal) => Promise<RemoteResult<string>>
    'forgePanel/changeRequestDiff': (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<ForgeChangeRequestDiff>>
    'forgePanel/changeRequestText': (session: SessionId, url: string, commit: string, path: string, signal?: AbortSignal) => Promise<RemoteResult<string>>
    'forgePanel/markReady': (session: SessionId, url: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/merge': (session: SessionId, url: string, method: MergeMethod, headSha: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/requestWorktree': (session: SessionId, from: string | null, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/cancelWorktree': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/stopCreation': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/retryWorktree': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/restoreWorktree': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'forgePanel/continueInProject': (session: SessionId, signal?: AbortSignal) => Promise<RemoteResult<void>>
  }
  interface TypertRemoteNamespaceMap {
    'forgePanel': TypertRemoteNamespace$666f72676550616e656c
  }
}

export declare const TYPERT_REMOTE: TypertRemoteInfo<{
  readonly 'forgePanel/follow': TypertRemoteMethod<{ readonly 'session': SessionId }, ForgePanelState, 'stream'>
  readonly 'forgePanel/changeRequestStates': TypertRemoteMethod<{  }, ForgeChangeRequestStatesFrame, 'stream'>
  readonly 'forgePanel/branches': TypertRemoteMethod<{ readonly 'session': SessionId }, ForgeBranches>
  readonly 'forgePanel/track': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string }, void>
  readonly 'forgePanel/dismiss': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string }, void>
  readonly 'forgePanel/refresh': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
  readonly 'forgePanel/localDiff': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'scope': ForgeLocalScope }, ForgeLocalDiff>
  readonly 'forgePanel/localText': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'scope': ForgeLocalScope; readonly 'path': string }, string>
  readonly 'forgePanel/changeRequestDiff': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string }, ForgeChangeRequestDiff>
  readonly 'forgePanel/changeRequestText': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string; readonly 'commit': string; readonly 'path': string }, string>
  readonly 'forgePanel/markReady': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string }, void>
  readonly 'forgePanel/merge': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'url': string; readonly 'method': MergeMethod; readonly 'headSha': string }, void>
  readonly 'forgePanel/requestWorktree': TypertRemoteMethod<{ readonly 'session': SessionId; readonly 'from': string | null }, void>
  readonly 'forgePanel/cancelWorktree': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
  readonly 'forgePanel/stopCreation': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
  readonly 'forgePanel/retryWorktree': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
  readonly 'forgePanel/restoreWorktree': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
  readonly 'forgePanel/continueInProject': TypertRemoteMethod<{ readonly 'session': SessionId }, void>
}>
export default TYPERT_REMOTE
