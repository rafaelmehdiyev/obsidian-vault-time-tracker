export type IdleMode = 'auto' | 'system' | 'window' | 'off';

type Electron = Record<string, unknown>;
type PowerMonitor = {
  getSystemIdleTime(): number;
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
};

export class IdleDetector {
  private mode: IdleMode;
  private lastActivityMs: number = Date.now();
  private windowListenerCleanup: (() => void) | null = null;

  constructor(mode: IdleMode) {
    this.mode = mode;
    if (mode !== 'off' && mode !== 'system') {
      this.attachWindowListeners();
    }
  }

  private attachWindowListeners(): void {
    const update = () => { this.lastActivityMs = Date.now(); };
    document.addEventListener('mousemove', update, { passive: true });
    document.addEventListener('keydown', update, { passive: true });
    document.addEventListener('scroll', update, { passive: true });
    document.addEventListener('click', update, { passive: true });
    this.windowListenerCleanup = () => {
      document.removeEventListener('mousemove', update);
      document.removeEventListener('keydown', update);
      document.removeEventListener('scroll', update);
      document.removeEventListener('click', update);
    };
  }

  getIdleSeconds(): number {
    if (this.mode === 'off') return 0;

    if (this.mode === 'system' || this.mode === 'auto') {
      const sysIdle = this.trySystemIdle();
      if (sysIdle !== null) return sysIdle;
      if (this.mode === 'system') return 0; // strict mode: no fallback
    }

    return this.windowIdleSeconds();
  }

  private trySystemIdle(): number | null {
    try {
      const req = (window as unknown as { require?: (m: string) => Electron })['require'];
      if (!req) return null;
      const electron = req('electron');
      const pm = (electron['remote'] as Electron | undefined)?.['powerMonitor'] ?? electron['powerMonitor'];
      if (pm && typeof (pm as PowerMonitor).getSystemIdleTime === 'function') {
        return (pm as PowerMonitor).getSystemIdleTime();
      }
    } catch { /* not available in this Electron build */ }
    return null;
  }

  private windowIdleSeconds(): number {
    return (Date.now() - this.lastActivityMs) / 1000;
  }

  /**
   * Attaches suspend/resume listeners on Electron's powerMonitor.
   * Returns a cleanup function, or null if powerMonitor is unavailable.
   */
  tryAttachPowerMonitor(onSuspend: () => void, onResume: () => void): (() => void) | null {
    try {
      const req = (window as unknown as { require?: (m: string) => Electron })['require'];
      if (!req) return null;
      const electron = req('electron');
      const pm = (electron['remote'] as Electron | undefined)?.['powerMonitor'] ?? electron['powerMonitor'];
      if (!pm) return null;
      const typedPm = pm as PowerMonitor;
      typedPm.on('suspend', onSuspend);
      typedPm.on('resume', onResume);
      return () => {
        typedPm.off('suspend', onSuspend);
        typedPm.off('resume', onResume);
      };
    } catch {
      return null;
    }
  }

  destroy(): void {
    this.windowListenerCleanup?.();
    this.windowListenerCleanup = null;
  }
}
