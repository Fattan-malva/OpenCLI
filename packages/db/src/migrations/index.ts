import { migration001 } from './001-initial.js';
import { migration002 } from './002-settings.js';
import { migration003 } from './003-model-routing.js';
import { migration004 } from './004-workflows.js';
import { migration005 } from './005-workflow-events.js';
import { migration006 } from './006-task-capabilities.js';

export const migrations = [migration001, migration002, migration003, migration004, migration005, migration006];
