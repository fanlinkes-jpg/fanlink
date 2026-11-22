/** Sustituto vacío para el bundle de servidor. El navegador carga dash.js y hls.js de verdad. */
class PlayerStub {
  static isSupported(): boolean {
    return false;
  }

  destroy(): void {}

  on(): void {}

  loadSource(): void {}

  attachMedia(): void {}

  reset(): void {}

  initialize(): void {}

  updateSettings(): void {}

  setProtectionData(): void {}
}

export function MediaPlayer(): { create: () => PlayerStub } {
  return { create: () => new PlayerStub() };
}

export default PlayerStub;
