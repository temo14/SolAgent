import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrisma } from '../lib/prisma.js';
import { type JwtPayload } from '../types.js';
import { deriveAgentPubkey } from '../lib/crypto.js';

export async function agentWalletRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /agent-wallets
   * Creates a new agent-wallet DB record for the authenticated user.
   *
   * Per-user derived agent model:
   *  - ownerPubkey  = the user's own wallet (from JWT).
   *  - delegatePubkey = HMAC-SHA256(AGENT_KEY_MASTER, ownerPubkey) → unique per user.
   *  - mandatePda is left null until the user creates their on-chain Mandate
   *    via MandatePanel and calls PATCH /:id/mandate.
   */
  server.post(
    '/',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, walletPubkey } = request.user as JwtPayload;

      const prisma = getPrisma();
      const existing = await prisma.agentWallet.count({ where: { userId, isActive: true } });
      if (existing >= 3) {
        return reply.status(409).send({
          ok: false,
          message: 'Maximum of 3 active agent wallets per account',
        });
      }

      let delegatePubkey: string;
      try {
        delegatePubkey = deriveAgentPubkey(walletPubkey);
      } catch (err) {
        request.log.error({ err }, 'Agent key derivation error');
        return reply.status(500).send({ ok: false, message: 'Server misconfiguration: AGENT_KEY_MASTER not set' });
      }

      const agentWallet = await prisma.agentWallet.create({
        data: {
          userId,
          ownerPubkey: walletPubkey,
          delegatePubkey,
        },
        select: {
          id: true,
          ownerPubkey: true,
          delegatePubkey: true,
          mandatePda: true,
          createdAt: true,
          isActive: true,
        },
      });

      request.log.info(
        { userId, agentWalletId: agentWallet.id, ownerPubkey: walletPubkey, delegatePubkey },
        'Agent wallet created (per-user derived keypair)',
      );

      return reply.status(201).send({ ok: true, data: agentWallet });
    },
  );

  /**
   * GET /agent-wallets
   * Returns all active agent wallets for the authenticated user.
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
          ownerPubkey: true,
          delegatePubkey: true,
          mandatePda: true,
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
   * PATCH /agent-wallets/:id/mandate
   * Records the on-chain mandate PDA address for an agent wallet.
   * Called by the frontend after the user signs and broadcasts create_mandate.
   */
  server.patch(
    '/:id/mandate',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const { mandatePda } = request.body as { mandatePda: string };

      if (!mandatePda || typeof mandatePda !== 'string') {
        return reply.status(400).send({ ok: false, message: 'mandatePda is required' });
      }

      const prisma = getPrisma();
      const wallet = await prisma.agentWallet.findFirst({
        where: { id, userId, isActive: true },
      });
      if (!wallet) {
        return reply.status(404).send({ ok: false, message: 'Agent wallet not found' });
      }

      await prisma.agentWallet.update({
        where: { id },
        data: { mandatePda },
      });

      request.log.info({ userId, agentWalletId: id, mandatePda }, 'Mandate PDA recorded');
      return reply.send({ ok: true });
    },
  );

  /**
   * GET /agent-wallets/:id/mandate-state
   * Reads the on-chain Mandate account and returns deserialized state.
   * Returns { ok: true, data: null } when no mandate has been created.
   */
  server.get(
    '/:id/mandate-state',
    { onRequest: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const wallet = await prisma.agentWallet.findFirst({
        where: { id, userId, isActive: true },
        select: { mandatePda: true },
      });
      if (!wallet) {
        return reply.status(404).send({ ok: false, message: 'Agent wallet not found' });
      }
      if (!wallet.mandatePda) {
        return reply.send({ ok: true, data: null });
      }

      const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
      try {
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [wallet.mandatePda, { encoding: 'base64' }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const rpcData = (await rpcRes.json()) as {
          result?: { value?: { data: [string, string] } | null };
        };

        const b64 = rpcData.result?.value?.data?.[0];
        if (!b64) return reply.send({ ok: true, data: null });

        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 122) return reply.send({ ok: true, data: null });

        const maxPerTxLamports  = buf.readBigUInt64LE(72);
        const maxPerDayLamports = buf.readBigUInt64LE(80);
        const spentTodayLamports = buf.readBigUInt64LE(88);
        const dayResetTs        = buf.readBigInt64LE(96);
        const totalExecutions   = buf.readBigUInt64LE(104);
        const isActive          = buf.readUInt8(112) === 1;
        const expiresAt         = buf.readBigInt64LE(113);

        return reply.send({
          ok: true,
          data: {
            mandatePda: wallet.mandatePda,
            maxPerTxLamports:   maxPerTxLamports.toString(),
            maxPerDayLamports:  maxPerDayLamports.toString(),
            spentTodayLamports: spentTodayLamports.toString(),
            dayResetTs:         dayResetTs.toString(),
            totalExecutions:    totalExecutions.toString(),
            isActive,
            expiresAt:          expiresAt.toString(),
          },
        });
      } catch {
        return reply.send({ ok: true, data: null });
      }
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
