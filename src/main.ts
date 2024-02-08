process.removeAllListeners('warning');
import * as fs from 'fs';
import { startHelper } from './awa-helper';
import { startManager } from './manager/index';

if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

if (process.argv.includes('--manager')) {
  startManager(process.argv.includes('--helper'));
} else {
  startHelper();
}
