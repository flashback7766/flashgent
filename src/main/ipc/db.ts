import {
  CH,
  type SessionCreateInput,
  type SessionSearchQuery,
  type Snippet
} from '../../shared/ipc.js'
import type { Message, Session } from '../../shared/types.js'
import * as store from '../db/index.js'
import { handle, handleN } from './result.js'

export function registerDbHandlers(): void {
  handle<void, Session[]>(CH.dbSessionList, () => {
    return store.listSessions()
  })
  handle<SessionCreateInput, Session>(CH.dbSessionCreate, (input) => {
    return store.createSession(input)
  })
  handleN<Session>(CH.dbSessionUpdate, (id: string, patch: Partial<Session>) => {
    return store.updateSession(id, patch)
  })
  handleN<boolean>(CH.dbSessionDelete, (id: string) => {
    return store.deleteSession(id)
  })
  handleN<Session>(CH.dbSessionFork, (id: string, upto: string) => {
    return store.forkSession(id, upto)
  })

  handleN<Message[]>(CH.dbMessageList, (sessionId: string) => {
    return store.listMessages(sessionId)
  })
  handle<Message, Message>(CH.dbMessageAppend, (message) => {
    return store.appendMessage(message)
  })
  handleN<Message>(CH.dbMessageUpdate, (id: string, patch: Partial<Message>) => {
    return store.updateMessage(id, patch)
  })
  handleN<number>(CH.dbMessageTruncate, (sessionId: string, messageId: string) => {
    return store.truncateFrom(sessionId, messageId)
  })

  handle<SessionSearchQuery, ReturnType<typeof store.search>>(CH.dbSearch, (query) => {
    return store.search(query)
  })

  handle<void, Snippet[]>(CH.dbSnippetList, () => {
    return store.listSnippets()
  })
  handle<Omit<Snippet, 'id' | 'createdAt'>, Snippet>(CH.dbSnippetCreate, (s) => {
    return store.createSnippet(s)
  })
  handleN<boolean>(CH.dbSnippetDelete, (id: string) => {
    return store.deleteSnippet(id)
  })
}
