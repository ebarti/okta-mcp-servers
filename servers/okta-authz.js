import { createServer } from '../src/create-server.js';
import { basename } from 'path';
import { fileURLToPath } from 'url';

const serverName = basename(fileURLToPath(import.meta.url), '.js');
createServer(serverName);
