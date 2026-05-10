import { initBN254 } from "./bn254-crypto";

// Singleton promise — resolved once the WASM binary is loaded.
// Any module that needs BN254 awaits this before doing crypto work.
export const bn254Ready: Promise<void> = initBN254();
