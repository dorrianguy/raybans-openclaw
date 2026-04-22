/**
 * Agent Store — Manages agent states and responses with Zustand.
 *
 * Tracks:
 * - List of agents and their enabled/disabled status
 * - Agent responses (with priority ordering)
 * - Current routing mode
 * - Processing state
 */

import { create } from 'zustand';
import type { AgentResponse, AgentInfo, RoutingMode, RoutingDecision, VoiceCommand } from '../services/backend-client';
import { AGENT_IDS } from '../utils/constants';

// ─── State ──────────────────────────────────────────────────────

export interface AgentResponseWithMeta extends AgentResponse {
  /** When this response was received */
  receivedAt: number;
  /** Whether the response has been spoken via TTS */
  spoken: boolean;
  /** Whether the user has dismissed this response */
  dismissed: boolean;
}

export interface AgentStoreState {
  // Agents
  agents: AgentInfo[];
  agentsLoaded: boolean;

  // Routing
  currentMode: RoutingMode;
  lastRoutingDecision: RoutingDecision | null;

  // Responses
  responses: AgentResponseWithMeta[];
  maxResponses: number;

  // Voice
  lastVoiceCommand: VoiceCommand | null;
  voiceCommandHistory: VoiceCommand[];

  // Processing
  isProcessing: boolean;
  processingAgentId: string | null;
}

export interface AgentStoreActions {
  // Agents
  setAgents: (agents: AgentInfo[]) => void;
  toggleAgent: (agentId: string) => void;
  setAgentEnabled: (agentId: string, enabled: boolean) => void;

  // Routing
  setCurrentMode: (mode: RoutingMode) => void;
  setRoutingDecision: (decision: RoutingDecision) => void;

  // Responses
  addResponse: (response: AgentResponse) => void;
  markResponseSpoken: (agentId: string) => void;
  dismissResponse: (index: number) => void;
  clearResponses: () => void;

  // Voice
  setVoiceCommand: (command: VoiceCommand) => void;

  // Processing
  setProcessing: (processing: boolean, agentId?: string | null) => void;

  // Reset
  reset: () => void;
}

// ─── Default Agents ─────────────────────────────────────────────

const DEFAULT_AGENTS: AgentInfo[] = [
  { id: AGENT_IDS.NETWORKING, name: 'Networking', enabled: true, priority: 3 },
  { id: AGENT_IDS.DEAL_ANALYSIS, name: 'Deal Analysis', enabled: true, priority: 4 },
  { id: AGENT_IDS.SECURITY, name: 'Security', enabled: true, priority: 1 },
  { id: AGENT_IDS.MEETING, name: 'Meeting', enabled: true, priority: 3 },
  { id: AGENT_IDS.INSPECTION, name: 'Inspection', enabled: true, priority: 4 },
  { id: AGENT_IDS.MEMORY, name: 'Memory', enabled: true, priority: 5 },
  { id: AGENT_IDS.INVENTORY, name: 'Inventory', enabled: true, priority: 2 },
];

// ─── Initial State ──────────────────────────────────────────────

const initialState: AgentStoreState = {
  agents: DEFAULT_AGENTS,
  agentsLoaded: false,
  currentMode: 'general',
  lastRoutingDecision: null,
  responses: [],
  maxResponses: 50,
  lastVoiceCommand: null,
  voiceCommandHistory: [],
  isProcessing: false,
  processingAgentId: null,
};

// ─── Store ──────────────────────────────────────────────────────

export const useAgentStore = create<AgentStoreState & AgentStoreActions>(
  (set, get) => ({
    ...initialState,

    setAgents: (agents) => set({ agents, agentsLoaded: true }),

    toggleAgent: (agentId) =>
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, enabled: !a.enabled } : a,
        ),
      })),

    setAgentEnabled: (agentId, enabled) =>
      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, enabled } : a,
        ),
      })),

    setCurrentMode: (currentMode) => set({ currentMode }),

    setRoutingDecision: (decision) =>
      set({
        lastRoutingDecision: decision,
        currentMode: decision.mode,
      }),

    addResponse: (response) =>
      set((state) => {
        const withMeta: AgentResponseWithMeta = {
          ...response,
          receivedAt: Date.now(),
          spoken: false,
          dismissed: false,
        };

        const responses = [withMeta, ...state.responses].slice(0, state.maxResponses);
        return { responses };
      }),

    markResponseSpoken: (agentId) =>
      set((state) => ({
        responses: state.responses.map((r) =>
          r.agentId === agentId && !r.spoken ? { ...r, spoken: true } : r,
        ),
      })),

    dismissResponse: (index) =>
      set((state) => ({
        responses: state.responses.map((r, i) =>
          i === index ? { ...r, dismissed: true } : r,
        ),
      })),

    clearResponses: () => set({ responses: [] }),

    setVoiceCommand: (command) =>
      set((state) => ({
        lastVoiceCommand: command,
        voiceCommandHistory: [command, ...state.voiceCommandHistory].slice(0, 20),
      })),

    setProcessing: (isProcessing, processingAgentId = null) =>
      set({ isProcessing, processingAgentId }),

    reset: () => set(initialState),
  }),
);
