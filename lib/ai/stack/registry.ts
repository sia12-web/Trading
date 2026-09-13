/**
 * Desk Agent Registry
 *
 * Provides a scalable, decoupled registry for registering, retrieving,
 * and executing agents in the Multi-Agent Stack (MAS).
 */

import type { DeskAgent, AgentRole } from './types'

export class AgentRegistry {
  private static instance: AgentRegistry
  private agents: Map<string, DeskAgent<any, any>> = new Map()

  private constructor() {}

  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry()
    }
    return AgentRegistry.instance
  }

  public register(agent: DeskAgent<any, any>): void {
    if (this.agents.has(agent.metadata.id)) {
      console.warn(`[AgentRegistry] Overwriting existing agent: ${agent.metadata.id}`)
    }
    this.agents.set(agent.metadata.id, agent)
  }

  public get<T extends DeskAgent<any, any>>(id: string): T | undefined {
    return this.agents.get(id) as T | undefined
  }

  public getByRole(role: AgentRole): DeskAgent<any, any>[] {
    return Array.from(this.agents.values()).filter((a) => a.metadata.role === role && a.metadata.enabled)
  }

  public list(): DeskAgent<any, any>[] {
    return Array.from(this.agents.values())
  }

  public unregister(id: string): boolean {
    return this.agents.delete(id)
  }

  public clear(): void {
    this.agents.clear()
  }
}

export const agentRegistry = AgentRegistry.getInstance()
