import { Logger } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Axiom } from '@axiomhq/js';
import Config from './config';

const stream = createStream('tslog.log', {
  size: '10M',
  interval: '7d',
  compress: 'gzip'
});

const axiomEnabled = Boolean(Config.AXIOM_TOKEN && Config.AXIOM_DATASET);

const axiom = axiomEnabled
  ? new Axiom({
      token: Config.AXIOM_TOKEN,
      orgId: Config.AXIOM_ORG_ID || undefined,
      edge: Config.AXIOM_EDGE || undefined,
      onError: (error) => {
        console.error('[axiom] ingest failed:', error);
      }
    })
  : null;

export function flushLogs(): Promise<void> {
  return axiom ? axiom.flush() : Promise.resolve();
}

const logger = new Logger({
  prettyLogTemplate:
    '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{filePathWithLine}}{{name}}]\t',
  prettyErrorTemplate:
    '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}',
  prettyErrorStackTemplate:
    '  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}',
  prettyErrorParentNamesSeparator: ':',
  prettyErrorLoggerNameDelimiter: '\t',
  stylePrettyLogs: true,
  prettyLogTimeZone: 'UTC',
  prettyLogStyles: {
    logLevelName: {
      '*': ['bold', 'black', 'bgWhiteBright', 'dim'],
      SILLY: ['bold', 'white'],
      TRACE: ['bold', 'whiteBright'],
      DEBUG: ['bold', 'green'],
      INFO: ['bold', 'blue'],
      WARN: ['bold', 'yellow'],
      ERROR: ['bold', 'red'],
      FATAL: ['bold', 'redBright']
    },
    dateIsoStr: 'white',
    filePathWithLine: 'white',
    name: ['white', 'bold'],
    nameWithDelimiterPrefix: ['white', 'bold'],
    nameWithDelimiterSuffix: ['white', 'bold'],
    errorName: ['bold', 'bgRedBright', 'whiteBright'],
    fileName: ['yellow']
  }
});

logger.attachTransport((logObj) => {
  stream.write(JSON.stringify(logObj) + '\n');
  if (axiom) {
    const meta = logObj._meta as { date?: Date } | undefined;
    const _time = meta?.date
      ? meta.date.toISOString()
      : new Date().toISOString();
    axiom.ingest(
      Config.AXIOM_DATASET,
      { ...logObj, _time },
      { timestampField: '_time' }
    );
  }
});

export default logger;
