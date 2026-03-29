/**
 * ApiKeyRotator - Rotaciona entre múltiplas API keys
 * Útil para distribuir quota e evitar rate limiting
 */

export class ApiKeyRotator {
  private keys: string[];
  private currentIndex: number = 0;
  private keyUsageCount: Map<string, number> = new Map();
  private keyLastUsed: Map<string, number> = new Map();

  constructor(keysInput: string | string[]) {
    // Aceita string separada por vírgula ou array
    this.keys = Array.isArray(keysInput)
      ? keysInput.filter((k) => k.trim().length > 0)
      : keysInput
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);

    if (this.keys.length === 0) {
      throw new Error("No API keys provided");
    }

    // Inicializar contadores
    this.keys.forEach((key) => {
      this.keyUsageCount.set(key, 0);
      this.keyLastUsed.set(key, 0);
    });

    console.log(`[api-rotator] Initialized with ${this.keys.length} key(s)`);
  }

  /**
   * Obter próxima chave (round-robin)
   */
  getNext(): string {
    const key = this.keys[this.currentIndex];
    
    // Incrementar contador
    const count = (this.keyUsageCount.get(key) || 0) + 1;
    this.keyUsageCount.set(key, count);
    this.keyLastUsed.set(key, Date.now());

    // Mover para próxima
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;

    console.log(
      `[api-rotator] Using key #${this.currentIndex} (usage: ${count})`
    );

    return key;
  }

  /**
   * Obter chave com menos uso (load-balanced)
   */
  getLeastUsed(): string {
    let minKey = this.keys[0];
    let minUsage = this.keyUsageCount.get(minKey) || 0;

    for (const key of this.keys) {
      const usage = this.keyUsageCount.get(key) || 0;
      if (usage < minUsage) {
        minKey = key;
        minUsage = usage;
      }
    }

    const count = (this.keyUsageCount.get(minKey) || 0) + 1;
    this.keyUsageCount.set(minKey, count);
    this.keyLastUsed.set(minKey, Date.now());

    console.log(
      `[api-rotator] Using least-used key (usage: ${count})`
    );

    return minKey;
  }

  /**
   * Obter estatísticas de uso
   */
  getStats() {
    const stats = this.keys.map((key) => ({
      key: key.substring(0, 20) + "...",
      usage: this.keyUsageCount.get(key) || 0,
      lastUsed: new Date(this.keyLastUsed.get(key) || 0).toISOString(),
    }));

    return {
      totalKeys: this.keys.length,
      currentIndex: this.currentIndex,
      keys: stats,
    };
  }

  /**
   * Resetar contadores (útil para testes)
   */
  reset() {
    this.currentIndex = 0;
    this.keys.forEach((key) => {
      this.keyUsageCount.set(key, 0);
      this.keyLastUsed.set(key, 0);
    });
    console.log("[api-rotator] Counters reset");
  }

  /**
   * Quantas chaves disponíveis?
   */
  getKeyCount(): number {
    return this.keys.length;
  }
}
