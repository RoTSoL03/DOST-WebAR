import { create } from "zustand";

import type { MascotId } from "../config/mascots";
import type { RuntimeKind, SessionStatus } from "../config/runtime";
import type { UserFacingError } from "../errors/userFacingError";
import type { CapabilityResult } from "../services/capabilities";

export type LoadingKind = "idle" | "capabilities" | "mascot";
export type CaptureStatus = "idle" | "capturing" | "ready" | "failed";
export type CacheStatus = "unknown" | "not-ready" | "ready" | "offline-unavailable";

export interface LoadingState {
  kind: LoadingKind;
  progress: number;
}

export interface SessionState {
  selectedMascotId: MascotId | null;
  runtimeKind: RuntimeKind | null;
  sessionStatus: SessionStatus;
  loading: LoadingState;
  captureStatus: CaptureStatus;
  cacheStatus: CacheStatus;
  error: UserFacingError | null;
  capabilities: CapabilityResult | null;
  desktopDebugOverride: boolean;
}

export interface SessionActions {
  beginCapabilityCheck: () => void;
  applyCapabilities: (capabilities: CapabilityResult) => void;
  enableDesktopDebugOverride: () => void;
  selectMascot: (mascotId: MascotId) => void;
  markMascotLoaded: () => void;
  requestPermission: () => void;
  startRuntime: () => void;
  enterPlacement: () => void;
  markMascotPlaced: () => void;
  beginCapture: () => void;
  markCaptureReady: () => void;
  endSession: () => void;
  setCacheStatus: (cacheStatus: CacheStatus) => void;
  setError: (error: UserFacingError) => void;
  clearError: () => void;
  reset: () => void;
}

export type SessionStore = SessionState & SessionActions;

export const initialSessionState: SessionState = {
  selectedMascotId: null,
  runtimeKind: null,
  sessionStatus: "idle",
  loading: { kind: "idle", progress: 0 },
  captureStatus: "idle",
  cacheStatus: "unknown",
  error: null,
  capabilities: null,
  desktopDebugOverride: false
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialSessionState,
  beginCapabilityCheck: () =>
    set({
      sessionStatus: "checkingCapabilities",
      loading: { kind: "capabilities", progress: 0 },
      error: null
    }),
  applyCapabilities: (capabilities) =>
    set({
      capabilities,
      runtimeKind:
        capabilities.runtimeRecommendation === "unsupported"
          ? null
          : capabilities.runtimeRecommendation,
      sessionStatus:
        capabilities.runtimeRecommendation === "unsupported" ? "unsupported" : "readyToStart",
      loading: { kind: "idle", progress: 1 }
    }),
  enableDesktopDebugOverride: () =>
    set((state) => ({
      desktopDebugOverride: true,
      sessionStatus: "readyToStart",
      runtimeKind:
        state.capabilities?.runtimeRecommendation === "unsupported"
          ? "camera-composition"
          : (state.capabilities?.runtimeRecommendation ?? null),
      error: null
    })),
  selectMascot: (mascotId) =>
    set({
      selectedMascotId: mascotId,
      sessionStatus: "loadingMascot",
      loading: { kind: "mascot", progress: 0 },
      captureStatus: "idle",
      error: null
    }),
  markMascotLoaded: () =>
    set({
      sessionStatus: "readyToStart",
      loading: { kind: "idle", progress: 1 }
    }),
  requestPermission: () => set({ sessionStatus: "requestingPermission" }),
  startRuntime: () => set({ sessionStatus: "startingRuntime" }),
  enterPlacement: () => set({ sessionStatus: "detectingSurface" }),
  markMascotPlaced: () => set({ sessionStatus: "mascotPlaced" }),
  beginCapture: () => set({ sessionStatus: "capturing", captureStatus: "capturing" }),
  markCaptureReady: () => set({ sessionStatus: "captureReady", captureStatus: "ready" }),
  endSession: () =>
    set({
      sessionStatus: "readyToStart",
      selectedMascotId: null,
      captureStatus: "idle",
      loading: { kind: "idle", progress: 0 }
    }),
  setCacheStatus: (cacheStatus) => set({ cacheStatus }),
  setError: (error) =>
    set({
      error,
      sessionStatus: "error",
      loading: { kind: "idle", progress: 0 },
      captureStatus: "failed"
    }),
  clearError: () =>
    set({
      error: null,
      sessionStatus: "idle",
      captureStatus: "idle",
      loading: { kind: "idle", progress: 0 }
    }),
  reset: () => set(initialSessionState)
}));
