/**
 * Teste de Rotação de API Keys
 * Demonstra como o sistema alterna entre múltiplas API keys quando há erro 429
 */

import { ApiKeyRotator } from "./src/infrastructure/utils/ApiKeyRotator";

console.log("\n=== API Key Rotator Test ===\n");

// Simular múltiplas keys
const testKeys = [
  "AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUA",
  "AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUB", // Segundo key
  "AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUC", // Terceiro key
];

const rotator = new ApiKeyRotator(testKeys);

console.log("📊 Initial Stats:");
console.log(JSON.stringify(rotator.getStats(), null, 2));

console.log("\n🔄 Getting next keys (round-robin):");
for (let i = 0; i < 6; i++) {
  const key = rotator.getNext();
  console.log(`  Attempt ${i + 1}: ${key.substring(0, 30)}...`);
}

console.log("\n📊 After round-robin:");
console.log(JSON.stringify(rotator.getStats(), null, 2));

console.log("\n⚡ Load-balanced selection:");
rotator.reset();
for (let i = 0; i < 5; i++) {
  const key = rotator.getLeastUsed();
  console.log(`  Attempt ${i + 1}: ${key.substring(0, 30)}...`);
}

console.log("\n📊 After load-balancing:");
console.log(JSON.stringify(rotator.getStats(), null, 2));

console.log("\n✅ Test completed!\n");
