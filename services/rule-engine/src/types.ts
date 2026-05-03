import { FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  walletPubkey: string;
  userId: string;
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
