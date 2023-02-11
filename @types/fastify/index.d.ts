import { FastifyInstance } from 'fastify';

declare module 'fastify' {
  export interface FastifyInstance {
    swagger: Function,
  }
}