import { hkdfSync, createDecipheriv } from 'crypto';

const HKDF_INFO = Buffer.from('solAgent_agent_key');
const KEY_LEN = 32;
const GCM_IV_LEN = 12;
const HKDF_SALT_LEN = 32;
const GCM_TAG_LEN = 16;

function getMasterKey(): Buffer {
  const hex = process.env.AGENT_KEY_MASTER;
  if (!hex || hex.length !== 64) {
    throw new Error('AGENT_KEY_MASTER must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function deriveKey(userWalletPubkey: string, salt: Buffer): Buffer {
  const master = getMasterKey();
  const ikm = Buffer.concat([master, Buffer.from(userWalletPubkey, 'utf8')]);
  return Buffer.from(hkdfSync('sha256', ikm, salt, HKDF_INFO, KEY_LEN));
}

/**
 * Decrypts a stored agent keypair back to the raw 64-byte Solana secret key.
 *
 * keyIv layout (44 bytes):
 *   [0:12]  = AES-GCM IV
 *   [12:44] = HKDF salt
 *
 * encryptedKey layout:
 *   [0 : len-16] = AES-GCM ciphertext
 *   [len-16 : ]  = AES-GCM auth tag (16 bytes)
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
