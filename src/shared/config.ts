import type { AppConfig, ModelPreset } from './types.js'

export const CONFIG_VERSION = 1

export const DEFAULT_PRESETS: ModelPreset[] = [
  { id: 'coder', name: 'Coder', temperature: 0.3, topP: 0.9, maxTokens: 4096 },
  { id: 'review', name: 'Code Review', temperature: 0.15, topP: 0.85, maxTokens: 4096 },
  { id: 'free', name: 'Free-thinking', temperature: 0.8, topP: 0.95, maxTokens: 4096 }
]

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  send: 'Ctrl+Enter',
  stop: 'Escape',
  newChat: 'Ctrl+T',
  focusInput: 'Ctrl+L',
  clearChat: 'Ctrl+K',
  settings: 'Ctrl+,',
  search: 'Ctrl+F'
}

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    endpoints: [{ id: 'local', name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1' }],
    activeEndpointId: 'local',
    lastModel: null,
    presets: DEFAULT_PRESETS,
    activePresetId: 'coder',
    effort: 'high',
    permissionMode: 'manual',
    agent: {
      persona: '',
      // A hard ceiling above every effort level's own step budget.
      maxIterations: 100,
      toolTimeoutMs: 30_000,
      parallelTools: true,
      contextUtilisation: 0.8,
      contextTokensOverride: null,
      thinkAfterEachTool: true,
      autoCompactAt: 0.92,
      maxToolOutputChars: 30_000
    },
    permissions: {
      allow: ['read_file', 'glob', 'grep', 'list_dir', 'web_fetch', 'web_search'],
      deny: []
    },
    appearance: {
      theme: 'system',
      highContrast: false,
      accent: '#d97757',
      fontSize: 14,
      interfaceFont: 'system',
      codeFont: '',
      transcriptSize: 'medium',
      transcriptWidth: 'narrow',
      syntaxTheme: 'flashgent',
      showLineNumbers: true,
      collapseCodeOverLines: 20
    },
    mcpServers: [],
    keybindings: { ...DEFAULT_KEYBINDINGS },
    telemetryOptIn: false,
    onboardingCompleted: false,
    allowBypassMode: false
  }
}

/**
 * Merge a config read from disk over the defaults so that a config written by
 * an older build still gains any keys added since.
 */
export function mergeConfig(partial: unknown): AppConfig {
  const base = defaultConfig()
  if (!partial || typeof partial !== 'object') return base
  const p = partial as Partial<AppConfig>

  return {
    ...base,
    ...p,
    agent: { ...base.agent, ...(p.agent ?? {}) },
    permissions: { ...base.permissions, ...(p.permissions ?? {}) },
    appearance: { ...base.appearance, ...(p.appearance ?? {}) },
    keybindings: { ...base.keybindings, ...(p.keybindings ?? {}) },
    endpoints: p.endpoints?.length ? p.endpoints : base.endpoints,
    presets: p.presets?.length ? p.presets : base.presets,
    mcpServers: p.mcpServers ?? base.mcpServers,
    version: CONFIG_VERSION
  }
}
