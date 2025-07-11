import { Queue } from 'bullmq'
import { FastifyInstance } from 'fastify'
import { getSubLogger } from '../utils/logger'

export type JobHandler = (fastify: FastifyInstance) => Promise<void>

interface JobsQueueData {
	handlerName: string
}

const jobHandlersByName: Record<string, JobHandler> = {}

let jobsQueue: Queue

const queueKey = 'jobsQueue'

function initJobsQueue(fastify: FastifyInstance) {
	jobsQueue = fastify.createQueue<JobsQueueData>(queueKey, {
		attempts: 1,
	})
}

export async function addJob(
	fastify: FastifyInstance,
	name: string,
	cron: string,
	handler: JobHandler,
) {
	if (jobsQueue == null) {
		initJobsQueue(fastify)
	}

	jobHandlersByName[handler.name] = handler

	const job = await jobsQueue.upsertJobScheduler(
		name,
		{ pattern: cron },
		{
			name,
			data: { handlerName: handler.name },
			opts: {
				backoff: 0,
				attempts: 1,
			},
		},
	)

	fastify.createWorker<JobsQueueData>(queueKey, createJobsWorker(fastify))

	return job
}

function createJobsWorker(fastify: FastifyInstance) {
	const logger = getSubLogger('JOBS WORKER')
	return async (job: unknown) => {
		const typedJob = job as { data: JobsQueueData; name: string }
		try {
			if (typedJob.data == null || typedJob.data.handlerName == null) {
				return
			}
			if (!jobHandlersByName[typedJob.data.handlerName]) {
				logger.error(`No handler found for job: ${typedJob.name}`)
				return
			}
			logger.debug(`Processing job ${typedJob.name}`)
			await jobHandlersByName[typedJob.data.handlerName](fastify)
			logger.debug(`Job processed successfully: ${typedJob.name}`)
		} catch (error) {
			logger.error(`Error processing job: ${typedJob.name}`, error)
		}
	}
}
