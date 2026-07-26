#!/usr/bin/env node

import { Command } from 'commander';
import { showBanner } from './ui.js';

const program = new Command();

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

const isJsonMode = process.argv.includes('--json');
if (!isJsonMode) {
  showBanner();
}

program.parse(process.argv);
