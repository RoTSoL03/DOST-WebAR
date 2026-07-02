export type MascotId = "mascot-alpha" | "mascot-amihan" | "mascot-ulan" | "mascot-apoy";

export interface MascotManifestEntry {
  id: MascotId;
  displayName: string;
  modelUrl: string;
  quickLookUrl: string;
  thumbnailUrl: string;
  version: string;
  defaultScale: number;
  defaultVerticalOffset: number;
}

export const mascotManifest: readonly MascotManifestEntry[] = [
  {
    id: "mascot-alpha",
    displayName: "Solido",
    modelUrl: "/models/mascot_solido.glb",
    quickLookUrl: "/models/mascot_solido.usdz",
    thumbnailUrl: "/icons/mascot-alpha.png",
    version: "sample",
    defaultScale: 1,
    defaultVerticalOffset: 0
  },
  {
    id: "mascot-amihan",
    displayName: "Amihan",
    modelUrl: "/models/mascot_amihan.glb",
    quickLookUrl: "/models/mascot_amihan.usdz",
    thumbnailUrl: "/icons/mascot-amihan.png",
    version: "sample",
    defaultScale: 1,
    defaultVerticalOffset: 0
  },
  {
    id: "mascot-ulan",
    displayName: "Ulan",
    modelUrl: "/models/mascot_ulan.glb",
    quickLookUrl: "/models/mascot_ulan.usdz",
    thumbnailUrl: "/icons/mascot-ulan.png",
    version: "sample",
    defaultScale: 1,
    defaultVerticalOffset: 0
  },
  {
    id: "mascot-apoy",
    displayName: "Apoy",
    modelUrl: "/models/mascot_apoy.glb",
    quickLookUrl: "/models/mascot_apoy.usdz",
    thumbnailUrl: "/icons/mascot-apoy.png",
    version: "sample",
    defaultScale: 1,
    defaultVerticalOffset: 0
  }
];

export function getMascotById(mascotId: MascotId | null): MascotManifestEntry | null {
  return mascotManifest.find((mascot) => mascot.id === mascotId) ?? null;
}
