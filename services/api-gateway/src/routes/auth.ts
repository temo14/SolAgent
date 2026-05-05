import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import { getRedis } from '../lib/redis.js';
import {
  generateNonce,
  buildSiwsMessage,
  verifySiwsSignature,
  NONCE_TTL_SECONDS,
  NONCE_REDIS_PREFIX,
} from '../lib/siws.js';
import { type JwtPayload } from '../types.js';

const NonceQuerySchema = z.object({
  wallet: z.string().optional(),
});

const VerifyBodySchema = z.object({
  walletPubkey: z.string().min(32).max(44),
  signature: z.string().min(1),
  message: z.string().min(1),
  nonce: z.string().length(64), // 32 bytes → 64 hex chars
});

/** Dev bypass body — echoes SIWS timings for optional server-side asserts in the future */
const DevBypassBodySchema = z.object({
  walletPubkey: z.string().min(32).max(44),
  nonce: z.string().length(64),
  issuedAt: z.string(),
  expiresAt: z.string(),
});

export async function authRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /auth/nonce
   * Returns a one-time nonce for SIWS. Optionally bound to a wallet pubkey.
   * Nonce expires in 5 minutes.
   */
  server.get(
    '/nonce',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryParse = NonceQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({ ok: false, message: 'Invalid query params' });
      }

      const nonce = generateNonce();
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString();

      const redis = getRedis();
      // Value = wallet (or "unbound"). Key = single-use — deleted on verify.
      await redis.setex(
        `${NONCE_REDIS_PREFIX}${nonce}`,
        NONCE_TTL_SECONDS,
        queryParse.data.wallet ?? 'unbound',
      );

      return reply.send({ ok: true, data: { nonce, issuedAt, expiresAt } });
    },
  );

  /**
   * POST /auth/verify
   * Verifies a SIWS signature.
   * On success: creates or updates the User record and returns a JWT.
   * JWT is HS256, 24h, wallet-scoped — client stores in memory only.
   */
  server.post(
    '/verify',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyParse = VerifyBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      const { walletPubkey, signature, message, nonce } = bodyParse.data;
      const redis = getRedis();

      // 1. Validate nonce exists (single-use guarantee)
      const nonceKey = `${NONCE_REDIS_PREFIX}${nonce}`;
      const storedValue = await redis.get(nonceKey);
      if (storedValue === null) {
        request.log.warn({ walletPubkey }, 'SIWS: nonce not found or expired');
        return reply.status(401).send({ ok: false, message: 'Nonce invalid or expired' });
      }
      if (storedValue !== 'unbound' && storedValue !== walletPubkey) {
        request.log.warn({ walletPubkey, stored: storedValue }, 'SIWS: nonce wallet mismatch');
        return reply.status(401).send({ ok: false, message: 'Nonce wallet mismatch' });
      }

      // 2. Verify Ed25519 signature
      const valid = verifySiwsSignature({ walletPubkey, signature, message });
      if (!valid) {
        request.log.warn({ walletPubkey }, 'SIWS: invalid signature');
        return reply.status(401).send({ ok: false, message: 'Invalid signature' });
      }

      // 3. Consume nonce — single use regardless of downstream failure
      await redis.del(nonceKey);

      // 4. Upsert user
      const prisma = getPrisma();
      const user = await prisma.user.upsert({
        where: { walletPubkey },
        update: { lastSeenAt: new Date() },
        create: { walletPubkey },
        select: { id: true, walletPubkey: true, isActive: true },
      });

      if (!user.isActive) {
        return reply.status(403).send({ ok: false, message: 'Account suspended' });
      }

      // 5. Sign JWT — HS256, 24h, contains walletPubkey + userId
      const payload: JwtPayload = { walletPubkey: user.walletPubkey, userId: user.id };
      const token = server.jwt.sign(payload, { expiresIn: '24h' });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      request.log.info({ walletPubkey }, 'SIWS: authenticated');

      return reply.send({
        ok: true,
        data: { token, expiresAt, walletPubkey: user.walletPubkey },
      });
    },
  );

  /**
   * POST /auth/dev-bypass
   * Skips Ed25519 signature verification after the same nonce check as `/verify`.
   * Requires AUTH_DEV_BYPASS=true and AUTH_DEV_BYPASS_WALLET to be set explicitly.
   * Only the wallet matching AUTH_DEV_BYPASS_WALLET is allowed through.
   */
  server.post(
    '/dev-bypass',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (process.env.AUTH_DEV_BYPASS !== 'true') {
        return reply.status(404).send({ ok: false, message: 'Not found' });
      }

      const bodyParse = DevBypassBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok: false,
          message: 'Invalid request body',
          detail: bodyParse.error.flatten(),
        });
      }

      const { walletPubkey, nonce } = bodyParse.data;
      const allowlist = process.env.AUTH_DEV_BYPASS_WALLET?.trim();

      if (!allowlist) {
        return reply.status(404).send({ ok: false, message: 'Not found' });
      }
      if (walletPubkey !== allowlist) {
        return reply.status(403).send({ ok: false, message: 'Dev bypass pubkey not allowed' });
      }

      const redis = getRedis();
      const nonceKey = `${NONCE_REDIS_PREFIX}${nonce}`;
      const storedValue = await redis.get(nonceKey);
      if (storedValue === null) {
        request.log.warn({ walletPubkey }, 'DEV BYPASS: nonce not found or expired');
        return reply.status(401).send({ ok: false, message: 'Nonce invalid or expired' });
      }
      if (storedValue !== 'unbound' && storedValue !== walletPubkey) {
        request.log.warn({ walletPubkey, stored: storedValue }, 'DEV BYPASS: nonce wallet mismatch');
        return reply.status(401).send({ ok: false, message: 'Nonce wallet mismatch' });
      }

      await redis.del(nonceKey);

      const prisma = getPrisma();
      const user = await prisma.user.upsert({
        where: { walletPubkey },
        update: { lastSeenAt: new Date() },
        create: { walletPubkey },
        select: { id: true, walletPubkey: true, isActive: true },
      });

      if (!user.isActive) {
        return reply.status(403).send({ ok: false, message: 'Account suspended' });
      }

      const payload: JwtPayload = { walletPubkey: user.walletPubkey, userId: user.id };
      const token = server.jwt.sign(payload, { expiresIn: '24h' });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      request.log.warn({ walletPubkey }, 'DEV BYPASS: authenticated (no signature)');

      return reply.send({
        ok: true,
        data: { token, expiresAt, walletPubkey: user.walletPubkey },
      });
    },
  );
}
