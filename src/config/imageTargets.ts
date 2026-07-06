export interface ImageTrackingTarget {
  targetIndex: number;
  image: string;
  displayName: string;
  model: string;
  modelUrl: string;
  defaultScale: number;
  defaultVerticalOffset: number;
}

export interface ImageTrackingConfig {
  databaseUrl: string;
  targets: readonly ImageTrackingTarget[];
}

export const imageTrackingConfig: ImageTrackingConfig = {
  databaseUrl: "/targets/targets.mind",
  targets: [
    {
      targetIndex: 0,
      image: "amihan",
      displayName: "Amihan",
      model: "mascot_amihan.glb",
      modelUrl: "/models/mascot_amihan.glb",
      defaultScale: 1,
      defaultVerticalOffset: 0
    },
    {
      targetIndex: 1,
      image: "apoy",
      displayName: "Apoy",
      model: "mascot_apoy.glb",
      modelUrl: "/models/mascot_apoy.glb",
      defaultScale: 1,
      defaultVerticalOffset: 0
    },
    {
      targetIndex: 2,
      image: "solido",
      displayName: "Solido",
      model: "mascot_solido.glb",
      modelUrl: "/models/mascot_solido.glb",
      defaultScale: 1,
      defaultVerticalOffset: 0
    },
    {
      targetIndex: 3,
      image: "ulan",
      displayName: "Ulan",
      model: "mascot_ulan.glb",
      modelUrl: "/models/mascot_ulan.glb",
      defaultScale: 1,
      defaultVerticalOffset: 0
    }
  ]
};
