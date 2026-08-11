import { CH, type SessionCreateInput, type SessionSearchQuery, type Snippet } from '../../shared/ipc.js'
import type { Message, Session } from '../../shared/types.js'
import * as store from '../db/index.js'
import { handle, handleN } from './result.js'

export function registerDbHandlers(): void {
  handle<void, Session[]>(CH.dbSessionList, () => store.listSessions())
  handle<SessionCreateInput, Session>(CH.dbSessionCreate, (input) => store.createSession(input))
  handleN<Session>(CH.dbSessionUpdate, (id: string, patch: Partial<Session>) =>
    store.updateSession(id, patch)
  )
  handleN<boolean>(CH.dbSessionDelete, (id: string) => store.deleteSession(id))
  handleN<Session>(CH.dbSessionFork, (id: string, upto: string) => store.forkSession(id, upto))

  handleN<Message[]>(CH.dbMessageList, (sessionId: string) => store.listMessages(sessionId))
  handle<Message, Message>(CH.dbMessageAppend, (message) => store.appendMessage(message))
  handleN<Message>(CH.dbMessageUpdate, (id: string, patch: Partial<Message>) =>
    store.updateMessage(id, patch)
  )
  handleN<number>(CH.dbMessageTruncate, (sessionId: string, messageId: string) =>
    store.truncateFrom(sessionId, messageId)
  )

  handle<SessionSearchQuery, ReturnType<typeof store.search>>(CH.dbSearch, (query) =>
    store.search(query)
  )

  handle<void, Snippet[]>(CH.dbSnippetList, () => store.listSnippets())
  handle<Omit<Snippet, 'id' | 'createdAt'>, Snippet>(CH.dbSnippetCreate, (s) =>
    store.createSnippet(s)
  )
  handleN<boolean>(CH.dbSnippetDelete, (id: string) => store.deleteSnippet(id))
}
