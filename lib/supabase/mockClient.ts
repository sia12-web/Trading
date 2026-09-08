import type { SupabaseClient } from '@supabase/supabase-js'

export function createMockSupabaseClient(): SupabaseClient<any, 'public', any> {
  const queryBuilder: any = {
    select: () => queryBuilder,
    insert: () => queryBuilder,
    update: () => queryBuilder,
    upsert: () => queryBuilder,
    delete: () => queryBuilder,
    eq: () => queryBuilder,
    neq: () => queryBuilder,
    gt: () => queryBuilder,
    gte: () => queryBuilder,
    lt: () => queryBuilder,
    lte: () => queryBuilder,
    in: () => queryBuilder,
    is: () => queryBuilder,
    order: () => queryBuilder,
    limit: () => queryBuilder,
    range: () => queryBuilder,
    match: () => queryBuilder,
    filter: () => queryBuilder,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (onfulfilled: any, onrejected?: any) =>
      Promise.resolve({ data: [] as any[], error: null, count: 0 }).then(onfulfilled, onrejected),
  }

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
