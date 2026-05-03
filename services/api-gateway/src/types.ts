import { FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  walletPubkey: string;
  userId: string;
  iat?: number;
  exp?: number;
}

// Teach TypeScript about the authenticate decorator we add to the Fastify instance.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
