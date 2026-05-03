import {
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'crypto';

const HKDF_INFO = Buffer.from('solAgent_agent_key');
const KEY_LEN = 32;        // AES-256
const GCM_IV_LEN = 12;    // standard GCM nonce
const HKDF_SALT_LEN = 32; // HKDF salt
const GCM_TAG_LEN = 16;   // AES-GCM auth tag

/**
 * Returns the 32-byte master key from AGENT_KEY_MASTER env var.
 * Throws loudly at startup if misconfigured.
 */
function getMasterKey(): Buffer {
  const hex = process.env.AGENT_KEY_MASTER;
  if (!hex || hex.length !== 64) {
    throw new Error('AGENT_KEY_MASTER must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Derives a 256-bit AES key for an agent wallet.
 *
 * IKM = serverMasterKey ++ utf8(userWalletPubkey)
 * This keeps key derivation deterministic from server-controlled inputs,
 * allowing the execution engine to re-derive the key without user interaction.
 *
 * Design note (conservative choice):
 * The spec suggests HKDF(user_wallet_signature, ...) which would bind
 * decryption to the user's wallet. That prevents autonomous execution.
 * We use server_master + user_pubkey so the execution engine can decrypt
 * at job time. This is semi-custodial — documented honestly in all UI strings.
 */
function deriveKey(userWalletPubkey: string, salt: Buffer): Buffer {
  const master = getMasterKey();
  const ikm = Buffer.concat([master, Buffer.from(userWalletPubkey, 'utf8')]);
  return Buffer.from(hkdfSync('sha256', ikm, salt, HKDF_INFO, KEY_LEN));
}

export interface EncryptedKeypair {
  /**
   * AES-GCM ciphertext (64 bytes) + auth tag (16 bytes) = 80 bytes.
   * Maps to AgentWallet.encryptedKey.
   */
  encryptedKey: Buffer;
  /**
   * GCM IV (12 bytes) || HKDF salt (32 bytes) = 44 bytes.
   * Maps to AgentWallet.keyIv.
   */
  keyIv: Buffer;
}

/**
 * Encrypts a 64-byte Solana secret key.
 * Output layout:
 *   keyIv[0:12]  = AES-GCM IV
 *   keyIv[12:44] = HKDF salt
 *   encryptedKey = ciphertext + auth tag
 */
export function encryptAgentKeypair(
  secretKey: Uint8Array,
  userWalletPubkey: string,
): EncryptedKeypair {
  const salt = randomBytes(HKDF_SALT_LEN);
  const iv = randomBytes(GCM_IV_LEN);
  const key = deriveKey(userWalletPubkey, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: Buffer.concat([ciphertext, authTag]),
    keyIv: Buffer.concat([iv, salt]),
  };
}

/**
 * Decrypts a stored agent keypair back to the raw 64-byte secret key.
 * Called by the execution engine at job-dispatch time.
 */
export function decryptAgentKeypair(
  encryptedKey: Buffer,
  keyIv: Buffer,
  userWalletPubkey: string,
): Uint8Array {
  if (keyIv.length < GCM_IV_LEN + HKDF_SALT_LEN) {
    throw new Error('keyIv buffer too short — corrupted agent wallet record');
  }
  const iv = keyIv.subarray(0, GCM_IV_LEN);
  const salt = keyIv.subarray(GCM_IV_LEN, GCM_IV_LEN + HKDF_SALT_LEN);
  const key = deriveKey(userWalletPubkey, salt);

  const authTag = encryptedKey.subarray(encryptedKey.length - GCM_TAG_LEN);
  const ciphertext = encryptedKey.subarray(0, encryptedKey.length - GCM_TAG_LEN);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
