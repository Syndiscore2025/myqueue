import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createBullConnection } from '../infrastructure/redis/redis';
import { createLogger } from '../utils/logger';

const log = createLogger('queues');

/** Production-grade default job options shared by every queue. */
const defaultJobOptions: NonNullable<QueueOptions['defaultJobOptions']> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

/**
 * Central registry for BullMQ queues and workers.
 *
 * Phase 1 provides the infrastructure only — no concrete jobs or processors are
 * defined here. Later phases register their queues/workers through this manager
 * so connection lifecycle and shutdown are handled consistently.
 */
export class QueueManager {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private sharedConnection: Redis | undefined;

  private getConnection(): Redis {
    if (this.sharedConnection === undefined) {
      this.sharedConnection = createBullConnection();
    }
    return this.sharedConnection;
  }

  /** Register (or return an existing) queue by name. */
  registerQueue(name: string, options: Partial<QueueOptions> = {}): Queue {
    const existing = this.queues.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const queue = new Queue(name, {
      connection: this.getConnection(),
      defaultJobOptions,
      ...options,
    });
    this.queues.set(name, queue);
    log.info({ queue: name }, 'queue registered');
    return queue;
  }

  /** Look up a previously registered queue. */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Create a worker bound to a queue with a dedicated connection. The processor
   * is supplied by the calling feature; no processors ship in Phase 1.
   */
  createWorker<DataType = unknown, ResultType = unknown>(
    name: string,
    processor: Processor<DataType, ResultType>,
    options: Partial<WorkerOptions> = {},
  ): Worker<DataType, ResultType> {
    const worker = new Worker<DataType, ResultType>(name, processor, {
      connection: createBullConnection(),
      ...options,
    });
    this.workers.set(name, worker);
    log.info({ worker: name }, 'worker created');
    return worker;
  }

  /** Gracefully close all workers, queues, and the shared connection. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.workers.values()].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    if (this.sharedConnection !== undefined) {
      this.sharedConnection.disconnect();
      this.sharedConnection = undefined;
    }
    this.workers.clear();
    this.queues.clear();
    log.info('all queues and workers closed');
  }
}

/** Process-wide queue manager singleton. */
export const queueManager = new QueueManager();
