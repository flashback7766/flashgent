import { describe, expect, it } from 'vitest'
import {
  AGENT_CONFIGS,
  resolveAgentRole,
  ArchitectIcon,
  EngineerIcon,
  AgentHeader
} from '../../src/renderer/components/MessageView.js'

describe('Visual Agent Separation and Role Attribution [D6]', () => {
  it('resolves agent role accurately based on agent or author fields', () => {
    expect(resolveAgentRole('architect', null)).toBe('architect')
    expect(resolveAgentRole('engineer', null)).toBe('engineer')
    expect(resolveAgentRole(null, 'engineer')).toBe('engineer')
    expect(resolveAgentRole(null, 'Engineer')).toBe('engineer')
    expect(resolveAgentRole(null, 'architect')).toBe('architect')
    expect(resolveAgentRole(null, 'Architect')).toBe('architect')
  })

  it('defaults cleanly to architect when agent and author are not specified or unknown', () => {
    expect(resolveAgentRole(undefined, undefined)).toBe('architect')
    expect(resolveAgentRole(null, null)).toBe('architect')
    expect(resolveAgentRole('', '')).toBe('architect')
    expect(resolveAgentRole('unknown_agent', 'unknown_author')).toBe('architect')
  })

  it('provides distinct configurations and constraints for Architect and Engineer', () => {
    const architect = AGENT_CONFIGS.architect
    const engineer = AGENT_CONFIGS.engineer

    expect(architect.role).toBe('architect')
    expect(architect.name).toBe('Architect')
    expect(architect.tag).toContain('Architecture')
    expect(architect.constraint).toBeDefined()
    expect(architect.avatarClass).toContain('indigo')
    expect(architect.badgeClass).toContain('indigo')

    expect(engineer.role).toBe('engineer')
    expect(engineer.name).toBe('Engineer')
    expect(engineer.tag).toContain('Execution')
    expect(engineer.constraint).toBeDefined()
    expect(engineer.avatarClass).toContain('emerald')
    expect(engineer.badgeClass).toContain('emerald')

    expect(architect.name).not.toBe(engineer.name)
    expect(architect.tag).not.toBe(engineer.tag)
    expect(architect.avatarClass).not.toBe(engineer.avatarClass)
  })

  it('exports icon and header components', () => {
    expect(ArchitectIcon).toBeDefined()
    expect(EngineerIcon).toBeDefined()
    expect(AgentHeader).toBeDefined()
  })
})
