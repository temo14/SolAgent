import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getPrisma } from '../lib/prisma.js';
import { encryptAgentKeypair } from '../lib/crypto.js';
import { type JwtPayload } from '../types.js';

export async function agentWalletRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /agent-wallets
   * Generates a new Solana keypair for the authenticated user, encrypts it
   * server-side (AES-256-GCM, HKDF-derived key), and persists it.
   *
   * Semi-custodial: the server holds the encryption key derived from
   * HKDF(masterSecret + userPubkey). Never described as "non-custodial".
   */
  server.post(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, walletPubkey } = request.user as JwtPayload;

      // Prevent creating more than 3 agent wallets per user (safety limit)
      const prisma = getPrisma();
      const existing = await prisma.agentWallet.count({ where: { userId, isActive: true } });
      if (existing >= 3) {
        return reply.status(409).send({
          ok: false,
          message: 'Maximum of 3 active agent wallets per account',
        });
      }

      // Generate Ed25519 keypair via tweetnacl (same curve as Solana)
      // secretKey = 64 bytes: first 32 = seed, last 32 = pubkey
      const naclKeypair = nacl.sign.keyPair();
      const pubkeyBase58 = bs58.encode(Buffer.from(naclKeypair.publicKey));

      // Encrypt the 64-byte secret key
      const { encryptedKey, keyIv } = encryptAgentKeypair(
        naclKeypair.secretKey,
        walletPubkey,
      );

      const agentWallet = await prisma.agentWallet.create({
        data: {
          userId,
          pubkey: pubkeyBase58,
          encryptedKey,
          keyIv,
        },
        select: {
          id: true,
          pubkey: true,
          createdAt: true,
          isActive: true,
        },
      });

      request.log.info(
        { userId, agentWalletId: agentWallet.id, pubkey: agentWallet.pubkey },
        'Agent wallet created',
      );

      return reply.status(201).send({ ok: true, data: agentWallet });
    },
  );

  /**
   * GET /agent-wallets
   * Returns all active agent wallets for the authenticated user.
   * Never returns decrypted private key material.
   */
  server.get(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const prisma = getPrisma();

      const wallets = await prisma.agentWallet.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          pubkey: true,
          createdAt: true,
          isActive: true,
          _count: { select: { rules: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ ok: true, data: wallets });
    },
  );

  /**
   * DELETE /agent-wallets/:id
   * Soft-deactivates an agent wallet. Existing rules are paused.
   */
  server.delete(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const wallet = await prisma.agentWallet.findFirst({
        where: { id, userId, isActive: true },
      });
      if (wallet === null) {
        return reply.status(404).send({ ok: false, message: 'Agent wallet not found' });
      }

      // Pause all active rules tied to this wallet before deactivating
      await prisma.$transaction([
        prisma.rule.updateMany({
          where: { agentWalletId: id, status: 'ACTIVE' },
          data: {
            status: 'PAUSED',
            pausedAt: new Date(),
            pauseReason: 'agent_wallet_deactivated',
          },
        }),
        prisma.agentWallet.update({
          where: { id },
          data: { isActive: false },
        }),
      ]);

      request.log.info({ userId, agentWalletId: id }, 'Agent wallet deactivated');
      return reply.send({ ok: true });
    },
  );
}
