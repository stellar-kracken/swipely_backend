import { Job } from "bullmq";
import { assetMetadataSyncService } from "../services/assetMetadataSync.service.js";
import { logger } from "../utils/logger.js";

export async function processMetadataSync(job: Job) {
  logger.info({ jobId: job.id }, "Starting metadata sync job");

  const symbols = Array.isArray(job.data?.symbols)
    ? (job.data.symbols as string[])
    : undefined;
  const fields = Array.isArray(job.data?.fields)
    ? job.data.fields
    : undefined;

  const result = await assetMetadataSyncService.syncAll({
    symbols,
    fields,
    force: Boolean(job.data?.force),
    triggeredBy: "scheduler",
  });

  logger.info({ total: result.total }, "Metadata sync job completed");
}
