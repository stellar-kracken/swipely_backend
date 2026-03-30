import { FastifyInstance } from 'fastify';
import { getMetricsService } from '../../utils/metrics.js';
import * as os from 'os';

export function formatPrometheusMetrics(metrics: Record<string, any>): string {
  let output = '';

  // Add process metrics
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();

  output += '# HELP process_uptime_seconds Process uptime in seconds\n';
  output += '# TYPE process_uptime_seconds gauge\n';
  output += `process_uptime_seconds ${uptime}\n\n`;

  output += '# HELP process_resident_memory_bytes Resident memory in bytes\n';
  output += '# TYPE process_resident_memory_bytes gauge\n';
  output += `process_resident_memory_bytes ${memUsage.rss}\n\n`;

  output += '# HELP process_virtual_memory_bytes Virtual memory in bytes\n';
  output += '# TYPE process_virtual_memory_bytes gauge\n';
  output += `process_virtual_memory_bytes ${memUsage.heapTotal}\n\n`;

  output += '# HELP process_cpu_seconds_total CPU time in seconds\n';
  output += '# TYPE process_cpu_seconds_total counter\n';
  output += `process_cpu_seconds_total ${process.cpuUsage().user / 1000000}\n\n`;

  // Add application metrics
  Object.entries(metrics).forEach(([metricName, values]: [string, any]) => {
    if (!Array.isArray(values) || values.length === 0) return;

    const firstValue = values[0];
    const metricType = firstValue.type || 'gauge';
    const help = firstValue.help || `${metricName} metric`;

    output += `# HELP ${metricName} ${help}\n`;
    output += `# TYPE ${metricName} ${metricType}\n`;

    values.forEach((metric: any) => {
      const labels = metric.labels
        ? Object.entries(metric.labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',')
        : '';

      const labelStr = labels ? `{${labels}}` : '';
      output += `${metricName}${labelStr} ${metric.value}\n`;
    });

    output += '\n';
  });

  return output;
}

export async function registerMetricsEndpoint(
  server: FastifyInstance
): Promise<void> {
  const metricsService = getMetricsService();

  server.get('/metrics', async (request, reply) => {
    try {
      const metricsJson = await metricsService.getMetricsJSON();
      const prometheusFormat = formatPrometheusMetrics(metricsJson);

      reply.type('text/plain; version=0.0.4').send(prometheusFormat);
    } catch (error) {
      reply.code(500).send({ error: 'Failed to retrieve metrics' });
    }
  });
}
