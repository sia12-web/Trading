import type { SupabaseClient } from '@supabase/supabase-js'

export function createMockSupabaseClient(): SupabaseClient<any, 'public', any> {
  const terminalResolvers: Record<string, any> = {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (onfulfilled: any, onrejected?: any) =>
      Promise.resolve({ data: [] as any[], error: null, count: 0 }).then(onfulfilled, onrejected),
    catch: (onrejected?: any) =>
      Promise.resolve({ data: [] as any[], error: null, count: 0 }).catch(onrejected),
    finally: (onfinally?: any) =>
      Promise.resolve({ data: [] as any[], error: null, count: 0 }).finally(onfinally),
  }

  const queryBuilder: any = new Proxy(terminalResolvers, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return target[prop]
      }
      if (typeof prop === 'symbol') {
        return (target as any)[prop]
      }
      return () => queryBuilder
    },
  })

  const mockAuth: any = {
    getUser: async () => ({
      data: {
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'desk@local',
          user_metadata: {},
          app_metadata: {},
        },
      },
      error: null,
    }),
    getSession: async () => ({
      data: { session: null },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  }

  const mockChannel: any = {
    on: () => mockChannel,
    subscribe: (cb?: (status: string) => void) => {
      if (cb) setTimeout(() => cb('SUBSCRIBED'), 0)
      return mockChannel
    },
    unsubscribe: () => mockChannel,
  }

  return {
    from: () => queryBuilder,
    auth: mockAuth,
    channel: () => mockChannel,
    removeChannel: async () => 'ok' as any,
  } as unknown as SupabaseClient<any, 'public', any>
}
