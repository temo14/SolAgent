import { PrismaClient } from '@prisma/client';

let instance: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (instance === null) {
    instance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return instance;
}

export async function disconnectPrisma(): Promise<void> {
  if (instance !== null) {
    await instance.$disconnect();
    instance = null;
  }
}
